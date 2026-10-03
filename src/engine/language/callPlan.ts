/**
 * Planning directions so every one is heard out before its junction, at full
 * speed (Mr Henry, 2026-10-03: the car must never pass the corner before the
 * scanner has finished, and the chase must never slow down for it).
 *
 * The scanner says the next turn just after the junction before it (on foot,
 * a few seconds before the turn). From there the car covers road at its
 * cruising speed while the call is said; a call fits when each step it gives
 * has been said, and the player has had time to react, before that step's
 * junction. Two turns close together cannot each have their own call in
 * time, so the first call must give both ("…, puis …", "D'abord … Ensuite …"),
 * or a route with them is not used. `planCalls` works this out for a whole
 * guide, so routes can be chosen that can always be called in time, and the
 * navigator can pick, among the calls that fit now, one that leaves the rest
 * of the route callable too.
 */

import type { Difficulty } from '../difficulty';
import type { MoverStart } from '../movement/mover';
import { MOVEMENT } from '../movement/settings';
import type { TownGraph, TravelMode } from '../world/graph';
import { actionIndices, instructionOptions, positionLeaving, type AudioCheck, type Guided } from './generate';
import { SPEECH } from './settings';
import { neededSeconds } from './timing';

export interface CallContext {
  mode: TravelMode;
  difficulty: Difficulty;
  hasAudio: AudioCheck;
  /** Metres per second the player covers while listening. */
  speed: number;
  /**
   * When a call for a junction is given, by distance (metres) to it: not
   * before `leadDistance` unless waiting for the next node would leave less
   * than `minLeadDistance` (see Navigator.leadDistance). Infinity: just after
   * the junction before it.
   */
  leadDistance: number;
  minLeadDistance: number;
  /** The first call is heard before the chase starts (the opening call), so it always has time. */
  firstCallBeforeStart?: boolean;
}

/** The usual context for a mode: its cruising speed, and the navigator's call lead (cars: none; on foot, set by the chase). */
export function callContext(
  mode: TravelMode,
  difficulty: Difficulty,
  hasAudio: AudioCheck,
  lead?: { leadDistance: number; minLeadDistance: number },
  firstCallBeforeStart = false,
): CallContext {
  return {
    firstCallBeforeStart,
    mode,
    difficulty,
    hasAudio,
    speed: MOVEMENT[mode].cruise,
    leadDistance: lead?.leadDistance ?? Infinity,
    minLeadDistance: lead?.minLeadDistance ?? 0,
  };
}

/** Road distances along a guide, so the distance from any node to any later one is a subtraction. */
function cumulative(graph: TownGraph, guide: readonly string[]): number[] {
  const out = [0];
  for (let i = 1; i < guide.length; i++) {
    const edge = graph.edgeBetween(guide[i - 1] as string, guide[i] as string);
    out.push((out[i - 1] as number) + (edge ? graph.edgeLength(edge) : 0));
  }
  return out;
}

/** Does this call fit when given with `ahead(i)` metres to go to guide node i, after `delay` seconds of waiting? */
export function fits(option: Guided, ahead: (index: number) => number, speed: number, delay = 0): boolean {
  const needed = neededSeconds([option.instruction], delay);
  return option.covers.every((index, j) => ahead(index) >= speed * (needed[j] ?? Infinity));
}

/** How many seconds too late the latest step of this call would be heard (≤ 0: in time). */
export function lateness(option: Guided, ahead: (index: number) => number, speed: number, delay = 0): number {
  const needed = neededSeconds([option.instruction], delay);
  return Math.max(...option.covers.map((index, j) => (needed[j] ?? 0) - ahead(index) / speed));
}

export interface CallPlanner {
  /** The guide's action indices (junctions where the player must turn). */
  actions: number[];
  /**
   * Can every action from the k-th one on be called in time, the k-th one's
   * call being given at its usual place (just after the action before it)?
   */
  solvable(k: number): boolean;
  /** As `solvable`, with the k-th action's call starting `delay` seconds late (after something else said first). */
  solvableAfter(k: number, delay: number): boolean;
}

/**
 * Plans the calls for a guide (see the module comment). Calls for the k-th
 * action are tried where the navigator would give them: just after the action
 * before it (or at a later node, on foot, or where no sentence is clear yet).
 */
