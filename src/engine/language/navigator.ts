/**
 * The scanner's navigator: decides what the police radio says, and when.
 *
 * It keeps a "guide" (the road the player should follow: the suspect's route,
 * or a way back onto it after a mistake) and watches the player's position:
 *
 *   - For the next junction where the player must act, it asks the generator
 *     for a true, unambiguous sentence from where the player is now. If none
 *     exists yet (for example "Tournez à gauche" while an earlier left turn is
 *     still ahead), it says "Continuez tout droit." and asks again after each
 *     junction, so the right sentence comes as soon as it is fair.
 *   - If the player leaves the guide, it says "Ce n'est pas la bonne rue."
 *     (and "Faites demi-tour." when turning round is the best way back) and
 *     plans a new guide that rejoins the suspect's route.
 *
 * Pure engine code: it reads positions and returns transmissions to play.
 */

import type { Difficulty } from '../difficulty';
import type { MoverStart } from '../movement/mover';
import type { Rng } from '../rng/prng';
import { canTravel, type TownGraph, type TravelMode } from '../world/graph';
import { distance, lerp } from '../world/geometry';
import { followProblem, pathLength } from '../chase/route';
import {
  actionIndices,
  describable,
  finalInstruction,
  instructionOptions,
  pickInstruction,
  straightOn,
  type AudioCheck,
  type Guided,
} from './generate';
import { aheadFrom, callableFrom, fits, lateness, planCalls, type CallContext, type CallPlanner } from './callPlan';
import { callSeconds } from './timing';
import { SPEECH } from './settings';
import { MOVEMENT } from '../movement/settings';
import { exitsAt } from '../movement/turns';
import { makeInstruction, type Instruction } from './instructions';

/** RECOVERY answers a wrong turn; CORRECTION follows the suspect changing direction ("Faites demi-tour."). */
export type TransmissionKind = 'DIRECTION' | 'FILLER' | 'RECOVERY' | 'CORRECTION' | 'FINAL';

export interface Transmission {
  id: number;
  kind: TransmissionKind;
  /** One or more instructions played back to back in one radio call. */
  instructions: Instruction[];
  text: string;
  /** For a direction: the junction it is about (the first turn it covers). */
  at?: string;
}

/** Driving this far past the end of the route (where the suspect stops) counts as overshooting. */
const OVERSHOOT = 60;

/** Turning round must save at least this much road to be preferred over driving on. */
const U_TURN_PENALTY = 40;

/**
 * Reaching the suspect's route this far (metres of road) ahead of the suspect
 * still catches it as it comes through. Any earlier and the player would be
 * leading a suspect that never stops: as bad as being that far behind it.
 */
const EARLY_ARRIVAL = 30;

/** At most this many streets go by after a wrong turn before the way back is given, in time or not. */
const MAX_DEFERRALS = 2;

/** A way back should share at least this much of the suspect's route (metres). */
const SHARED_ROUTE = 150;

/** Reaching the suspect's route this far (metres) ahead of it is leading it: a last resort. */
const LEADING = 120;

