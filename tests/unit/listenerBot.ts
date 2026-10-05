/**
 * A test player who knows nothing about the suspect's route: it only hears
 * the scanner's French (as structured clauses) and looks at the map, like a
 * student would. It acts on each clause live, counting streets and watching
 * for landmarks as it drives, so it checks the generator independently.
 * It gets out of the car on "Descendez de la voiture !" and back in on
 * "Montez dans la voiture !", and drops the directions it was following on
 * "Le suspect a changé de direction."
 *
 * It remembers the vehicle it is told about ("Le suspect est dans une voiture
 * verte.") and answers sightings from what it heard: the vehicle and place
 * named in the call, or the remembered vehicle when the call only says
 * "Le suspect est près de …". When the signal is lost it carries on with the
 * directions it already has.
 */

import { EVENT_LINES, TRANSPORT_LINES } from '../../src/engine/audio/script';
import type { ChaseEvent, ModeChangeResult } from '../../src/engine/chase/chase';
import type { Mover } from '../../src/engine/movement/mover';
import { VEHICLES, type Vehicle } from '../../src/engine/chase/settings';
import { sightingLine, vehicleLine } from '../../src/engine/language/sightings';
import type { SightingCard } from '../../src/engine/chase/sightings';
import { isAt, isDecision, locationById, opensOn, passPoint, scanAhead } from '../../src/engine/language/analysis';
import type { Clause } from '../../src/engine/language/instructions';
import type { Transmission } from '../../src/engine/language/navigator';
import { exitsAt } from '../../src/engine/movement/turns';
import { readFileSync } from 'node:fs';
import { SPEECH } from '../../src/engine/language/settings';
import { heardTimes, speechSeconds, type ClipSeconds } from '../../src/engine/language/timing';
import type { TownGraph } from '../../src/engine/world/graph';

interface Task {
  clause: Clause;
  count: number;
  travelled: number;
  target?: number;
  queued: boolean;
  /** The step has been said (and taken in) from this time on. */
  notBefore: number;
  /** Which call it came in (calls are numbered in order). */
  seq: number;
  /** The edge the player was on when the call came: a junction passed just before it is not counted. */
  pushedOn?: string;
}

/** The real recordings' lengths (seconds), so the bot hears the radio as a student does. */
const RECORDED: Record<string, number> = (() => {
  try {
    const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as { clips: Record<string, { durationMs?: number }> };
    return Object.fromEntries(Object.entries(manifest.clips).map(([id, c]) => [id, (c.durationMs ?? 0) / 1000]));
  } catch {
    return {};
  }
})();
export const clipSeconds: ClipSeconds = (clip) => RECORDED[clip.audioId] || speechSeconds(clip.text);

/** What the bot plays: the chase, or Escape Mode (the same French, the roles switched). */
export interface Playable {
  player: Mover;
  update(dt: number): ChaseEvent[];
  toggleMode(): { result: ModeChangeResult; events: ChaseEvent[] };
  answerSighting(choice: number): ChaseEvent[];
  /** The call given before anything moves (the game plays it in full, then starts). */
  openingCall?(): ChaseEvent[];
}

/** Clauses that are not a turn at a junction. */
const NOT_A_STEP = new Set(['WRONG_STREET', 'U_TURN', 'STRAIGHT', 'CONTINUE_UNTIL']);

export class ListenerBot {
  private heard: { at: number; seq: number; clause: Clause }[] = [];
  /** When the radio is free again. */
  private radioFree = 0;
  private opened = false;
  private seq = 0;
  /** Every step heard, with when it has been taken in (said, plus reaction): for timing tests. */
  readonly steps: { node: string; heardBy: number }[] = [];

