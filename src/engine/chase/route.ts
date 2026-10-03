/**
 * Suspect route generation (pipeline step "MAP → VALID ROUTE").
 *
 * Routes are built on the map first; French instructions are generated from
 * a route later, never the other way round. Suspects have no fixed routes:
 * each chase picks a start, a destination and random waypoints from its seed.
 */

import type { MoverStart } from '../movement/mover';
import { exitsAt, type Exit } from '../movement/turns';
import type { Rng } from '../rng/prng';
import { distance } from '../world/geometry';
import type { TownGraph, TravelMode } from '../world/graph';
import type { MapEdge, MapLocation } from '../world/types';
import { FOOT_ROUTES, STRAIGHT_RUNS } from './settings';

export interface RouteSpec {
  length: [number, number];
  mode: TravelMode;
  /** Extra condition a route must meet (for example, one the level's French can describe). */
  accept?: (nodes: readonly string[]) => boolean;
  /** Start from this node (where the suspect changed transport) instead of a random road. */
  from?: string;
  /** Do not leave `from` along this edge (the one the suspect arrived by). */
  avoidEdge?: string;
  /**
   * End at a place where the suspect changes to this mode, instead of at a
   * location: a junction both modes can use.
   */
  transferTo?: TravelMode;
  /**
   * Metres of road the route keeps going after a turn before it turns again,
   * so each turn can be announced in time at full speed (see CALL_ROUTES).
   * The first turn may come at once: the opening call is heard before the chase starts.
   */
  minTurnGap?: number;
  /** The route carries on an earlier one whose last turn was this many metres before `from` (so its first turn is not free). */
  sinceTurn?: number;
}

export interface GeneratedRoute {
  /** Nodes in order; the route starts travelling from nodes[0] to nodes[1]. */
  nodes: string[];
  length: number;
  /** Location ID the route ends at, or null when it ends at a transport change. */
  destination: string | null;
}

/** Total length of a node path. */
export function pathLength(graph: TownGraph, nodes: readonly string[]): number {
  let total = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const edge = graph.edgeBetween(nodes[i] as string, nodes[i + 1] as string);
    if (!edge) return Infinity;
    total += graph.edgeLength(edge);
  }
  return total;
}

/**
 * Why a node path cannot be followed by a mover in this mode, or null if it
 * can: every step must be a real edge, legal in this direction, and offered as
 * a way out at each junction (no U-turns, no one-way violations).
 */
export function followProblem(graph: TownGraph, nodes: readonly string[], mode: TravelMode): string | null {
  if (nodes.length < 2) return 'Route has fewer than two nodes';
  const first = graph.edgeBetween(nodes[0] as string, nodes[1] as string);
  if (!first) return `No edge ${nodes[0]}-${nodes[1]}`;
  if (graph.steps(nodes[0] as string, mode).every((s) => s.edge.id !== first.id)) {
    return `Cannot travel ${nodes[0]} → ${nodes[1]} in mode ${mode}`;
  }
  for (let i = 1; i < nodes.length - 1; i++) {
    const arrived = graph.edgeBetween(nodes[i - 1] as string, nodes[i] as string);
    if (!arrived) return `No edge ${nodes[i - 1]}-${nodes[i]}`;
    const exits = exitsAt(graph, arrived, nodes[i] as string, mode);
    if (!exits.some((e) => e.step.to === nodes[i + 1])) {
      return `At ${nodes[i]} the route cannot continue to ${nodes[i + 1]}`;
    }
  }
  return null;
}

/**
 * A stretch of route between two turns (or the route's start or end), and
 * the junctions where the route goes straight through on the way. A junction
 * counts when the mode has another way out there; bends, roundabout ring
 * nodes (for cars) and long streets with no side roads do not.
 */
export interface StraightRun {
  /** Index of the turn (or route start) the run starts from. */
  from: number;
  /** Index of the turn (or route end) the run ends at. */
  to: number;
  /** Junctions passed straight through. */
  junctions: number;
  /** Metres from the start of the run to the last junction passed straight through (0 if none). */
  metres: number;
}