export class Navigator {
  /** Nodes the player should follow; the player is on the edge guide[progress] → guide[progress + 1]. */
  guide: string[];
  progress = 0;
  private actions: number[];
  private covered = new Set<number>();
  /**
   * No call covers a step past this guide index (null: no limit). Before a
   * change of direction, the directions stop where it will be said: calls past
   * there would only be taken back, and would keep the radio busy.
   */
  holdAfter: number | null = null;
  /** The next call is planned for a player held still until its first step is heard. */
  private heldForCall = false;
  /** Streets driven on since a wrong turn without a way back given yet (see recover). */
  private deferrals = 0;
  private fillerFor: number | null = null;
  private finalDone = false;
  private started = false;
  /** Set after "Faites demi-tour": the position the player is expected to turn round from. */
  private awaiting: { edgeId: string; towards: string } | null = null;
  /** An edge where no way back could be planned: wait until the player leaves it before trying again. */
  private stuckOn: string | null = null;
  /** The roundabout where a way back has already been given: going round it again gets no new one until the player leaves it. */
  private ringRecovered: string | null = null;
  private nextId = 1;
  readonly history: Transmission[] = [];
  /** Prefer calls with at least this many turns, when the map allows (the chase is about to lose the signal). */
  preferSteps = 0;
  /**
   * Directions wait until the player is this close (metres) to the junction,
   * set each frame by the chase. They are only ever given just after passing a
   * node, never mid-street (a call just before a side street would make
   * "la deuxième rue" unclear); one that would otherwise come later than
   * `minLeadDistance` before the junction is given a node early.
   */
  leadDistance = Infinity;
  minLeadDistance = 0;
  private spoken = false;
  /**
   * Timing (see callPlan.ts): the player's speed (metres per second, set each
   * frame by the chase) and how long until the radio is free. A direction is
   * only given once the radio is free, so it is heard from where it was
   * meant, and only one that is heard out before its junctions; among those,
   * one that leaves the rest of the route callable in time.
   */
  speed: number;
  radioFreeIn = 0;
  /** The very first call is the opening call, heard before the chase starts (no hurry). */
  firstCallBeforeStart = false;
  /** A direction is waiting for the radio to be free. */
  private deferred = false;
  private calls: CallPlanner | null = null;

  constructor(
    private readonly graph: TownGraph,
    private readonly difficulty: Difficulty,
    private readonly rng: Rng,
    route: readonly string[],
    /** Where the suspect is heading, or null when this stage ends at a change of transport (no final line). */
    private destination: string | null,
    private readonly mode: TravelMode = 'CAR',
    /** Only sentences with a recording may be used (all, until audio is loaded). */
    private readonly hasAudio: AudioCheck = () => true,
  ) {
    this.guide = [...route];
    this.actions = actionIndices(graph, this.guide, mode);
    this.speed = MOVEMENT[mode].cruise;
  }

  /**
   * The suspect drives on past the end of its route (it never waits): the
   * guide grows by `nodes`, which start at its last node, towards a new
   * destination. Directions already given stand; the next ones follow the
   * longer route. False when the guide ends elsewhere (the player is being
   * led back onto the route, and that plan already has the longer route).
   */
  extend(player: MoverStart, nodes: readonly string[], destination: string | null): Transmission[] | null {
    if (nodes[0] !== this.guide[this.guide.length - 1]) return null;
    this.guide.push(...nodes.slice(1));
    this.actions = actionIndices(this.graph, this.guide, this.mode);
    this.calls = null;
    this.destination = destination;
    this.finalDone = false;
    this.fillerFor = null;
    // The next turn may be close: say it now rather than at the next node.
    const out: Transmission[] = [];
    if (this.onGuide(player)) this.schedule(player, out);
    return out;
  }

  /**
   * The suspect will leave its route at `at`, a junction ahead that no call
   * has mentioned yet, and go on by `nodes` (starting at `at`): the directions
   * already given stand, the next ones follow the new way. Null if `at` is
   * not such a junction.
   */
  reroute(player: MoverStart, at: string, nodes: readonly string[], destination: string | null): Transmission[] | null {
    if (!this.canReroute(at) || nodes[0] !== at) return null;
    const index = this.guide.lastIndexOf(at);
    this.guide.splice(index + 1, this.guide.length, ...nodes.slice(1));
    this.actions = actionIndices(this.graph, this.guide, this.mode);
    this.calls = null;
    this.destination = destination;
    this.fillerFor = null;
    const out: Transmission[] = [];
    if (this.onGuide(player)) this.schedule(player, out);
    return out;
  }

  /** Is `at` a junction ahead on the guide that no call has mentioned yet (see reroute)? */
  canReroute(at: string): boolean {
    const index = this.guide.lastIndexOf(at);
    const lastCovered = Math.max(-1, ...this.covered);
    return !this.finalDone && index > this.progress && index > lastCovered && index < this.guide.length - 1;
  }

  /** The most recent transmission (for the Repeat button). */
  get last(): Transmission | undefined {
    return this.history[this.history.length - 1];
  }

