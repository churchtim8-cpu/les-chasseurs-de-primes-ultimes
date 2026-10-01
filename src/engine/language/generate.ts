/**
 * French instruction generation (pipeline steps "GENERATE FRENCH" and
 * "VALIDATE FRENCH").
 *
 * The route comes first. For the next junction where the driver must act,
 * this lists every approved sentence that could describe it, keeps only the
 * ones the interpreter reads as exactly that junction and that turn (true AND
 * unambiguous), and picks one for the difficulty. If none passes yet, the
 * caller waits until the driver is closer and asks again.
 */

import type { Difficulty } from '../difficulty';
import type { MoverStart } from '../movement/mover';
import { exitsAt } from '../movement/turns';
import type { Rng } from '../rng/prng';
import type { TownGraph, TravelMode } from '../world/graph';
import { isAt, opensOn, passPoint, scanAhead } from './analysis';
import { interpret } from './interpret';
import { makeInstruction, ordinalWord, templateFor, type Clause, type Instruction } from './instructions';
import { LANGUAGE_SETTINGS } from './settings';

export interface Guided {
  instruction: Instruction;
  /** Indices (into the guide) of the actions this instruction covers. */
  covers: number[];
}

/** Position at the very start of the edge from `from` to `to`. */
export function positionLeaving(graph: TownGraph, from: string, to: string, mode: TravelMode): MoverStart {
  const edge = graph.edgeBetween(from, to);
  if (!edge) throw new Error(`No edge ${from}-${to}`);
  return { edgeId: edge.id, t: edge.from === from ? 0 : 1, towards: to, mode };
}

/**
 * Indices of the guide's nodes where the driver must do something: every
 * junction where the route does not simply carry straight on.
 */
export function actionIndices(graph: TownGraph, guide: readonly string[], mode: TravelMode): number[] {
  const out: number[] = [];
  for (let i = 1; i < guide.length - 1; i++) {
    const arrived = graph.edgeBetween(guide[i - 1] as string, guide[i] as string);
    if (!arrived) continue;
    const exits = exitsAt(graph, arrived, guide[i] as string, mode);
    if (exits.length <= 1) continue;
    const exit = exits.find((e) => e.step.to === guide[i + 1]);
    if (exit && exit.kind !== 'STRAIGHT') out.push(i);
  }
  return out;
}

/**
 * For each roundabout on a node path, which exit it leaves by (1 = first exit
 * after entering). Used to keep routes within the ordinals a level may use.
 */
export function roundaboutExits(graph: TownGraph, nodes: readonly string[], mode: TravelMode): number[] {
  const out: number[] = [];
  let count = 0;
  for (let i = 1; i < nodes.length - 1; i++) {
    const arrived = graph.edgeBetween(nodes[i - 1] as string, nodes[i] as string);
    if (!arrived || mode !== 'CAR' || graph.node(nodes[i] as string).roundaboutId === undefined) continue;
    if (arrived.kind !== 'ROUNDABOUT_RING') count = 0; // just entered
    const exits = exitsAt(graph, arrived, nodes[i] as string, mode);
    if (!exits.some((e) => e.kind === 'RIGHT')) continue;
    count++;
    const next = exits.find((e) => e.step.to === nodes[i + 1]);
    if (next?.kind === 'RIGHT') out.push(count);
  }
  return out;
}

/**
 * Can a player at this level be guided along this path? No roundabout exit
 * beyond the level's ordinals, and every turn has a true, unambiguous
 * sentence from at least one junction before it. (On foot, a path leaving
 * a junction at a slant beside a street can have no fair description.)
 */
