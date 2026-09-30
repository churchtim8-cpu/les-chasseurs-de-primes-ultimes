import type {
  District,
  EdgeKind,
  Filler,
  MapEdge,
  MapLocation,
  MapNode,
  Rect,
  Region,
  RegionKind,
  Street,
  StreetKind,
  TownMap,
} from './types';

interface StreetOptions {
  edgeKind: EdgeKind;
  car?: boolean;
  foot?: boolean;
  oneWay?: boolean;
  /** Join the last node back to the first (roundabout rings). */
  closed?: boolean;
  /** Pairs of consecutive node IDs whose edge is a bridge. */
  bridges?: [string, string][];
}

/**
 * Small helper for authoring maps by hand: streets are written as chains of
 * node IDs, entrances name the two nodes of their edge, and node kinds are
 * worked out from how many ways meet there.
 */
export class MapBuilder {
  private readonly nodes = new Map<string, MapNode>();
  private readonly edges: MapEdge[] = [];
  private readonly edgeByPair = new Map<string, MapEdge>();
  private readonly streets: Street[] = [];
  private readonly locations: MapLocation[] = [];
  private readonly regions: Region[] = [];
  private fillers: Filler[] = [];

  constructor(private readonly meta: { id: string; name: string; width: number; height: number }) {}

  node(id: string, x: number, y: number, extra: { trafficLight?: boolean; roundaboutId?: string } = {}): this {
    if (this.nodes.has(id)) throw new Error(`Duplicate node ${id}`);
    this.nodes.set(id, { id, x, y, kind: 'BEND', ...extra });
    return this;
  }

  street(id: string, kind: StreetKind, name: string, nodeIds: string[], options: StreetOptions): this {
    this.streets.push({ id, kind, name });
    const car = options.car ?? !['PATH', 'PASSAGE', 'PROMENADE'].includes(options.edgeKind);
    const foot = options.foot ?? true;
    const chain = options.closed ? [...nodeIds, nodeIds[0] as string] : nodeIds;
    for (let i = 0; i < chain.length - 1; i++) {
      const from = chain[i] as string;
      const to = chain[i + 1] as string;
      for (const n of [from, to]) if (!this.nodes.has(n)) throw new Error(`Street ${id}: unknown node ${n}`);
      const key = pairKey(from, to);
      if (this.edgeByPair.has(key)) throw new Error(`Street ${id}: duplicate edge ${from}-${to}`);
      const bridge = options.bridges?.some(([a, b]) => pairKey(a, b) === key) || undefined;
      const edge: MapEdge = {
        id: `${from}-${to}`,
        from,
        to,
        kind: options.edgeKind,
        car,
        foot,
        streetId: id,
        ...(options.oneWay ? { oneWay: true } : {}),
        ...(bridge ? { bridge: true } : {}),
      };
      this.edges.push(edge);
      this.edgeByPair.set(key, edge);
    }
    return this;
  }

  /** Entrances are given as [nodeA, nodeB, t] with t measured from nodeA. */
  location(
    id: string,
    district: District,
    footprint: Rect,
    entrances: [string, string, number][],
    extra: { open?: boolean } = {},
  ): this {
    this.locations.push({
      id,
      district,
      footprint,
      entrances: entrances.map(([a, b, t]) => {
        const edge = this.edgeByPair.get(pairKey(a, b));
        if (!edge) throw new Error(`Location ${id}: no edge between ${a} and ${b}`);
        return { edgeId: edge.id, t: edge.from === a ? t : 1 - t };
      }),
      ...extra,
    });
    return this;
  }

  region(id: string, kind: RegionKind, points: [number, number][]): this {
    this.regions.push({ id, kind, points });
    return this;
  }

  rectRegion(id: string, kind: RegionKind, r: Rect): this {
    return this.region(id, kind, [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h],
      [r.x, r.y + r.h],
    ]);
  }

  setFillers(fillers: Filler[]): this {
    this.fillers = fillers;
    return this;
  }

  /** Map as built so far (used to place fillers around roads and locations). */
  snapshot(): TownMap {
    const neighbours = new Map<string, Set<string>>();
    for (const e of this.edges) {
      if (!neighbours.has(e.from)) neighbours.set(e.from, new Set());
      if (!neighbours.has(e.to)) neighbours.set(e.to, new Set());
      neighbours.get(e.from)?.add(e.to);
      neighbours.get(e.to)?.add(e.from);
    }
    const nodes = [...this.nodes.values()].map((n): MapNode => {
      const degree = neighbours.get(n.id)?.size ?? 0;
      const kind = n.roundaboutId ? 'ROUNDABOUT' : degree <= 1 ? 'DEAD_END' : degree === 2 ? 'BEND' : 'JUNCTION';
      return { ...n, kind };
    });
    return {
      ...this.meta,
      nodes,
      edges: this.edges.map((e) => ({ ...e })),
      streets: [...this.streets],
      locations: this.locations.map((l) => ({ ...l, entrances: [...l.entrances] })),
      regions: [...this.regions],
      fillers: [...this.fillers],
    };
  }

  build(): TownMap {
    return this.snapshot();
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