  /**
   * Call every frame with where the player and the suspect are. `suspectRoute`
   * is the rest of the suspect's route, starting with the node it is heading to.
   */
  update(player: MoverStart, suspectRoute: readonly string[]): Transmission[] {
    const out: Transmission[] = [];
    if (!this.started) {
      this.started = true;
      this.schedule(player, out);
      return out;
    }
    const before = this.progress;
    if (this.onGuide(player)) {
      // After a U-turn the player is back on the guide: give the next direction straight away.
      const turnedRound = this.awaiting !== null;
      this.awaiting = null;
      if (this.progress !== before || turnedRound || (this.deferred && this.radioFreeIn <= 0)) this.schedule(player, out);
      return out;
    }
    if (this.awaiting && this.awaiting.edgeId === player.edgeId && this.awaiting.towards === player.towards) return out;
    if (this.justPastEnd(player)) return out;
    if (this.stuckOn === player.edgeId) return out;
    // Round a roundabout, each stretch of the ring is a new street: one way back
    // per visit, not "Ce n'est pas la bonne rue" at every exit passed.
    const ring = this.ringOf(player);
    if (ring === null) this.ringRecovered = null;
    else if (ring === this.ringRecovered) return out;
    this.recover(player, suspectRoute, out);
    if (ring !== null) this.ringRecovered = ring;
    return out;
  }

  /** The roundabout whose ring the player is driving round, or null. */
  private ringOf(player: MoverStart): string | null {
    const edge = this.graph.edge(player.edgeId);
    const a = this.graph.node(edge.from).roundaboutId;
    return a && a === this.graph.node(edge.to).roundaboutId ? a : null;
  }

  /**
   * While the signal is lost: follow where the player goes without saying
   * anything. Returns true while the player is still on the guide.
   */
  track(player: MoverStart): boolean {
    return this.onGuide(player);
  }

  /** Where a player following the guide will be after `metres` more of it (where they are, when off it). */
  pointAhead(player: MoverStart, metres: number): { x: number; y: number } {
    const edge = this.graph.edge(player.edgeId);
    const here = lerp(this.graph.node(edge.from), this.graph.node(edge.to), player.t);
    const progress = this.progressAt(player);
    if (progress === -1) return here;
    let at = here;
    let left = metres;
    for (let k = progress + 1; k < this.guide.length; k++) {
      const next = this.graph.node(this.guide[k] as string);
      const d = distance(at, next);
      if (d >= left) return lerp(at, next, left / Math.max(d, 1e-6));
      left -= d;
      at = next;
    }
    return at;
  }

  /**
   * Would the scanner have something new to say here: the player is off the
   * guide, or the next junction has not been covered by a call yet?
   */
  hasNews(player: MoverStart): boolean {
    const progress = this.progressAt(player);
    if (progress === -1) return true;
    const next = this.actions.find((a) => a > progress);
    return next === undefined ? !this.finalDone && this.destination !== null : !this.covered.has(next);
  }

  /**
   * Seconds before the scanner next needs the radio (0 when it has news now):
   * the next call comes on passing the last junction already called. Other
   * lines fit in that gap without making a direction late.
   */
  quietFor(player: MoverStart): number {
    const progress = this.progressAt(player);
    if (progress === -1) return 0;
    const next = this.actions.findIndex((a) => a > progress && !this.covered.has(a));
    let callAt: number;
    if (next === -1) {
      if (this.finalDone || this.destination === null) return Infinity;
      callAt = this.actions[this.actions.length - 1] ?? -1; // the final call follows the last turn
    } else {
      callAt = next === 0 ? -1 : (this.actions[next - 1] as number);
    }
    if (callAt <= progress) return 0;
    return Math.max(0, this.distanceTo(player, callAt, progress) / this.speed - Math.max(0, this.radioFreeIn));
  }

  /** Is the player off the guide (lost, or not yet turned round)? */
  isOffGuide(player: MoverStart): boolean {
    return !this.onGuide(player);
  }

