/**
 * Suspect route generation (pipeline step "MAP → VALID ROUTE").
 *
 * Routes are built on the map first; French instructions are generated from
 * a route later, never the other way round. Suspects have no fixed routes:
 * each chase picks a start, a destination and random waypoints from its seed.
 */

import type { MoverStart } from '../movement/mover';
import { exitsAt } from '../movement/turns';
import type { Rng } from '../rng/prng';
import { distance } from '../world/geometry';
import type { TownGraph, TravelMode } from '../world/graph';
import type { MapLocation } from '../world/types';
import { FOOT_ROUTES } from './settings';

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
      const arrivedBy = graph.edgeBetween(nodes[nodes.length - 2] as string, at);
      const segment = graph.shortestPath(at, stop, spec.mode, new Set(arrivedBy ? [arrivedBy.id] : []));
      if (!segment) {
        ok = false;
        break;
      }
      nodes = [...nodes, ...segment.nodes.slice(1)];
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
