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
import { followProblem, pathLength } from '../chase/route';
import { actionIndices, describable, finalInstruction, instructionFor, straightOn, type AudioCheck } from './generate';
import { makeInstruction, type Instruction } from './instructions';

/** RECOVERY answers a wrong turn; CORRECTION follows the suspect changing direction ("Faites demi-tour."). */
export type TransmissionKind = 'DIRECTION' | 'FILLER' | 'RECOVERY' | 'CORRECTION' | 'FINAL';

export interface Transmission {
  id: number;
  kind: TransmissionKind;
  /** One or more instructions played back to back in one radio call. */
  instructions: Instruction[];
  text: string;
}

/** Driving this far past the end of the route (where the suspect stops) counts as overshooting. */
const OVERSHOOT = 60;

/** Turning round must save at least this much road to be preferred over driving on. */
const U_TURN_PENALTY = 40;

export class Navigator {
  /** Nodes the player should follow; the player is on the edge guide[progress] → guide[progress + 1]. */
  guide: string[];
  progress = 0;
  private actions: number[];
  private covered = new Set<number>();
  private fillerFor: number | null = null;
  private finalDone = false;
  private started = false;
  /** Set after "Faites demi-tour": the position the player is expected to turn round from. */
  private awaiting: { edgeId: string; towards: string } | null = null;
  /** An edge where no way back could be planned: wait until the player leaves it before trying again. */
  private stuckOn: string | null = null;
  private nextId = 1;
  readonly history: Transmission[] = [];