  /**
   * The player has stopped at a junction and is waiting, or is lost with nothing said for a while: say what to do from
   * here, the last direction again while they are on the guide, or (off it)
   * a fresh way back, even if none could be found on this street before.
   */
  prompt(player: MoverStart, suspectRoute: readonly string[]): Transmission[] {
    const out: Transmission[] = [];
    if (this.onGuide(player)) {
      const last = this.last;
      if (last) {
        this.radioFreeIn = Math.max(0, this.radioFreeIn) + callSeconds(last.instructions.flatMap((i) => i.clips.map((c) => c.text)));
        out.push(last);
      }
      return out;
    }
    this.stuckOn = null;
    this.awaiting = null;
    this.ringRecovered = null;
    this.deferrals = MAX_DEFERRALS; // stopped: there is room to turn round now
    this.recover(player, suspectRoute, out);
    return out;
  }

  /** The signal is back: say what the player needs now (the next direction, or a way back). */
  resume(player: MoverStart, suspectRoute: readonly string[]): Transmission[] {
    const out: Transmission[] = [];
    if (this.onGuide(player)) {
      this.awaiting = null;
      this.schedule(player, out);
    } else if (!this.justPastEnd(player)) {
      this.recover(player, suspectRoute, out);
    }
    return out;
  }

  /**
   * Road distance from the player to a junction ahead on the guide (by guide
   * index, or node ID), or Infinity when it is not ahead on the guide.
   */
  /** Road distance from the player to the end of the guide (Infinity when off it). */
  toGuideEnd(player: MoverStart): number {
    const progress = this.progressAt(player);
    return progress === -1 ? Infinity : this.distanceTo(player, this.guide.length - 1, progress);
  }

  distanceTo(player: MoverStart, target: number | string, progress = this.progress): number {
    const index = typeof target === 'number' ? target : this.guide.indexOf(target, progress + 1);
    if (index <= progress) return Infinity;
    const edge = this.graph.edge(player.edgeId);
    if (player.towards !== this.guide[progress + 1]) return Infinity;
    const along = player.towards === edge.to ? player.t : 1 - player.t;
    const rest = (1 - along) * this.graph.edgeLength(edge);
    return rest + pathLength(this.graph, this.guide.slice(progress + 1, index + 1));
  }

  /** Is the player where the guide expects (moving forward along it)? Advances `progress` if so. */
  private onGuide(player: MoverStart): boolean {
    const k = this.progressAt(player);
    if (k === -1) return false;
    this.progress = k;
    return true;
  }

  /** The guide edge the player is on, moving forward (-1 when off the guide). Changes nothing. */
  private progressAt(player: MoverStart): number {
    const last = Math.min(this.progress + 4, this.guide.length - 2);
    for (let k = this.progress; k <= last; k++) {
      const edge = this.graph.edgeBetween(this.guide[k] as string, this.guide[k + 1] as string);
      if (edge?.id === player.edgeId && player.towards === this.guide[k + 1]) return k;
    }
    return -1;
  }

  /** Just past the last node (usually driving up to the stopped suspect): not a mistake yet. */
  private justPastEnd(player: MoverStart): boolean {
    const edge = this.graph.edge(player.edgeId);
    const origin = this.graph.other(edge, player.towards);
    if (origin !== this.guide[this.guide.length - 1]) return false;
    const along = (origin === edge.from ? player.t : 1 - player.t) * this.graph.edgeLength(edge);
    return along < OVERSHOOT;
  }