/** The route's straight runs, between consecutive turns. */
export function straightRuns(graph: TownGraph, nodes: readonly string[], mode: TravelMode): StraightRun[] {
  const runs: StraightRun[] = [];
  let run: StraightRun = { from: 0, to: 0, junctions: 0, metres: 0 };
  let s = 0;
  for (let i = 1; i < nodes.length; i++) {
    const arrived = graph.edgeBetween(nodes[i - 1] as string, nodes[i] as string);
    if (!arrived) break;
    s += graph.edgeLength(arrived);
    if (i === nodes.length - 1) break;
    const exits = exitsAt(graph, arrived, nodes[i] as string, mode);
    if (exits.length <= 1) continue;
    if (mode === 'CAR' && graph.node(nodes[i] as string).roundaboutId !== undefined) {
      // Going round counts as straight on; leaving the ring is a turn.
      const exit = exits.find((e) => e.step.to === nodes[i + 1]);
      if (exit?.kind === 'STRAIGHT') continue;
    } else {
      const exit = exits.find((e) => e.step.to === nodes[i + 1]);
      if (exit?.kind === 'STRAIGHT') {
        run.junctions++;
        run.metres = s;
        continue;
      }
    }
    runs.push({ ...run, to: i });
    run = { from: i, to: i, junctions: 0, metres: 0 };
    s = 0;
  }
  runs.push({ ...run, to: nodes.length - 1 });
  return runs;
}

/** Junctions on a path where it turns (not counting its first and last nodes). */
function actionCount(graph: TownGraph, nodes: readonly string[], mode: TravelMode): number {
  let count = 0;
  for (let i = 1; i < nodes.length - 1; i++) {
    const arrived = graph.edgeBetween(nodes[i - 1] as string, nodes[i] as string);
    if (!arrived) continue;
    const exits = cachedExits(graph, arrived, nodes[i] as string, mode);
    const exit = exits.find((e) => e.step.to === nodes[i + 1]);
    if (exits.length > 1 && exit && exit.kind !== 'STRAIGHT') count++;
  }
  return count;
}

/** Does the route turn often enough: no run of junctions passed straight through beyond `STRAIGHT_RUNS`? */
export function turnsOftenEnough(graph: TownGraph, nodes: readonly string[], mode: TravelMode): boolean {
  const { maxJunctions, maxMetres } = STRAIGHT_RUNS[mode];
  return straightRuns(graph, nodes, mode).every((r) => r.junctions <= maxJunctions && r.metres <= maxMetres);
}

const exitCache = new WeakMap<TownGraph, Map<string, Exit[]>>();
/** `exitsAt`, remembered per map (the map never changes during a game). */
function cachedExits(graph: TownGraph, arrivedBy: MapEdge, node: string, mode: TravelMode): Exit[] {
  let cache = exitCache.get(graph);
  if (!cache) exitCache.set(graph, (cache = new Map()));
  const key = `${mode}|${arrivedBy.id}|${node}`;
  let exits = cache.get(key);
  if (!exits) cache.set(key, (exits = exitsAt(graph, arrivedBy, node, mode)));
  return exits;
}

/**
 * The shortest way on from the end of `sofar` to `stop` that turns often
 * enough (see `STRAIGHT_RUNS`): a search over (node, way in, junctions passed
 * straight since the last turn), taking only the ways out a mover is offered
 * (no U-turns, no one-way streets the wrong way) and never going back
 * through a node already on the route. Returns the nodes from the end of
 * `sofar` to `stop`, or null if there is no such way within `maxLength` metres.
 */
