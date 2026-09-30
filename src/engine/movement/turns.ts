/**
 * Turn geometry: which ways out of a junction count as left, right or
 * straight on, seen from the direction you arrive. The movement system, the
 * suspect and (later) the French instruction validator all use this, so
 * "à gauche" always means the same thing everywhere.
 *
 * Coordinates have y pointing south, so a positive change of heading is a
 * clockwise turn, which is a turn to the RIGHT.
 */

import type { Step, TownGraph, TravelMode } from '../world/graph';
import type { MapEdge } from '../world/types';

export type TurnIntent = 'LEFT' | 'RIGHT' | 'STRAIGHT';
export type ExitKind = TurnIntent | 'BACK';

export interface Exit {
  step: Step;
  /** Change of heading in radians, -π..π (negative = left). */
  relativeAngle: number;
  kind: ExitKind;
}

/** Headings within this angle of straight ahead count as "tout droit". */
export const STRAIGHT_TOLERANCE = (35 * Math.PI) / 180;
/** Headings beyond this angle count as going back the way you came. */
export const BACK_TOLERANCE = (150 * Math.PI) / 180;

export function headingOf(graph: TownGraph, fromNode: string, toNode: string): number {
  const a = graph.node(fromNode);
  const b = graph.node(toNode);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function normaliseAngle(angle: number): number {
  let a = angle;
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

export function classifyAngle(relativeAngle: number): ExitKind {
  const magnitude = Math.abs(relativeAngle);
  if (magnitude <= STRAIGHT_TOLERANCE) return 'STRAIGHT';
  if (magnitude >= BACK_TOLERANCE) return 'BACK';
  return relativeAngle > 0 ? 'RIGHT' : 'LEFT';
}

const isRing = (edge: MapEdge) => edge.kind === 'ROUNDABOUT_RING';

/**
 * The ways out of `atNode` for someone who arrived along `arrivedBy`,
 * excluding going straight back along the same edge (that is a U-turn).
 *
 * Roundabouts, for cars: following the ring counts as straight on, and
 * leaving it counts as a right turn (traffic keeps right).
 */
export function exitsAt(graph: TownGraph, arrivedBy: MapEdge, atNode: string, mode: TravelMode): Exit[] {
  const cameFrom = graph.other(arrivedBy, atNode);
  const inHeading = headingOf(graph, cameFrom, atNode);
  const onRoundabout = mode === 'CAR' && graph.node(atNode).roundaboutId !== undefined;

  return graph
    .steps(atNode, mode)
    .filter((step) => step.edge.id !== arrivedBy.id)
    .map((step) => {
      const relativeAngle = normaliseAngle(headingOf(graph, atNode, step.to) - inHeading);
      let kind = classifyAngle(relativeAngle);
      if (onRoundabout) kind = isRing(step.edge) ? 'STRAIGHT' : 'RIGHT';
      return { step, relativeAngle, kind };
    });
}