  /**
   * Say the next thing the player needs, if it has not been said yet. With
   * `wait`, a direction waits for the radio to be free (the update after it
   * is free gives it); without, it is timed to start when the radio is free.
   */
  private schedule(player: MoverStart, out: Transmission[], wait = true): void {
    const pos = player;
    this.deferred = false;
    const nextIndex = this.actions.findIndex((a) => a > this.progress);
    if (nextIndex === -1) {
      if (!this.finalDone && this.destination !== null) {
        if (wait && this.radioFreeIn > 0) {
          this.deferred = true;
          return;
        }
        this.finalDone = true;
        const final = finalInstruction(this.graph, pos, this.guide, this.destination, this.difficulty, this.rng, this.hasAudio);
        if (final) this.emit('FINAL', [final], out);
      }
      return;
    }
    const a = this.actions[nextIndex] as number;
    if (this.covered.has(a)) return;
    if (this.holdAfter !== null && a > this.holdAfter) return;
    if (this.spoken && this.tooEarly(pos, a)) return;
    if (wait && this.radioFreeIn > 0) {
      this.deferred = true;
      return;
    }
    const delay = wait ? 0 : Math.max(0, this.radioFreeIn);
    const options = instructionOptions(
      this.graph,
      pos,
      this.guide,
      a,
      this.actions.slice(nextIndex + 1, nextIndex + 3),
      this.difficulty,
      this.hasAudio,
    );
    const allowed = this.holdAfter === null ? options : options.filter((o) => o.covers.every((c) => c <= this.holdAfter!));
    const guided = pickInstruction(this.timely(allowed, pos, nextIndex, delay), this.difficulty, this.rng, this.preferSteps);
    if (guided) {
      for (const c of guided.covers) this.covered.add(c);
      this.emit('DIRECTION', [guided.instruction], out, this.guide[a]);
      return;
    }
    if (this.fillerFor !== a) {
      this.fillerFor = a;
      const filler = straightOn(this.graph, pos, this.guide, this.difficulty, this.hasAudio);
      // Only when it is over before the next node, where the real direction may be due.
      const toNext = this.distanceTo(pos, this.progress + 1);
      if (filler && toNext >= this.speed * (delay + callSeconds([filler.text]))) this.emit('FILLER', [filler], out);
    }
  }

  /**
   * The options heard out in time, preferring those that leave the rest of the
   * guide callable in time (see callPlan.ts). If none is in time (the player
   * is already close, after a wrong turn), the one that is least late.
   */
  private timely(options: Guided[], pos: MoverStart, nextIndex: number, delay: number): Guided[] {
    if (options.length === 0) return options;
    // The opening call is heard before the chase starts: any call is in time.
    const opening = !this.spoken && this.firstCallBeforeStart;
    const ahead = aheadFrom(this.graph, this.guide, this.progress, pos);
    const inTime = opening ? options : options.filter((o) => fits(o, ahead, this.speed, delay, this.heldForCall));
    if (inTime.length > 0) {
      this.calls ??= planCalls(this.graph, this.guide, this.callContext());
      const k = this.calls.actions.indexOf(this.actions[nextIndex] as number);
      const onward = k === -1 ? [] : inTime.filter((o) => this.calls!.solvable(k + o.covers.length));
      return onward.length > 0 ? onward : inTime;
    }
    const late = options.map((o) => lateness(o, ahead, this.speed, delay));
    const least = Math.min(...late);
    return options.filter((_, i) => (late[i] as number) <= least + 0.05);
  }

  /** Could a new guide from here have every call heard in time, its first call after the radio is free? */
  canCallInTime(guide: readonly string[], player: MoverStart, extraDelay = 0, held = false): boolean {
    return callableFrom(this.graph, guide, player, Math.max(0, this.radioFreeIn) + extraDelay, this.callContext(), held);
  }

  /** Would a new way onto the suspect's route (see redirect) be called in time, after `extraDelay` more seconds of radio? */
  canRedirectInTime(player: MoverStart, suspectRoute: readonly string[], extraDelay = 0): boolean {
    const timing = { ctx: this.callContext(), delay: Math.max(0, this.radioFreeIn) + extraDelay };
    const plan = this.planner(this.graph, player, suspectRoute, this.difficulty, timing);
    return plan !== null && timely(this.graph, plan.guide, player, plan.uTurn, timing);
  }

  private callContext(): CallContext {
    return {
      mode: this.mode,
      difficulty: this.difficulty,
      hasAudio: this.hasAudio,
      speed: this.speed,
      leadDistance: this.leadDistance,
      minLeadDistance: this.minLeadDistance,
    };
  }

