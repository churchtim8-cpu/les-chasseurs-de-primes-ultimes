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
import type { TownGraph } from '../../src/engine/world/graph';

interface Task {
  clause: Clause;
  count: number;
  travelled: number;
  target?: number;
  queued: boolean;
}

/** What the bot plays: the chase, or Escape Mode (the same French, the roles switched). */
export interface Playable {
  player: Mover;
  update(dt: number): ChaseEvent[];
  toggleMode(): { result: ModeChangeResult; events: ChaseEvent[] };
  answerSighting(choice: number): ChaseEvent[];
}

export class ListenerBot {
  private heard: { at: number; seq: number; transmission: Transmission }[] = [];
  private seq = 0;
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
    /** Seconds between hearing a call and acting on it (listening + thinking time). */
    private readonly reaction = 1.2,
  ) {}

  hear(events: ChaseEvent[]): void {
    for (const e of events) {
      if (e.type === 'TRANSMISSION') {
        this.heard.push({ at: this.time + this.reaction, seq: this.seq++, transmission: e.transmission });
        this.log.push(e.transmission);
      } else if (e.type === 'ANNOUNCE') {
        for (const line of e.lines) {
          if (line.audioId === TRANSPORT_LINES.GET_OUT.audioId || line.audioId === TRANSPORT_LINES.GET_IN.audioId) {
            this.orders.push({ at: this.time + this.reaction, audioId: line.audioId });
          }
          if (line.audioId === EVENT_LINES.CHANGED_DIRECTION.audioId) {
            this.changes.push({ at: this.time + this.reaction, before: this.seq });
          }
          const told = VEHICLES.find((v) => vehicleLine(v).audioId === line.audioId);
          if (told) this.vehicle = told;
        }
      } else if (e.type === 'SIGHTING') {
        this.question = { at: this.time + this.reaction, cards: e.cards, audioId: e.line.audioId };
      }
    }
  }

  /** Act, then advance the chase by dt. */
  step(chase: Playable, dt: number): ChaseEvent[] {
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
      this.tasks = [];
      this.heard = this.heard.filter((h) => h.seq >= change.before);
      player.clearQueue();
    }
    while (this.heard.length > 0 && (this.heard[0]?.at ?? Infinity) <= this.time) {
      const { transmission } = this.heard.shift()!;
      for (const instruction of transmission.instructions) {
        for (const clause of instruction.clauses) {
          if (clause.action === 'WRONG_STREET') {
            this.tasks = [];
            player.clearQueue();
          } else if (clause.action === 'U_TURN') {
            player.uTurn();
          } else if (clause.action !== 'STRAIGHT' && clause.action !== 'CONTINUE_UNTIL') {
            this.tasks.push({ clause, count: 0, travelled: 0, queued: false });
          }
        }
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
      if (task.queued) {
        if (me.queued === null) this.tasks.shift(); // the turn has been made
      } else if (this.ready(task, chase, passedNode, arrivedBy)) {
        const side = task.clause.action === 'ROUNDABOUT_EXIT' ? 'RIGHT' : (task.clause as { side: 'LEFT' | 'RIGHT' }).side;
        player.queue(side);
        task.queued = true;
      }
    }
    const events = chase.update(dt);
    this.hear(events);
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