  /** The bot's clock (the opening call is heard before the chase starts). */
  get now(): number {
    return this.time;
  }
  private orders: { at: number; audioId: string }[] = [];
  /** When the bot understands that the suspect changed direction, and which calls came before the warning. */
  private changes: { at: number; before: number }[] = [];
  /** The vehicle it was last told the suspect is in. */
  private vehicle: Vehicle | null = null;
  private question: { at: number; cards: SightingCard[]; audioId: string } | null = null;
  /** Sightings it could not work out from what it heard. */
  readonly unsure: string[] = [];
  /** Mode changes that failed (for example, the car out of reach). */
  readonly failedOrders: string[] = [];
  private tasks: Task[] = [];
  private time = 0;
  private lastEdge = '';
  private lastTowards = '';
  private lastPos: { x: number; y: number } | null = null;
  readonly log: Transmission[] = [];

  constructor(
    private readonly graph: TownGraph,
    /** Seconds between a step being said and acting on it (taking it in). */
    private readonly reaction = 0.8,
  ) {}

  hear(events: ChaseEvent[], edge?: string): void {
    for (const [i, e] of events.entries()) {
      if (e.type === 'TRANSMISSION') {
        // A line just before it ("Attention ! …") is said first in the same call.
        const previous = events[i - 1];
        const lead = previous?.type === 'ANNOUNCE' && !previous.after ? previous.lines : [];
        // A way back after a wrong turn cuts off what the radio was saying, as the game plays it.
        if (e.transmission.urgent && lead.length === 0) this.cutOff();
        const start = Math.max(this.time, this.radioFree);
        const times = heardTimes(e.transmission.instructions, lead, clipSeconds);
        const seq = this.seq++;
        // A way back replaces the directions heard before it, even when it does not open with
        // "Ce n'est pas la bonne rue." (not said twice in a row, nor after a missed U-turn).
        const wrong = e.transmission.instructions.some((ins) => ins.clauses.some((c) => c.action === 'WRONG_STREET'));
        if (e.transmission.urgent && !wrong) this.heard.push({ at: start + this.reaction, seq: seq - 1, clause: { action: 'WRONG_STREET' } as Clause });
        let k = 0;
        for (const instruction of e.transmission.instructions) {
          const steps = instruction.clauses.filter((c) => !NOT_A_STEP.has(c.action));
          for (const clause of instruction.clauses) {
            const at = start + (times[k++] ?? 0) + this.reaction;
            const j = steps.indexOf(clause);
            const node = steps.length === instruction.atNodes.length ? instruction.atNodes[j] : undefined;
            if (node && e.transmission.kind !== 'RECOVERY') this.steps.push({ node, heardBy: at });
            if (clause.action === 'WRONG_STREET' || clause.action === 'U_TURN') this.heard.push({ at, seq, clause });
            else if (clause.action !== 'STRAIGHT' && clause.action !== 'CONTINUE_UNTIL') {
              this.tasks.push({ clause, count: 0, travelled: 0, queued: false, notBefore: at, seq, ...(edge ? { pushedOn: edge } : {}) });
            }
          }
        }
        const clips = [...lead, ...e.transmission.instructions.flatMap((ins) => ins.clips)];
        this.radioFree = start + this.callLength(clips);
        this.log.push(e.transmission);
      } else if (e.type === 'ANNOUNCE') {
        // Urgent news cuts off whatever was being said: the rest of it is never heard.
        if (e.interrupt) this.cutOff();
        const joined = !e.after && events[i + 1]?.type === 'TRANSMISSION';
        if (joined) continue; // said with the direction after it
        const start = Math.max(this.time, this.radioFree);
        let t = start + SPEECH.radioLeadSeconds;
        for (const line of e.lines) {
          t += clipSeconds(line);
          const at = t + this.reaction;
          if (line.audioId === TRANSPORT_LINES.GET_OUT.audioId || line.audioId === TRANSPORT_LINES.GET_IN.audioId) {
            this.orders.push({ at, audioId: line.audioId });
          }
          if (line.audioId === EVENT_LINES.CHANGED_DIRECTION.audioId) this.changes.push({ at, before: this.seq });
          const told = VEHICLES.find((v) => vehicleLine(v).audioId === line.audioId);
          if (told) this.vehicle = told;
          t += SPEECH.clipGapSeconds;
        }
        this.radioFree = start + this.callLength(e.lines);
      } else if (e.type === 'SIGHTING') {
        const start = Math.max(this.time, this.radioFree);
        this.radioFree = start + this.callLength([e.line]);
        this.question = { at: this.radioFree + this.reaction, cards: e.cards, audioId: e.line.audioId };
      }
    }
    // "Attention ! Le suspect a changé de direction." said just before a direction, in the same call.
    for (const [i, e] of events.entries()) {
      if (e.type !== 'ANNOUNCE' || e.after || events[i + 1]?.type !== 'TRANSMISSION') continue;
      for (const line of e.lines) {
        if (line.audioId === TRANSPORT_LINES.GET_OUT.audioId || line.audioId === TRANSPORT_LINES.GET_IN.audioId) {
          this.orders.push({ at: this.time + this.reaction, audioId: line.audioId });
        }
        // The corrected direction in the same call is kept (it comes after the warning).
        if (line.audioId === EVENT_LINES.CHANGED_DIRECTION.audioId) this.changes.push({ at: this.time, before: this.seq - 1 });
        const told = VEHICLES.find((v) => vehicleLine(v).audioId === line.audioId);
        if (told) this.vehicle = told;
      }
    }
  }