  /** The player has left the guide: say so, and plan a way back to the suspect. */
  private recover(player: MoverStart, suspectRoute: readonly string[], out: Transmission[]): void {
    const edge = this.graph.edge(player.edgeId);
    const origin = this.graph.other(edge, player.towards);
    const fromIndex = this.guide.indexOf(origin);
    const onGuideEdge = this.guide.some(
      (n, i) => i < this.guide.length - 1 && this.graph.edgeBetween(n, this.guide[i + 1] as string)?.id === edge.id,
    );
    const wrongStreet = !onGuideEdge && fromIndex !== -1 && fromIndex < this.guide.length - 1;

    const { plan, timing } = this.replan(player, suspectRoute, wrongStreet);
    const lines: Instruction[] = [];
    if (wrongStreet) lines.push(makeInstruction([{ action: 'WRONG_STREET' }], this.difficulty));
    // (Only where the player drives on: at a junction with no way straight on they stop, and can turn round there.)
    const drivesOn = exitsAt(this.graph, edge, player.towards, player.mode).some((e) => e.kind === 'STRAIGHT');
    if (plan?.uTurn && drivesOn && this.deferrals < MAX_DEFERRALS && !timely(this.graph, plan.guide, player, true, timing)) {
      // Too close to the end of this street to turn round once told: say only that it
      // is the wrong street, and give the way back from the next street, where there is room.
      if (lines.length > 0) this.emit('RECOVERY', lines, out);
      this.stuckOn = player.edgeId;
      this.deferrals++;
      return;
    }
    this.deferrals = 0;
    if (plan?.uTurn) lines.push(makeInstruction([{ action: 'U_TURN' }], this.difficulty));
    if (lines.length > 0) this.emit('RECOVERY', lines, out);
    this.stuckOn = plan ? null : player.edgeId;
    if (!plan) return;
    // The way back follows straight on in the same call.
    this.useGuide(plan, player, out, false);
  }

  /**
   * The suspect has changed direction (template X3): forget the predicted
   * route, plan a new guide from the player onto the suspect's real one, and
   * give the first corrected direction ("Faites demi-tour." first if needed).
   */
  redirect(
    player: MoverStart,
    suspectRoute: readonly string[],
    destination: string | null,
    /** The new guide, when the player is still on it (starting with the edge they are on). */
    guide?: readonly string[],
    /** The guide starts by turning round on that edge ("Faites demi-tour."). */
    turnRound = false,
    /** The player is held still until the first step of the correction is heard (after a dodge). */
    held = false,
  ): Transmission[] {
    const out: Transmission[] = [];
    this.destination = destination;
    // (A correction is not "Ce n'est pas la bonne rue.": its first call follows what the radio is saying.)
    const timing = { ctx: this.callContext(), delay: Math.max(0, this.radioFreeIn) };
    const plan = guide
      ? { guide: [...guide], uTurn: turnRound }
      : this.planner(this.graph, player, suspectRoute, this.difficulty, timing);
    if (!plan) return out; // off the guide now: the usual recovery takes over
    if (plan.uTurn) this.emit('CORRECTION', [makeInstruction([{ action: 'U_TURN' }], this.difficulty)], out);
    // The player is held still for a correction: it is said straight away (after any call before it).
    this.heldForCall = held;
    this.useGuide(plan, player, out, false);
    this.heldForCall = false;
    return out;
  }

  private useGuide(plan: { guide: string[]; uTurn: boolean }, player: MoverStart, out: Transmission[], wait = true): void {
    this.guide = plan.guide;
    this.progress = 0;
    this.holdAfter = null; // a new guide: the old one's indices no longer apply
    this.actions = actionIndices(this.graph, this.guide, player.mode);
    this.calls = null;
    this.covered.clear();
    this.fillerFor = null;
    this.finalDone = false;
    if (plan.uTurn) {
      this.awaiting = { edgeId: player.edgeId, towards: player.towards };
      // The way back follows "Faites demi-tour." at once, so it is heard while turning round.
      const edge = this.graph.edge(player.edgeId);
      this.schedule({ ...player, towards: this.graph.other(edge, player.towards) }, out, false);
    } else {
      this.awaiting = null;
      this.schedule(player, out, wait);
    }
  }

  /** How a way back is planned after a wrong turn: onto a moving suspect's route (default), or to a fixed destination. */
  planner: GuidePlanner = planGuide;