export function planCalls(graph: TownGraph, guide: readonly string[], ctx: CallContext): CallPlanner {
  const actions = actionIndices(graph, guide, ctx.mode);
  const along = cumulative(graph, guide);
  const memo = new Map<number, boolean>();

  /** Can the k-th action's call fit at its usual place, `delay` seconds late, with the rest solvable after it? */
  const tryCall = (k: number, delay: number): boolean => {
    const a = actions[k] as number;
    for (let n = k === 0 ? 0 : (actions[k - 1] as number); n < a; n++) {
      const toJunction = (along[a] as number) - (along[n] as number);
      const fromNext = (along[a] as number) - (along[n + 1] as number);
      // On foot, calls wait until the runner is near (as the navigator does).
      if (toJunction > ctx.leadDistance && n + 1 < a && fromNext >= ctx.minLeadDistance) continue;
      const from = positionLeaving(graph, guide[n] as string, guide[n + 1] as string, ctx.mode);
      const options = instructionOptions(graph, from, guide, a, actions.slice(k + 1, k + 3), ctx.difficulty, ctx.hasAudio);
      if (options.length === 0) continue; // no clear sentence yet: the next node
      const ahead = (index: number) => (along[knownBy(graph, guide, index, n, ctx.mode)] as number) - (along[n] as number);
      // Only a call said before the start (at the first node) is the opening call.
      const opening = k === 0 && n === 0 && ctx.firstCallBeforeStart === true && delay === 0;
      return options.some((o) => (opening || fits(o, ahead, ctx.speed, delay + SPEECH.planSlackSeconds)) && solvable(k + o.covers.length));
    }
    return false;
  };

  const solvable = (k: number): boolean => {
    if (k >= actions.length) return true;
    const known = memo.get(k);
    if (known !== undefined) return known;
    memo.set(k, false); // no cycles, but be safe
    const result = tryCall(k, 0);
    memo.set(k, result);
    return result;
  };
  const solvableAfter = (k: number, delay: number): boolean => (k >= actions.length ? true : tryCall(k, delay));
  return { actions, solvable, solvableAfter };
}

/** Can every turn of this route be called in time, by a player following it at cruising speed? */
export function callable(graph: TownGraph, nodes: readonly string[], ctx: CallContext): boolean {
  return planCalls(graph, nodes, ctx).solvable(0);
}

/**
 * A guide planned from where the player is (on its first edge, `player`),
 * the first call starting after `delay` seconds (the radio is busy, or the
 * player turns round first): can that call be heard in time, and every call
 * after it?
 */
export function callableFrom(graph: TownGraph, guide: readonly string[], player: MoverStart, delay: number, ctx: CallContext): boolean {
  const plan = planCalls(graph, guide, ctx);
  const first = plan.actions[0];
  if (first === undefined) return true;
  const ahead = aheadFrom(graph, guide, 0, player);
  const options = instructionOptions(graph, player, guide, first, plan.actions.slice(1, 3), ctx.difficulty, ctx.hasAudio);
  // No clear sentence from here yet: it will come at a node further on, as planned.
  if (options.length === 0) return plan.solvable(0);
  return options.some((o) => fits(o, ahead, ctx.speed, delay) && plan.solvable(o.covers.length));
}

/** Distance (metres) from a position on the guide's edge `progress` → `progress + 1` to each later guide node. */
export function aheadFrom(graph: TownGraph, guide: readonly string[], progress: number, player: MoverStart): (index: number) => number {
  const along = cumulative(graph, guide);
  const edge = graph.edge(player.edgeId);
  const t = player.towards === edge.to ? player.t : 1 - player.t;
  const done = t * graph.edgeLength(edge);
  return (index: number) => {
    if (index <= progress) return -Infinity;
    return (along[knownBy(graph, guide, index, progress, player.mode)] as number) - (along[progress] as number) - done;
  };
}

/**
 * The guide index by which the step at `index` must have been heard: a
 * roundabout exit by the ring's entry, where the exits start being counted
 * (unless the player is already past it, after `from`); any other turn, its junction.
 * On foot a roundabout is ordinary crossings: each turn is at its own junction.
 */
export function knownBy(graph: TownGraph, guide: readonly string[], index: number, from: number, mode: TravelMode): number {
  const ring = mode === 'CAR' ? graph.node(guide[index] as string).roundaboutId : undefined;
  if (ring === undefined) return index;
  let j = index;
  while (j > 0 && graph.node(guide[j - 1] as string).roundaboutId === ring) j--;
  return j > from ? j : index;
}
