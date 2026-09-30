import { distance, lerp, type Point } from './geometry';
import type { Entrance, MapEdge, MapNode, TownMap } from './types';

export type TravelMode = 'CAR' | 'FOOT';

export interface Step {
  edge: MapEdge;
  /** The node this step arrives at. */
  to: string;
  length: number;
}

export interface Path {
  nodes: string[];
  edges: string[];
  length: number;
}

/** Whether an edge can be travelled in a mode, in the direction from `from`. */
export function canTravel(edge: MapEdge, mode: TravelMode, from: string): boolean {
  if (mode === 'FOOT') return edge.foot;
  if (!edge.car) return false;
  return !edge.oneWay || edge.from === from;
}

/** Read-only navigation view over a town map. */
export class TownGraph {
  private readonly nodeById = new Map<string, MapNode>();
  private readonly edgeById = new Map<string, MapEdge>();
  private readonly incident = new Map<string, MapEdge[]>();

  constructor(readonly map: TownMap) {
    for (const node of map.nodes) {
      this.nodeById.set(node.id, node);
      this.incident.set(node.id, []);
    }
    for (const edge of map.edges) {
      this.edgeById.set(edge.id, edge);
      this.incident.get(edge.from)?.push(edge);
      this.incident.get(edge.to)?.push(edge);
    }
  }

  node(id: string): MapNode {
    const node = this.nodeById.get(id);
    if (!node) throw new Error(`Unknown node ${id}`);
    return node;
  }

  hasNode(id: string): boolean {
    return this.nodeById.has(id);
  }

  edge(id: string): MapEdge {
    const edge = this.edgeById.get(id);
    if (!edge) throw new Error(`Unknown edge ${id}`);
    return edge;
  }

  hasEdge(id: string): boolean {
    return this.edgeById.has(id);
  }

  edgesAt(nodeId: string): readonly MapEdge[] {
    return this.incident.get(nodeId) ?? [];
  }

  edgeLength(edge: MapEdge): number {
    return distance(this.node(edge.from), this.node(edge.to));
  }

  other(edge: MapEdge, nodeId: string): string {
    return edge.from === nodeId ? edge.to : edge.from;
  }

  /** Ways out of a node in a travel mode. */
  steps(nodeId: string, mode: TravelMode, blocked?: ReadonlySet<string>): Step[] {
    return this.edgesAt(nodeId)
      .filter((edge) => !blocked?.has(edge.id) && canTravel(edge, mode, nodeId))
      .map((edge) => ({ edge, to: this.other(edge, nodeId), length: this.edgeLength(edge) }));
  }

  /** Nodes touched by at least one edge usable in this mode. */
  nodesFor(mode: TravelMode): string[] {
    return this.map.nodes
      .filter((n) => this.edgesAt(n.id).some((e) => (mode === 'CAR' ? e.car : e.foot)))
      .map((n) => n.id);
  }

  entrancePoint(entrance: Entrance): Point {
    const edge = this.edge(entrance.edgeId);
    return lerp(this.node(edge.from), this.node(edge.to), entrance.t);
  }

  /** Dijkstra shortest path; returns null when unreachable. */
  shortestPath(from: string, to: string, mode: TravelMode, blocked?: ReadonlySet<string>): Path | null {
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, { node: string; edge: string }>();
    const done = new Set<string>();
    // The town has a few hundred nodes, so a simple scan beats a heap for clarity.
    while (true) {
      let current: string | undefined;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!done.has(id) && d < best) {
          best = d;
          current = id;
        }
      }
      if (current === undefined) return null;
      if (current === to) break;
      done.add(current);
      for (const step of this.steps(current, mode, blocked)) {
        const candidate = best + step.length;
        if (candidate < (dist.get(step.to) ?? Infinity)) {
          dist.set(step.to, candidate);
          prev.set(step.to, { node: current, edge: step.edge.id });
        }
      }
    }
    const nodes = [to];
    const edges: string[] = [];
    for (let at = to; at !== from; ) {
      const p = prev.get(at)!;
      edges.unshift(p.edge);
      nodes.unshift(p.node);
      at = p.node;
    }
    return { nodes, edges, length: dist.get(to) ?? 0 };
  }

  /** All nodes reachable from `start` (following one-way rules for cars). */
  reachable(start: string, mode: TravelMode, blocked?: ReadonlySet<string>): Set<string> {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.pop() as string;
      for (const step of this.steps(id, mode, blocked)) {
        if (!seen.has(step.to)) {
          seen.add(step.to);
          queue.push(step.to);
        }
      }
    }
    return seen;
  }
}