  private replan(player: MoverStart, suspectRoute: readonly string[], wrongStreet: boolean) {
    // The first direction of the way back comes after what the radio is saying and "Ce n'est pas la bonne rue. Faites demi-tour."
    const delay = Math.max(0, this.radioFreeIn) + callSeconds([...(wrongStreet ? ["Ce n'est pas la bonne rue."] : []), U_TURN_TEXT]);
    const timing: GuideTiming = { ctx: this.callContext(), delay, uTurnSaid: true };
    return { plan: this.planner(this.graph, player, suspectRoute, this.difficulty, timing), timing };
  }

  /** Is it too early for the direction about action `a` (see leadDistance)? The next node will do. */
  private tooEarly(player: MoverStart, a: number): boolean {
    const toJunction = this.distanceTo(player, a);
    if (toJunction <= this.leadDistance) return false;
    if (this.progress + 1 >= a) return false;
    const fromNext = toJunction - this.distanceTo(player, this.progress + 1);
    return fromNext >= this.minLeadDistance;
  }

  private emit(kind: TransmissionKind, instructions: Instruction[], out: Transmission[], at?: string): void {
    const transmission: Transmission = {
      id: this.nextId++,
      kind,
      instructions,
      text: instructions.map((i) => i.text).join(' '),
      ...(at ? { at } : {}),
    };
    this.history.push(transmission);
    this.spoken = true;
    this.radioFreeIn = Math.max(0, this.radioFreeIn) + callSeconds(instructions.flatMap((i) => i.clips.map((c) => c.text)));
    out.push(transmission);
  }
}

/** How the calls for a new guide will be timed: the guide is preferred when they can all be heard in time. */
export interface GuideTiming {
  ctx: CallContext;
  /** Seconds before its first call can start. */
  delay: number;
  /** `delay` already allows for saying "Faites demi-tour.". */
  uTurnSaid?: boolean;
}

export type GuidePlanner = (
  graph: TownGraph,
  player: MoverStart,
  route: readonly string[],
  difficulty: Difficulty,
  timing?: GuideTiming,
) => { guide: string[]; uTurn: boolean } | null;

/** Turning round takes about this long before the first call of the way back can count. */
const U_TURN_SECONDS = 1.5;

const U_TURN_TEXT = 'Faites demi-tour.';

/** Can the calls for this guide be heard in time (when timing is given)? */
function timely(graph: TownGraph, guide: readonly string[], player: MoverStart, uTurn: boolean, timing?: GuideTiming): boolean {
  if (!timing) return true;
  const edge = graph.edge(player.edgeId);
  if (uTurn) {
    // "Faites demi-tour." must be heard (and acted on) before the player reaches the end of the street.
    const left = (player.towards === edge.to ? 1 - player.t : player.t) * graph.edgeLength(edge);
    const heard = timing.delay + (timing.uTurnSaid ? 0 : callSeconds([U_TURN_TEXT])) + SPEECH.reactSeconds;
    if (left < timing.ctx.speed * heard) return false;
  }
  const from: MoverStart = uTurn ? { ...player, towards: graph.other(edge, player.towards) } : player;
  return callableFrom(graph, guide, from, timing.delay + (uTurn ? U_TURN_SECONDS : 0), timing.ctx);
}

/**
 * A guide from the player's position onto the suspect's route: either going
 * on, or turning round, whichever gets there closest behind the suspect (it
 * never stops, so getting there long before it means leading it, not catching
 * it). The guide starts with the edge the player is on (turned round when
 * `uTurn` is set).
 */
