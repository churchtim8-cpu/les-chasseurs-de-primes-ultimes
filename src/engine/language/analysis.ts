/**
 * Route analysis (pipeline step "ANALYZE ROUTE"): what a driver will meet
 * ahead if they simply keep going, and where the approved places stand
 * relative to that road.
 *
 * "Keep going" is exactly what the car does with no input: it follows bends,
 * goes straight on through junctions, and stops at a T-junction or a dead
 * end. Every instruction is judged against this view of the road ahead, so
 * the French always matches what the controls will do.
 */

import type { MoverStart } from '../movement/mover';
import { exitsAt, type Exit } from '../movement/turns';
import { distance, lerp, pointRectDistance, type Point } from '../world/geometry';
import type { TownGraph, TravelMode } from '../world/graph';
import type { MapEdge, MapLocation } from '../world/types';

/** A place counts as beside the road when its footprint is this close to the road's centre line. */
export const ROADSIDE = 32;
/** A place stands at a junction when its footprint is this close to the junction's centre. */
export const CORNER = 45;
/** How far ahead the analysis looks. */
export const HORIZON = 1600;

export type AheadKind = 'BEND' | 'JUNCTION' | 'T_JUNCTION' | 'DEAD_END';

export interface AheadNode {
  node: string;
  /** Distance from the current position, in metres. */
  s: number;
  arrivedBy: MapEdge;
  exits: Exit[];
  kind: AheadKind;
  /** Part of a roundabout (for cars). */
  onRing: boolean;
}

export interface Ahead {
  nodes: AheadNode[];
  /** Points along the road ahead, every few metres, with their distance from the start. */
  samples: { p: Point; s: number }[];
}

const SAMPLE_STEP = 5;

function classify(exits: Exit[]): AheadKind {
  if (exits.length === 0) return 'DEAD_END';
  if (exits.length === 1) return 'BEND';
  return exits.some((e) => e.kind === 'STRAIGHT') ? 'JUNCTION' : 'T_JUNCTION';
}

/** The road ahead of a position when the driver keeps going, up to `horizon` metres. */
export function scanAhead(graph: TownGraph, from: MoverStart, mode: TravelMode, horizon = HORIZON): Ahead {
  const nodes: AheadNode[] = [];
  const samples: { p: Point; s: number }[] = [];
  let edge = graph.edge(from.edgeId);
  let target = from.towards;
  let origin = graph.other(edge, target);
  const length0 = graph.edgeLength(edge);
  // Distance already travelled along the first edge from `origin`.
  let offset = (origin === edge.from ? from.t : 1 - from.t) * length0;
  let s = 0;
  const seen = new Set<string>();

  for (let guard = 0; guard < 64; guard++) {
    const a = graph.node(origin);
    const b = graph.node(target);
    const length = graph.edgeLength(edge);
    for (let d = offset; d < length; d += SAMPLE_STEP) {
      samples.push({ p: lerp(a, b, length === 0 ? 0 : d / length), s: s + (d - offset) });
    }
    s += length - offset;
    offset = 0;

    const exits = exitsAt(graph, edge, target, mode);
    const kind = classify(exits);
    const onRing = mode === 'CAR' && graph.node(target).roundaboutId !== undefined;
    nodes.push({ node: target, s, arrivedBy: edge, exits, kind, onRing });
    samples.push({ p: { x: b.x, y: b.y }, s });

    if (kind === 'DEAD_END' || kind === 'T_JUNCTION' || s > horizon || seen.has(target)) break;
    seen.add(target);
    const next = kind === 'BEND' ? exits[0] : exits.find((e) => e.kind === 'STRAIGHT');
    if (!next) break;
    origin = target;
    edge = next.step.edge;
    target = next.step.to;
  }
  return { nodes, samples };
}

/** Junctions with a real choice (at least two ways out). */
export function isDecision(n: AheadNode): boolean {
  return n.kind === 'JUNCTION' || n.kind === 'T_JUNCTION';
}

/** Ordinary street junctions where a street opens on `side` (roundabouts are counted separately). */
export function opensOn(n: AheadNode, side: 'LEFT' | 'RIGHT'): boolean {
  return isDecision(n) && !n.onRing && n.exits.some((e) => e.kind === side);
}

/** The single exit on `side`, or undefined if there is none or more than one (ambiguous). */
export function uniqueExit(n: AheadNode, side: 'LEFT' | 'RIGHT' | 'STRAIGHT'): Exit | undefined {
  const matches = n.exits.filter((e) => e.kind === side);
  return matches.length === 1 ? matches[0] : undefined;
}

export function locationById(graph: TownGraph, id: string): MapLocation | undefined {
  return graph.map.locations.find((l) => l.id === id);
}

/** Does this place stand at this junction (on one of its corners)? */
export function isAt(graph: TownGraph, location: MapLocation, node: string): boolean {
  return pointRectDistance(graph.node(node), location.footprint) <= CORNER;
}

/**
 * Where the road ahead passes a place: the distance at which the driver is
 * level with the middle of it, or undefined if the place is not beside this
 * road within the horizon. Open spaces (park, square, beach) count too.
 */
export function passPoint(ahead: Ahead, location: MapLocation): number | undefined {
  const f = location.footprint;
  const centre = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  let best: number | undefined;
  let bestDistance = Infinity;
  for (const { p, s } of ahead.samples) {
    if (pointRectDistance(p, f) > ROADSIDE) continue;
    const d = distance(p, centre);
    if (d < bestDistance) {
      bestDistance = d;
      best = s;
    }
  }
  return best;
}