export function describable(graph: TownGraph, nodes: readonly string[], mode: TravelMode, difficulty: Difficulty): boolean {
  const max = LANGUAGE_SETTINGS[difficulty].maxRoundaboutOrdinal;
  if (!roundaboutExits(graph, nodes, mode).every((n) => n <= max)) return false;
  const settings = LANGUAGE_SETTINGS[difficulty];
  const allowed = (c: Clause) => (settings.weights[templateFor([c], difficulty)] ?? 0) > 0;
  const actions = actionIndices(graph, nodes, mode);
  for (const [k, a] of actions.entries()) {
    const node = nodes[a] as string;
    const to = nodes[a + 1] as string;
    let found = false;
    for (let i = a - 1; i >= Math.max(0, (actions[k - 1] ?? 0)) && !found; i--) {
      const from = positionLeaving(graph, nodes[i] as string, nodes[i + 1] as string, mode);
      found = describe(graph, from, node, to, difficulty, false).some((c) => allowed(c) && readsAs(graph, from, c, node, to));
    }
    if (!found) return false;
  }
  return true;
}

/** True when the interpreter's only reading of the clause is this junction and this exit. */
export function readsAs(graph: TownGraph, from: MoverStart, clause: Clause, node: string, to: string): boolean {
  const reading = interpret(graph, from, clause, from.mode);
  return reading !== null && reading.node === node && reading.to === to;
}

/** Is there a recording for this audio ID? (Pipeline step "MATCH PRE-GENERATED AUDIO".) */
export type AudioCheck = (audioId: string) => boolean;
const ANY_AUDIO: AudioCheck = () => true;

/**
 * Every approved clause that could describe leaving `node` towards `to`,
 * before validation. `simpleOnly` leaves out landmarks (for "…, puis …" pairs).
 */
export function describe(
  graph: TownGraph,
  from: MoverStart,
  node: string,
  to: string,
  difficulty: Difficulty,
  simpleOnly: boolean,
): Clause[] {
  const settings = LANGUAGE_SETTINGS[difficulty];
  const ahead = scanAhead(graph, from, from.mode);
  const index = ahead.nodes.findIndex((n) => n.node === node);
  const target = ahead.nodes[index];
  if (!target) return [];

  if (target.onRing) {
    const firstRing = ahead.nodes.findIndex((n) => n.onRing);
    const ordinal = ahead.nodes
      .slice(firstRing, index + 1)
      .filter((n) => n.onRing && n.exits.some((e) => e.kind === 'RIGHT')).length;
    return ordinal >= 1 && ordinal <= settings.maxRoundaboutOrdinal ? [{ action: 'ROUNDABOUT_EXIT', ordinal, word: ordinalWord(ordinal) }] : [];
  }

  const exit = target.exits.find((e) => e.step.to === to);
  if (!exit || (exit.kind !== 'LEFT' && exit.kind !== 'RIGHT')) return [];
  const side = exit.kind;
  const clauses: Clause[] = [{ action: 'TURN', side }];

  const ringAt = ahead.nodes.findIndex((n) => n.onRing);
  const streets = ahead.nodes.slice(0, ringAt === -1 ? undefined : ringAt).filter((n) => opensOn(n, side));
  const rank = streets.indexOf(target) + 1;
  if (rank >= 1 && rank <= settings.maxStreetOrdinal) {
    clauses.push({ action: 'TAKE_STREET', side, ordinal: rank, word: ordinalWord(rank) });
    // "la prochaine rue" and "la première rue" mean the same street: both are offered.
    if (rank === 1) clauses.push({ action: 'TAKE_STREET', side, ordinal: 1, word: 'PROCHAINE' });
  }
  if (simpleOnly) return clauses;

  for (const location of graph.map.locations) {
    for (const relation of settings.relations) {
      if (relation === 'DEVANT' ? isAt(graph, location, node) : passPoint(ahead, location) !== undefined) {
        clauses.push({ action: 'TURN', side, landmark: location.id, relation });
      }
    }
  }
  return clauses;
}

/** Guide distance between two node indices. */
function between(graph: TownGraph, guide: readonly string[], a: number, b: number): number {
  let total = 0;
  for (let i = a; i < b; i++) {
    const edge = graph.edgeBetween(guide[i] as string, guide[i + 1] as string);
    if (edge) total += graph.edgeLength(edge);
  }
  return total;
}

/**
 * An instruction for the action at `guide[a]`, heard at position `from`, or
 * null if no approved sentence is both true and unambiguous from here yet.
 * `nextAction` (if any) is the action after it, for "…, puis …" pairs.
 */