  /** Whatever the radio was still saying is cut off: the rest of it is never heard. */
  private cutOff(): void {
    this.radioFree = Math.min(this.radioFree, this.time);
    this.tasks = this.tasks.filter((t) => t.notBefore - this.reaction <= this.time);
    this.heard = this.heard.filter((h) => h.at - this.reaction <= this.time);
  }

  /** Seconds the radio is busy with a call of these clips (beep, voice, gaps, click). */
  private callLength(clips: readonly { audioId: string; text: string }[]): number {
    if (clips.length === 0) return 0;
    const voice = clips.reduce((sum, c) => sum + clipSeconds(c), 0);
    return SPEECH.radioLeadSeconds + voice + SPEECH.clipGapSeconds * (clips.length - 1) + SPEECH.radioTailSeconds;
  }

  /** Act, then advance the chase by dt. */
  step(chase: Playable, dt: number): ChaseEvent[] {
    if (!this.opened) {
      // The game plays the opening call in full before anything moves.
      this.opened = true;
      const opening = chase.openingCall?.() ?? [];
      this.hear(opening);
      if (opening.length > 0) {
        this.time = this.radioFree;
        for (const t of this.tasks) t.notBefore = Math.min(t.notBefore, this.time);
        for (const h of this.heard) h.at = Math.min(h.at, this.time);
        for (const o of this.orders) o.at = Math.min(o.at, this.time);
        this.radioFree = this.time;
      }
      return opening;
    }
    this.time += dt;
    if (this.question && this.question.at <= this.time) {
      const choice = this.answer(this.question.cards, this.question.audioId);
      if (choice === -1) this.unsure.push(this.question.audioId);
      this.question = null;
      const events = chase.answerSighting(choice);
      this.hear(events);
      return events;
    }
    while (this.orders.length > 0 && (this.orders[0]?.at ?? Infinity) <= this.time) {
      const order = this.orders.shift()!;
      const { result, events } = chase.toggleMode();
      if (!result.ok) this.failedOrders.push(`${order.audioId}: ${result.reason}`);
      this.tasks = [];
      this.lastEdge = '';
      this.hear(events);
    }
    const player = chase.player;
    while (this.changes.length > 0 && (this.changes[0]?.at ?? Infinity) <= this.time) {
      // The directions it was following no longer apply, nor do any heard just
      // before the warning; the corrected ones that follow it are kept.
      const change = this.changes.shift()!;
      this.tasks = this.tasks.filter((t) => t.seq >= change.before);
      this.heard = this.heard.filter((h) => h.seq >= change.before);
      player.clearQueue();
    }
    while (this.heard.length > 0 && (this.heard[0]?.at ?? Infinity) <= this.time) {
      const { clause, seq } = this.heard.shift()!;
      if (clause.action === 'WRONG_STREET') {
        // The directions from before this call no longer apply.
        this.tasks = this.tasks.filter((t) => t.seq > seq);
        player.clearQueue();
      } else if (clause.action === 'U_TURN') {
        player.uTurn();
      }
    }

    const me = player.snapshot();
    const moved = this.lastPos ? Math.hypot(me.x - this.lastPos.x, me.y - this.lastPos.y) : 0;
    this.lastPos = { x: me.x, y: me.y };
    const passedNode = me.edgeId !== this.lastEdge && this.lastEdge !== '' ? this.lastTowards : null;
    const arrivedBy = this.lastEdge;
    this.lastEdge = me.edgeId;
    this.lastTowards = me.towards;

    const task = this.tasks[0];
    if (task) {
      task.travelled += moved;
      const counted = task.pushedOn === me.edgeId ? null : passedNode;
      delete task.pushedOn;
      if (task.queued) {
        if (me.queued === null) this.tasks.shift(); // the turn has been made
      } else if (this.ready(task, chase, counted, arrivedBy) && this.time >= task.notBefore) {
        const side = task.clause.action === 'ROUNDABOUT_EXIT' ? 'RIGHT' : (task.clause as { side: 'LEFT' | 'RIGHT' }).side;
        player.queue(side);
        task.queued = true;
      }
    }
    const events = chase.update(dt);
    // Changing transport puts the player on a new mover: that is not passing a junction.
    if (chase.player !== player) this.lastEdge = '';
    this.hear(events, chase.player.snapshot().edgeId);
    return events;
  }