export function planGuide(
  graph: TownGraph,
  player: MoverStart,
  suspectRoute: readonly string[],
  difficulty: Difficulty,
  timing?: GuideTiming,
): { guide: string[]; uTurn: boolean } | null {
  const mode = player.mode;
  const edge = graph.edge(player.edgeId);
  const origin = graph.other(edge, player.towards);
  const length = graph.edgeLength(edge);
  const fromOrigin = (origin === edge.from ? player.t : 1 - player.t) * length;
  const blocked = new Set([edge.id]);

  const options: { first: [string, string]; lead: number; uTurn: boolean }[] = [
    { first: [origin, player.towards], lead: length - fromOrigin, uTurn: false },
  ];
  if (canTravel(edge, mode, player.towards)) {
    options.push({ first: [player.towards, origin], lead: fromOrigin + U_TURN_PENALTY, uTurn: true });
  }

  // Ways that can be called in time come first (late calls are a last resort).
  let best: { guide: string[]; uTurn: boolean; cost: number; inTime: boolean; late: boolean; rank: number } | null = null;
  for (const option of options) {
    const start = option.first[1];
    for (let k = 0; k < suspectRoute.length; k++) {
      const join = suspectRoute[k] as string;
      const path = start === join ? { nodes: [start], length: 0 } : graph.shortestPath(start, join, mode, blocked);
      if (!path) continue;
      // How far behind the suspect the player reaches the join (negative: ahead of it).
      const behind = option.lead + path.length - pathLength(graph, suspectRoute.slice(0, k + 1));
      // Joining near the end of the suspect's route is a last resort: where it goes on from there is not known yet.
      // ...and so is getting there well ahead of the suspect (leading it), even with every call in time.
      const late = timing !== undefined && (pathLength(graph, suspectRoute.slice(k)) < SHARED_ROUTE || behind < -LEADING);
      const cost = behind >= -EARLY_ARRIVAL ? Math.max(behind, 0) : -behind - EARLY_ARRIVAL;
      if (best && !best.late && best.inTime && (late || cost >= best.cost)) continue;
      const guide = [option.first[0], ...path.nodes, ...suspectRoute.slice(k + 1)];
      if (new Set(guide).size !== guide.length || followProblem(graph, guide, mode)) continue;
      if (!describable(graph, guide, mode, difficulty)) continue;
      const inTime = timely(graph, guide, player, option.uTurn, timing);
      // Sharing the suspect's route first, then calls heard in time, then arriving closest behind it.
      const rank = (late ? 2 : 0) + (inTime ? 0 : 1);
      const better = !best || rank < best.rank || (rank === best.rank && cost < best.cost);
      if (better) best = { guide, uTurn: option.uTurn, cost, inTime, late, rank };
    }
  }
  return best ? { guide: best.guide, uTurn: best.uTurn } : null;
}

/**
 * Escape Mode: a guide from the player's position to the end of `route` (the
 * hideout, which does not move): the shortest describable way that joins the
 * route somewhere and follows it to the end, going on or turning round.
 */
export function planEscapeGuide(
  graph: TownGraph,
  player: MoverStart,
  route: readonly string[],
  difficulty: Difficulty,
  timing?: GuideTiming,
): { guide: string[]; uTurn: boolean } | null {
  const mode = player.mode;
  const edge = graph.edge(player.edgeId);
  const origin = graph.other(edge, player.towards);
  const length = graph.edgeLength(edge);
  const fromOrigin = (origin === edge.from ? player.t : 1 - player.t) * length;
  const blocked = new Set([edge.id]);
  const options: { first: [string, string]; lead: number; uTurn: boolean }[] = [
    { first: [origin, player.towards], lead: length - fromOrigin, uTurn: false },
  ];
  if (canTravel(edge, mode, player.towards)) {
    options.push({ first: [player.towards, origin], lead: fromOrigin + U_TURN_PENALTY, uTurn: true });
  }
  let best: { guide: string[]; uTurn: boolean; cost: number; inTime: boolean } | null = null;
  for (const option of options) {
    const start = option.first[1];
    for (let k = 0; k < route.length; k++) {
      const join = route[k] as string;
      const path = start === join ? { nodes: [start], length: 0 } : graph.shortestPath(start, join, mode, blocked);
      if (!path) continue;
      const guide = [option.first[0], ...path.nodes, ...route.slice(k + 1)];
      if (new Set(guide).size !== guide.length || followProblem(graph, guide, mode)) continue;
      if (!describable(graph, guide, mode, difficulty)) continue;
      const cost = option.lead + path.length + pathLength(graph, route.slice(k));
      if (best && best.inTime && cost >= best.cost) continue;
      const inTime = timely(graph, guide, player, option.uTurn, timing);
      const better = !best || (inTime && !best.inTime) || (inTime === best.inTime && cost < best.cost);
      if (better) best = { guide, uTurn: option.uTurn, cost, inTime };
    }
  }
  return best ? { guide: best.guide, uTurn: best.uTurn } : null;
}