export function instructionFor(
  graph: TownGraph,
  from: MoverStart,
  guide: readonly string[],
  a: number,
  nextAction: number | undefined,
  difficulty: Difficulty,
  rng: Rng,
  hasAudio: AudioCheck = ANY_AUDIO,
): Guided | null {
  const settings = LANGUAGE_SETTINGS[difficulty];
  const node = guide[a] as string;
  const to = guide[a + 1] as string;
  const allowed = (clauses: Clause[]) => (settings.weights[templateFor(clauses, difficulty)] ?? 0) > 0;
  const add = (guided: Guided) => {
    if (hasAudio(guided.instruction.audioId)) options.push(guided);
  };

  const options: Guided[] = [];
  const singles = describe(graph, from, node, to, difficulty, false).filter((c) => readsAs(graph, from, c, node, to));
  for (const clause of singles) {
    if (allowed([clause])) add({ instruction: makeInstruction([clause], difficulty, [node]), covers: [a] });
  }

  // Two actions close together: one "…, puis …" sentence (I3), each clause checked from where it applies.
  if (
    nextAction !== undefined &&
    (settings.weights.I3 ?? 0) > 0 &&
    between(graph, guide, a, nextAction) <= settings.pairWithin
  ) {
    const node2 = guide[nextAction] as string;
    const to2 = guide[nextAction + 1] as string;
    const from2 = positionLeaving(graph, node, to, from.mode);
    const firsts = describe(graph, from, node, to, difficulty, true).filter((c) => readsAs(graph, from, c, node, to));
    const seconds = describe(graph, from2, node2, to2, difficulty, true).filter((c) =>
      readsAs(graph, from2, c, node2, to2),
    );
    for (const c1 of firsts) {
      for (const c2 of seconds) {
        add({ instruction: makeInstruction([c1, c2], difficulty, [node, node2]), covers: [a, nextAction] });
      }
    }
  }

  if (options.length === 0) return null;
  const weights = options.map((o) => settings.weights[o.instruction.template] ?? 0);
  return rng.weighted(options, weights);
}

/** "Continuez tout droit." when it is true: the route carries straight on at the next junction. */
export function straightOn(
  graph: TownGraph,
  from: MoverStart,
  guide: readonly string[],
  difficulty: Difficulty,
  hasAudio: AudioCheck = ANY_AUDIO,
): Instruction | null {
  if (!hasAudio(makeInstruction([{ action: 'STRAIGHT' }], difficulty).audioId)) return null;
  const reading = interpret(graph, from, { action: 'STRAIGHT' }, from.mode);
  if (!reading) return null;
  const i = guide.indexOf(reading.node);
  if (i === -1 || guide[i + 1] !== reading.to) return null;
  return makeInstruction([{ action: 'STRAIGHT' }], difficulty, [reading.node]);
}

/**
 * After the last turn: "Continuez jusqu'à la piscine." when the place is
 * straight ahead where the route ends, otherwise "Continuez tout droit."
 */
export function finalInstruction(
  graph: TownGraph,
  from: MoverStart,
  guide: readonly string[],
  destination: string,
  difficulty: Difficulty,
  rng: Rng,
  hasAudio: AudioCheck = ANY_AUDIO,
): Instruction | null {
  const end = guide[guide.length - 1] as string;
  const ahead = scanAhead(graph, from, from.mode);
  const endNode = ahead.nodes.find((n) => n.node === end);
  if (endNode) {
    const clause: Clause = { action: 'CONTINUE_UNTIL', landmark: destination, verb: rng.chance(0.5) ? 'ALLEZ' : 'CONTINUEZ' };
    const reading = interpret(graph, from, clause, from.mode);
    const instruction = makeInstruction([clause], difficulty, [end]);
    if (
      reading &&
      Math.abs(reading.s - endNode.s) <= 80 &&
      (LANGUAGE_SETTINGS[difficulty].weights.E2 ?? 0) > 0 &&
      hasAudio(instruction.audioId)
    ) {
      return instruction;
    }
  }
  return straightOn(graph, from, guide, difficulty, hasAudio);
}