export function turningPath(
  graph: TownGraph,
  sofar: readonly string[],
  stop: string,
  mode: TravelMode,
  maxLength = Infinity,
  /** No turn until this many metres after the previous one (roundabouts aside); see RouteSpec.minTurnGap. */
  minTurnGap = 0,
  /** The route carries on an earlier one whose last turn was this many metres before its start. */
  sinceTurn?: number,
): string[] | null {
  const { maxJunctions, maxMetres } = STRAIGHT_RUNS[mode];
  const start = sofar[sofar.length - 1] as string;
  const firstEdge = graph.edgeBetween(sofar[sofar.length - 2] as string, start);
  if (!firstEdge) return null;
  const last = straightRuns(graph, sofar, mode).at(-1) as StraightRun;
  const visited = new Set(sofar);

  interface Label {
    node: string;
    edge: MapEdge;
    junctions: number;
    /** Metres since the last turn, up to this node. */
    since: number;
    /** No turn yet on the whole route. */
    first: boolean;
    cost: number;
    prev: Label | null;
  }
  const best = new Map<string, number>();
  // With a turn gap, how far since the last turn matters too (up to the gap).
  const key = (l: Pick<Label, 'node' | 'edge' | 'junctions' | 'since' | 'first'>) =>
    `${l.node}|${l.edge.id}|${l.junctions}|${l.first ? 'F' : Math.round(Math.min(l.since, minTurnGap) / 20)}`;
  const heap: Label[] = [];
  const push = (l: Label) => {
    const k = key(l);
    if ((best.get(k) ?? Infinity) <= l.cost) return;
    best.set(k, l.cost);
    heap.push(l);
    for (let i = heap.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if ((heap[parent] as Label).cost <= (heap[i] as Label).cost) break;
      [heap[parent], heap[i]] = [heap[i] as Label, heap[parent] as Label];
      i = parent;
    }
  };
  const pop = (): Label => {
    const top = heap[0] as Label;
    const end = heap.pop() as Label;
    if (heap.length > 0) {
      heap[0] = end;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && (heap[l] as Label).cost < (heap[m] as Label).cost) m = l;
        if (r < heap.length && (heap[r] as Label).cost < (heap[m] as Label).cost) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i] as Label, heap[m] as Label];
        i = m;
      }
    }
    return top;
  };

  const noTurnYet = actionCount(graph, sofar, mode) === 0;
  push({
    node: start,
    edge: firstEdge,
    junctions: last.junctions,
    since: (noTurnYet ? (sinceTurn ?? 0) : 0) + pathLength(graph, sofar.slice(last.from)),
    // Before the route's first turn, the opening call has been heard with the car standing still.
    first: noTurnYet && sinceTurn === undefined,
    cost: 0,
    prev: null,
  });
  while (heap.length > 0) {
    const at = pop();
    if (at.cost > (best.get(key(at)) ?? Infinity)) continue;
    if (at.node === stop) {
      const out: string[] = [];
      for (let l: Label | null = at; l; l = l.prev) out.unshift(l.node);
      return out;
    }
    const exits = cachedExits(graph, at.edge, at.node, mode);
    const ring = mode === 'CAR' && graph.node(at.node).roundaboutId !== undefined;
    for (const exit of exits) {
      const to = exit.step.to;
      if (visited.has(to)) continue;
      const length = exit.step.length;
      if (at.cost + length > maxLength) continue;
      let junctions = at.junctions;
      let since = at.since + length;
      let first = at.first;
      if (exits.length > 1 && exit.kind !== 'STRAIGHT') {
        if (!ring && !at.first && at.since < minTurnGap) continue; // too soon after the last turn to be called in time
        junctions = 0; // a turn
        since = length;
        first = false;
      } else if (exits.length > 1 && !ring) {
        // Straight through a junction.
        if (junctions + 1 > maxJunctions || at.since > maxMetres) continue;
        junctions++;
      }
      push({ node: to, edge: exit.step.edge, junctions, since, first, cost: at.cost + length, prev: at });
    }
  }
  return null;
}

/** The node where a vehicle stops for a location: the nearest node usable in this mode. */
export function arrivalNode(graph: TownGraph, location: MapLocation, mode: TravelMode): string {
  const candidates = graph
    .nodesFor(mode)
    .filter((id) => graph.node(id).kind !== 'ROUNDABOUT' && graph.node(id).kind !== 'DEAD_END');
  let best = candidates[0] as string;
  let bestDistance = Infinity;
  for (const entrance of location.entrances) {
    const p = graph.entrancePoint(entrance);
    for (const id of candidates) {
      const d = distance(p, graph.node(id));
      if (d < bestDistance) {
        bestDistance = d;
        best = id;
      }
    }
  }
  return best;
}

/** Start edges: ordinary roads, not bridges, ring roads or dead-end spurs. */
function startCandidates(graph: TownGraph, mode: TravelMode): [string, string][] {
  const ordinary = (id: string) => graph.node(id).kind === 'JUNCTION';
  const out: [string, string][] = [];
  for (const e of graph.map.edges) {
    if (mode === 'CAR' ? !e.car : !e.foot) continue;
    if (e.bridge || e.kind === 'ROUNDABOUT_RING' || graph.edgeLength(e) < 120) continue;
    if (!ordinary(e.from) || !ordinary(e.to)) continue;
    out.push([e.from, e.to]);
    if (!e.oneWay) out.push([e.to, e.from]);
  }
  return out;
}

/**
 * Junctions where the suspect can change between `from` and `to`: ordinary
 * junctions both modes can use. Getting out of a car prefers a junction next
 * to a footpath, so the chase on foot can go where cars cannot.
 */
export function transferNodes(graph: TownGraph, from: TravelMode, to: TravelMode): string[] {
  const both = graph
    .nodesFor('CAR')
    .filter((id) => graph.node(id).kind === 'JUNCTION' && graph.steps(id, 'FOOT').length > 0);
  if (from !== 'CAR' || to !== 'FOOT') return both;
  const byPath = both.filter((id) => graph.steps(id, 'FOOT').some((s) => !s.edge.car));
  return byPath.length > 0 ? byPath : both;
}

function startsFrom(graph: TownGraph, spec: RouteSpec): [string, string][] {
  if (spec.from === undefined) return startCandidates(graph, spec.mode);
  const from = spec.from;
  return graph
    .steps(from, spec.mode)
    .filter((s) => s.edge.id !== spec.avoidEdge)
    .map((s): [string, string] => [from, s.to]);
}