  constructor(
    private readonly graph: TownGraph,
    private readonly difficulty: Difficulty,
    private readonly rng: Rng,
    route: readonly string[],
    /** Where the suspect is heading, or null when this stage ends at a change of transport (no final line). */
    private destination: string | null,
    mode: TravelMode = 'CAR',
    /** Only sentences with a recording may be used (all, until audio is loaded). */
    private readonly hasAudio: AudioCheck = () => true,
  ) {
    this.guide = [...route];
    this.actions = actionIndices(graph, this.guide, mode);
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
      if (this.progress !== before || turnedRound) this.schedule(player, out);
      return out;
    }
    if (this.awaiting && this.awaiting.edgeId === player.edgeId && this.awaiting.towards === player.towards) return out;
    if (this.justPastEnd(player)) return out;
    if (this.stuckOn === player.edgeId) return out;
    this.recover(player, suspectRoute, out);
    return out;
  }

  /** Is the player where the guide expects (moving forward along it)? Advances `progress` if so. */
  private onGuide(player: MoverStart): boolean {
    const last = Math.min(this.progress + 4, this.guide.length - 2);
    for (let k = this.progress; k <= last; k++) {
      const edge = this.graph.edgeBetween(this.guide[k] as string, this.guide[k + 1] as string);
      if (edge?.id === player.edgeId && player.towards === this.guide[k + 1]) {
        this.progress = k;
        return true;
      }
    }
    return false;
  }

  /** Just past the last node (usually driving up to the stopped suspect): not a mistake yet. */
  private justPastEnd(player: MoverStart): boolean {
    const edge = this.graph.edge(player.edgeId);
    const origin = this.graph.other(edge, player.towards);
    if (origin !== this.guide[this.guide.length - 1]) return false;
    const along = (origin === edge.from ? player.t : 1 - player.t) * this.graph.edgeLength(edge);
    return along < OVERSHOOT;
  }

  /** Say the next thing the player needs, if it has not been said yet. */
  private schedule(player: MoverStart, out: Transmission[]): void {
    const pos = player;
    const nextIndex = this.actions.findIndex((a) => a > this.progress);
    if (nextIndex === -1) {
      if (!this.finalDone && this.destination !== null) {
        this.finalDone = true;
        const final = finalInstruction(this.graph, pos, this.guide, this.destination, this.difficulty, this.rng, this.hasAudio);
        if (final) this.emit('FINAL', [final], out);
      }
      return;
    }
    const a = this.actions[nextIndex] as number;
    if (this.covered.has(a)) return;
    const guided = instructionFor(
      this.graph,
      pos,
      this.guide,
      a,
      this.actions.slice(nextIndex + 1, nextIndex + 3),
      this.difficulty,
      this.rng,
      this.hasAudio,
    );
    if (guided) {
      for (const c of guided.covers) this.covered.add(c);
      this.emit('DIRECTION', [guided.instruction], out);
      return;
    }
    if (this.fillerFor !== a) {
      this.fillerFor = a;
      const filler = straightOn(this.graph, pos, this.guide, this.difficulty, this.hasAudio);
      if (filler) this.emit('FILLER', [filler], out);
    }
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

    const plan = this.replan(player, suspectRoute);
    const lines: Instruction[] = [];
    if (wrongStreet) lines.push(makeInstruction([{ action: 'WRONG_STREET' }], this.difficulty));
    if (plan?.uTurn) lines.push(makeInstruction([{ action: 'U_TURN' }], this.difficulty));
    if (lines.length > 0) this.emit('RECOVERY', lines, out);
    this.stuckOn = plan ? null : player.edgeId;
    if (!plan) return;
    this.useGuide(plan, player, out);
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
  ): Transmission[] {
    const out: Transmission[] = [];
    this.destination = destination;
    const plan = guide ? { guide: [...guide], uTurn: false } : this.replan(player, suspectRoute);
    if (!plan) return out; // off the guide now: the usual recovery takes over
    if (plan.uTurn) this.emit('CORRECTION', [makeInstruction([{ action: 'U_TURN' }], this.difficulty)], out);
    this.useGuide(plan, player, out);
    return out;
  }

  private useGuide(plan: { guide: string[]; uTurn: boolean }, player: MoverStart, out: Transmission[]): void {
    this.guide = plan.guide;
    this.progress = 0;
    this.actions = actionIndices(this.graph, this.guide, player.mode);
    this.covered.clear();
    this.fillerFor = null;
    this.finalDone = false;
    if (plan.uTurn) {
      this.awaiting = { edgeId: player.edgeId, towards: player.towards };
    } else {
      this.awaiting = null;
      this.schedule(player, out);
    }
  }

  private replan(player: MoverStart, suspectRoute: readonly string[]): { guide: string[]; uTurn: boolean } | null {
    return planGuide(this.graph, player, suspectRoute, this.difficulty);
  }

  private emit(kind: TransmissionKind, instructions: Instruction[], out: Transmission[]): void {
    const transmission: Transmission = {
      id: this.nextId++,
      kind,
      instructions,
      text: instructions.map((i) => i.text).join(' '),
    };
    this.history.push(transmission);
    out.push(transmission);
  }
}

/**
 * A guide from the player's position onto the suspect's route: either going
 * on, or turning round, whichever gets there sooner. The guide starts with
 * the edge the player is on (turned round when `uTurn` is set).
 */
export function planGuide(
  graph: TownGraph,
  player: MoverStart,
  suspectRoute: readonly string[],
  difficulty: Difficulty,
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

  let best: { guide: string[]; uTurn: boolean; cost: number } | null = null;
  for (const option of options) {
    const start = option.first[1];
    for (let k = 0; k < suspectRoute.length; k++) {
      const join = suspectRoute[k] as string;
      const path = start === join ? { nodes: [start], length: 0 } : graph.shortestPath(start, join, mode, blocked);
      if (!path) continue;
      const guide = [option.first[0], ...path.nodes, ...suspectRoute.slice(k + 1)];
      if (new Set(guide).size !== guide.length || followProblem(graph, guide, mode)) continue;
      if (!describable(graph, guide, mode, difficulty)) continue;
      const cost = option.lead + path.length - pathLength(graph, suspectRoute.slice(0, k + 1));
      if (!best || cost < best.cost) best = { guide, uTurn: option.uTurn, cost };
      break;
    }
  }
  return best;
}
