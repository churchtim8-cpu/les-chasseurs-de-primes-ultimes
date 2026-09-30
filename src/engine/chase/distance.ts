/**
 * Pursuit distance: how far the player would have to travel along roads
 * (legally, in their current mode) to reach the suspect. Straight-line
 * distance would reward cutting through buildings; road distance means a
 * wrong turn genuinely lets the suspect gain ground.
 */

import type { MoverStart } from '../movement/mover';
import { canTravel, type TownGraph, type TravelMode } from '../world/graph';

interface EdgePosition {
  edgeId: string;
  /** Metres from the edge's `from` node. */
  fromStart: number;
  length: number;
}

function toEdgePosition(graph: TownGraph, where: MoverStart): EdgePosition {
  const edge = graph.edge(where.edgeId);
  const length = graph.edgeLength(edge);
  return { edgeId: edge.id, fromStart: where.t * length, length };
}

/**
 * Road distance from `player` to `suspect`. The player may carry on towards
 * the node ahead, or turn around if that is legal in their mode.
 */
export function roadDistance(graph: TownGraph, player: MoverStart, suspect: MoverStart, mode: TravelMode): number {
  const p = toEdgePosition(graph, player);
  const s = toEdgePosition(graph, suspect);
  const pEdge = graph.edge(p.edgeId);
  const sEdge = graph.edge(s.edgeId);

  // Ways off the player's edge: [node, cost to get there].
  const behind = graph.other(pEdge, player.towards);
  const exits: [string, number][] = [
    [player.towards, player.towards === pEdge.to ? p.length - p.fromStart : p.fromStart],
  ];
  if (canTravel(pEdge, mode, player.towards)) {
    exits.push([behind, behind === pEdge.to ? p.length - p.fromStart : p.fromStart]);
  }

  let best = Infinity;

  // Same edge: reachable directly if the suspect is ahead, or behind and a U-turn is legal.
  if (p.edgeId === s.edgeId) {
    const ahead = player.towards === pEdge.to ? s.fromStart >= p.fromStart : s.fromStart <= p.fromStart;
    if (ahead || canTravel(pEdge, mode, player.towards)) best = Math.abs(s.fromStart - p.fromStart);
  }

  // Ways onto the suspect's edge: [node, cost from node to the suspect], only where legal.
  const entries: [string, number][] = [];
  if (canTravel(sEdge, mode, sEdge.from)) entries.push([sEdge.from, s.fromStart]);
  if (canTravel(sEdge, mode, sEdge.to)) entries.push([sEdge.to, s.length - s.fromStart]);

  for (const [node, cost] of exits) {
    const dist = graph.distancesFrom(node, mode);
    for (const [entry, entryCost] of entries) {
      const between = dist.get(entry);
      if (between !== undefined) best = Math.min(best, cost + between + entryCost);
    }
  }
  return best;
}