  /** The card matching the call it heard: the place said, and the vehicle said or remembered (any, on foot). */
  private answer(cards: readonly SightingCard[], audioId: string): number {
    const heard = cards
      .flatMap((c) => [...VEHICLES, null].map((named) => ({ named, place: c.place })))
      .find((h) => sightingLine(h.named, h.place).audioId === audioId);
    if (!heard) return -1;
    const vehicle = heard.named ?? this.vehicle;
    return cards.findIndex((c) => c.place === heard.place && (c.vehicle === null || c.vehicle === vehicle));
  }

  /** Is it time to press the arrow for this clause? */
  private ready(task: Task, chase: Playable, passedNode: string | null, arrivedBy: string): boolean {
    const clause = task.clause;
    const pos = chase.player.location();
    const mode = chase.player.mode;
    const passedExits = passedNode ? exitsAt(this.graph, this.graph.edge(arrivedBy), passedNode, mode) : [];
    switch (clause.action) {
      case 'TURN': {
        if (!clause.landmark) return true;
        const location = locationById(this.graph, clause.landmark)!;
        const ahead = scanAhead(this.graph, pos, mode);
        if (clause.relation === 'DEVANT') {
          const next = ahead.nodes.find(isDecision);
          return next !== undefined && isAt(this.graph, location, next.node);
        }
        if (clause.relation === 'APRES') {
          if (task.target === undefined) task.target = passPoint(ahead, location) ?? 0;
          return task.travelled > task.target;
        }
        // AVANT: the next street on that side is the last one before the place.
        const s = passPoint(ahead, location);
        const streets = ahead.nodes.filter((n) => opensOn(n, clause.side));
        return s !== undefined && streets[0] !== undefined && streets[0].s < s && !(streets[1] && streets[1].s < s);
      }
      case 'TAKE_STREET': {
        const onRing = passedNode !== null && this.graph.node(passedNode).roundaboutId !== undefined;
        if (passedNode && !onRing && passedExits.length > 1 && passedExits.some((e) => e.kind === clause.side)) {
          task.count++;
        }
        return task.count >= clause.ordinal - 1;
      }
      case 'ROUNDABOUT_EXIT': {
        const onRingEdge = this.graph.edge(pos.edgeId).kind === 'ROUNDABOUT_RING';
        if (passedNode && onRingEdge && passedExits.some((e) => e.kind === 'RIGHT')) task.count++;
        return onRingEdge && task.count >= clause.ordinal - 1;
      }
      default:
        return true;
    }
  }
}
