/**
 * Bellevue City map schema. This data, not the artwork, is the navigation
 * source of truth: routes, French instructions and validation are all
 * computed from it, and the road layer is drawn from it.
 *
 * Units are metres. x grows to the east, y grows to the south (screen
 * orientation), so the sea is at the bottom of the map.
 */

export type NodeKind =
  /** Where three or more roads or paths meet. */
  | 'JUNCTION'
  /** A point on a roundabout ring where a road joins it. */
  | 'ROUNDABOUT'
  /** A road that stops (the only way out is back). */
  | 'DEAD_END'
  /** A shape point where a road bends or changes type, with no choice to make. */
  | 'BEND';

export interface MapNode {
  id: string;
  x: number;
  y: number;
  kind: NodeKind;
  trafficLight?: boolean;
  /** Set on ring nodes of a roundabout. */
  roundaboutId?: string;
}

export type EdgeKind =
  | 'AVENUE'
  | 'STREET'
  | 'LANE'
  | 'ROUNDABOUT_RING'
  /** Pedestrian-only path through a park or square. */
  | 'PATH'
  /** Pedestrian-only link between streets (le passage). */
  | 'PASSAGE'
  /** Seafront promenade, pedestrian-only. */
  | 'PROMENADE';

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  car: boolean;
  foot: boolean;
  /** Cars may only travel from `from` to `to` (roundabout rings). */
  oneWay?: boolean;
  bridge?: boolean;
  /** The street this edge belongs to; streets are chains of edges. */
  streetId: string;
}

export type StreetKind = 'avenue' | 'rue' | 'chemin' | 'passage' | 'promenade' | 'rond-point';

export interface Street {
  id: string;
  kind: StreetKind;
  /** Display name for maps and debug only. Street names are never spoken in instructions. */
  name: string;
}

export type District = 'TOWN_CENTRE' | 'COMMERCIAL' | 'CIVIC' | 'TRANSPORT' | 'COASTAL';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Entrance {
  edgeId: string;
  /** Position along the edge from its `from` node, 0 to 1. */
  t: number;
}

export interface MapLocation {
  /** One of the approved location IDs (see locations.ts). */
  id: string;
  district: District;
  footprint: Rect;
  entrances: Entrance[];
  /** Walkable open space (park, square, beach): paths may cross the footprint. */
  open?: boolean;
}

export type RegionKind = 'SEA' | 'SAND' | 'WATER' | 'PARK' | 'PLAZA' | 'RAILWAY';

export interface Region {
  id: string;
  kind: RegionKind;
  /** Polygon points [x, y] in metres. */
  points: [number, number][];
}

/** A plain building with no vocabulary role; it gives the town its texture. */
export interface Filler {
  id: string;
  footprint: Rect;
}

export interface TownMap {
  id: string;
  name: string;
  width: number;
  height: number;
  nodes: MapNode[];
  edges: MapEdge[];
  streets: Street[];
  locations: MapLocation[];
  regions: Region[];
  fillers: Filler[];
}