export function generateRoute(graph: TownGraph, rng: Rng, spec: RouteSpec, attempts = 400): GeneratedRoute {
  const starts = startsFrom(graph, spec);
  if (starts.length === 0) throw new Error(`No way to start a ${spec.mode} route from ${spec.from}`);
  const waypoints = graph.nodesFor(spec.mode).filter((id) => graph.node(id).kind === 'JUNCTION');
  // On foot the suspect cuts through the park, the square, alleys, the footbridge and the promenade
  // (but heads for a road when it is running to a car, so the police car can follow).
  const footways = spec.mode === 'FOOT' && !spec.transferTo ? footwayNodes(graph) : [];
  const pickWaypoint = () =>
    footways.length > 0 && rng.chance(FOOT_ROUTES.footwayWaypointChance) ? rng.pick(footways) : rng.pick(waypoints);
  const locations = graph.map.locations;
  const transfers = spec.transferTo ? transferNodes(graph, spec.mode, spec.transferTo) : [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const [origin, towards] = rng.pick(starts);
    const destination = spec.transferTo ? null : rng.pick(locations);
    const end = destination ? arrivalNode(graph, destination, spec.mode) : rng.pick(transfers);
    if (end === origin || end === towards) continue;

    // Start → (0 to 2 random waypoints) → destination, never reversing at a waypoint.
    const stops = [...Array.from({ length: rng.int(0, 2) }, pickWaypoint), end];
    let nodes = [origin, towards];
    let ok = true;
    for (const stop of stops) {
      const at = nodes[nodes.length - 1] as string;
      if (stop === at) continue;
      const segment = turningPath(graph, nodes, stop, spec.mode, spec.length[1] - pathLength(graph, nodes), spec.minTurnGap ?? 0, spec.sinceTurn);
      if (!segment) {
        ok = false;
        break;
      }
      nodes = [...nodes, ...segment.slice(1)];
    }
    if (!ok || new Set(nodes).size !== nodes.length) continue; // loops look silly and confuse "la prochaine rue"
    // Arrive at a change of transport along a way the next mode can use, so the police can follow.
    if (spec.transferTo) {
      const last = graph.edgeBetween(nodes[nodes.length - 2] as string, nodes[nodes.length - 1] as string);
      if (!last || !(spec.transferTo === 'CAR' ? last.car : last.foot)) continue;
    }
    if (followProblem(graph, nodes, spec.mode)) continue;
    const length = pathLength(graph, nodes);
    if (length < spec.length[0] || length > spec.length[1]) continue;
    // The suspect turns regularly instead of driving straight through junction after junction.
    if (!turnsOftenEnough(graph, nodes, spec.mode)) continue;
    // Most attempts insist on some running off the roads; the last ones take any route.
    const strict = footways.length > 0 && attempt < attempts * FOOT_ROUTES.strictAttempts;
    if (strict && footwayLength(graph, nodes) < length * FOOT_ROUTES.minFootwayShare) continue;
    if (spec.accept && !spec.accept(nodes)) continue;
    return { nodes, length, destination: destination?.id ?? null };
  }
  throw new Error(`No valid route after ${attempts} attempts`);
}

/** Junctions on pedestrian-only ways (park and square paths, alleys, the footbridge, the promenade). */
function footwayNodes(graph: TownGraph): string[] {
  const nodes = new Set<string>();
  for (const e of graph.map.edges) {
    if (e.car) continue;
    for (const id of [e.from, e.to]) if (graph.node(id).kind === 'JUNCTION') nodes.add(id);
  }
  return [...nodes].sort();
}

/** Metres of a route on pedestrian-only ways. */
export function footwayLength(graph: TownGraph, nodes: readonly string[]): number {
  let total = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    const edge = graph.edgeBetween(nodes[i] as string, nodes[i + 1] as string);
    if (edge && !edge.car) total += graph.edgeLength(edge);
  }
  return total;
}

/**
 * A mover start `along` metres down the route, plus the rest of the route as
 * a plan (starting with the node it is heading towards).
 */
export function placeOnRoute(
  graph: TownGraph,
  nodes: readonly string[],
  along: number,
  mode: TravelMode,
): { start: MoverStart; plan: string[] } {
  let remaining = along;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i] as string;
    const b = nodes[i + 1] as string;
    const edge = graph.edgeBetween(a, b)!;
    const length = graph.edgeLength(edge);
    if (remaining <= length || i === nodes.length - 2) {
      const fraction = Math.min(1, remaining / length);
      const t = edge.from === a ? fraction : 1 - fraction;
      return { start: { edgeId: edge.id, t, towards: b, mode }, plan: nodes.slice(i + 1) };
    }
    remaining -= length;
  }
  throw new Error('Route too short');
}
