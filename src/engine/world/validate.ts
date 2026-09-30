/**
 * Map validation: proves the town data can support the game's language
 * system before any chase is generated. Run by the unit tests on every change
 * and available to the debug tools.
 */

import { LOCATION_WORD_BY_ID, LOCATION_WORDS } from '../language/locations';
import {
  HALF_WIDTH,
  PAVEMENT,
  distance,
  lerp,
  pointInPolygon,
  pointRectDistance,
  rectsOverlap,
  segmentRectDistance,
} from './geometry';
import { TownGraph } from './graph';
import type { TownMap } from './types';

export interface ValidationIssue {
  code: string;
  message: string;
}

/** Tunable requirements for a playable town. */
export const MAP_REQUIREMENTS = {
  minWidth: 2000,
  minTrafficLights: 3,
  minDeadEnds: 1,
  /** How far an entrance may sit from its building, in metres. */
  maxEntranceGap: 45,
  /** How far a location may be from a road a car can use, in metres. */
  maxWalkFromCar: 200,
};

export function validateMap(map: TownMap): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (code: string, message: string) => issues.push({ code, message });

  // ---- Identity and references -----------------------------------------
  const checkUnique = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) fail('DUPLICATE_ID', `Duplicate ${kind} ID ${id}`);
      seen.add(id);
    }
  };
  checkUnique('node', map.nodes.map((n) => n.id));
  checkUnique('edge', map.edges.map((e) => e.id));
  checkUnique('street', map.streets.map((s) => s.id));
  checkUnique('location', map.locations.map((l) => l.id));

  const nodeIds = new Set(map.nodes.map((n) => n.id));
  const streetIds = new Set(map.streets.map((s) => s.id));
  for (const e of map.edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) fail('BAD_EDGE', `Edge ${e.id} references a missing node`);
    if (!streetIds.has(e.streetId)) fail('BAD_EDGE', `Edge ${e.id} references missing street ${e.streetId}`);
    if (!e.car && !e.foot) fail('BAD_EDGE', `Edge ${e.id} can be used by nobody`);
  }
  if (issues.length > 0) return issues; // the checks below need a sound graph

  const graph = new TownGraph(map);
  for (const e of map.edges) {
    if (graph.edgeLength(e) < 5) fail('SHORT_EDGE', `Edge ${e.id} is shorter than 5 m`);
  }

  // ---- Connectivity ------------------------------------------------------
  const carNodes = graph.nodesFor('CAR');
  const footNodes = graph.nodesFor('FOOT');
  if (carNodes.length > 0) {
    const start = carNodes[0] as string;
    const forward = graph.reachable(start, 'CAR');
    for (const id of carNodes) {
      if (!forward.has(id)) fail('CAR_UNREACHABLE', `Cars cannot reach ${id} from ${start}`);
      else if (!graph.reachable(id, 'CAR').has(start)) fail('CAR_TRAPPED', `Cars cannot get back from ${id}`);
    }
  }
  if (footNodes.length > 0) {
    const reach = graph.reachable(footNodes[0] as string, 'FOOT');
    for (const id of footNodes) if (!reach.has(id)) fail('FOOT_UNREACHABLE', `Pedestrians cannot reach ${id}`);
  }

  // Multiple routes: apart from roads leading into a dead end, closing any one
  // car road must leave the town connected (no single chokepoint).
  const deadEnds = new Set(map.nodes.filter((n) => n.kind === 'DEAD_END').map((n) => n.id));
  for (const e of map.edges.filter((edge) => edge.car)) {
    if (deadEnds.has(e.from) || deadEnds.has(e.to)) continue;
    const blocked = new Set([e.id]);
    const reach = reachableIgnoringOneWay(graph, e.from, blocked);
    if (!reach.has(e.to)) fail('SINGLE_ROUTE', `Closing ${e.id} cuts the town in two (only one route)`);
  }

  // ---- Required features ------------------------------------------------
  if (map.width < MAP_REQUIREMENTS.minWidth) fail('TOO_SMALL', `Town is only ${map.width} m wide`);
  if (!map.edges.some((e) => e.bridge && e.car)) fail('NO_BRIDGE', 'No car bridge');
  const lights = map.nodes.filter((n) => n.trafficLight);
  if (lights.length < MAP_REQUIREMENTS.minTrafficLights) fail('FEW_TRAFFIC_LIGHTS', 'Not enough traffic lights');
  for (const n of lights) {
    if (n.kind !== 'JUNCTION') fail('BAD_TRAFFIC_LIGHT', `Traffic light at ${n.id}, which is not a junction`);
  }
  const carDeadEnds = [...deadEnds].filter((id) => graph.edgesAt(id).some((e) => e.car));
  if (carDeadEnds.length < MAP_REQUIREMENTS.minDeadEnds) fail('NO_DEAD_END', 'No dead end for cars');
  if (!map.edges.some((e) => e.foot && !e.car)) fail('NO_FOOTPATH', 'No pedestrian-only paths');

  const junctionDegrees = map.nodes
    .filter((n) => n.kind === 'JUNCTION')
    .map((n) => graph.edgesAt(n.id).filter((e) => e.car).length);
  if (!junctionDegrees.includes(3)) fail('NO_T_JUNCTION', 'No T-junction');
  if (!junctionDegrees.includes(4)) fail('NO_CROSSROADS', 'No four-way junction');

  const ringIds = new Set(map.nodes.map((n) => n.roundaboutId).filter((id): id is string => !!id));
  if (ringIds.size === 0) fail('NO_ROUNDABOUT', 'No roundabout');
  for (const ringId of ringIds) {
    const ring = map.nodes.filter((n) => n.roundaboutId === ringId).map((n) => n.id);
    const ringSet = new Set(ring);
    const ringEdges = map.edges.filter((e) => ringSet.has(e.from) && ringSet.has(e.to));
    if (ring.length < 3) fail('BAD_ROUNDABOUT', `Roundabout ${ringId} has fewer than 3 exits`);
    if (ringEdges.some((e) => !e.oneWay || e.kind !== 'ROUNDABOUT_RING')) {
      fail('BAD_ROUNDABOUT', `Roundabout ${ringId} ring must be one-way ring edges`);
    }
    for (const id of ring) {
      const outs = ringEdges.filter((e) => e.from === id).length;
      const ins = ringEdges.filter((e) => e.to === id).length;
      if (outs !== 1 || ins !== 1) fail('BAD_ROUNDABOUT', `Roundabout node ${id} is not on a single loop`);
      if (graph.edgesAt(id).filter((e) => !ringSet.has(graph.other(e, id))).length !== 1) {
        fail('BAD_ROUNDABOUT', `Roundabout node ${id} must join exactly one road`);
      }
    }
  }

  // ---- Roads versus water -------------------------------------------------
  const water = map.regions.filter((r) => r.kind === 'WATER' || r.kind === 'SEA');
  for (const e of map.edges) {
    if (e.bridge) continue;
    const a = graph.node(e.from);
    const b = graph.node(e.to);
    for (let i = 0; i <= 20; i++) {
      const p = lerp(a, b, i / 20);
      if (water.some((r) => pointInPolygon(p, r.points))) {
        fail('ROAD_IN_WATER', `Edge ${e.id} runs through water but is not a bridge`);
        break;
      }
    }
  }

  // ---- Locations --------------------------------------------------------------
  const placed = new Set(map.locations.map((l) => l.id));
  for (const word of LOCATION_WORDS) {
    if (!placed.has(word.id)) fail('MISSING_LOCATION', `${word.id} (${word.article} ${word.noun}) is not on the map`);
  }
  const carPoints = carNodes.map((id) => graph.node(id));
  for (const loc of map.locations) {
    const word = LOCATION_WORD_BY_ID.get(loc.id);
    if (!word) {
      fail('UNKNOWN_LOCATION', `${loc.id} is not an approved vocabulary location`);
      continue;
    }
    if (word.district !== loc.district) fail('WRONG_DISTRICT', `${loc.id} should be in ${word.district}`);
    if (loc.entrances.length === 0) fail('NO_ENTRANCE', `${loc.id} has no entrance`);
    for (const entrance of loc.entrances) {
      if (!graph.hasEdge(entrance.edgeId)) {
        fail('BAD_ENTRANCE', `${loc.id} entrance is on missing edge ${entrance.edgeId}`);
        continue;
      }
      if (entrance.t < 0 || entrance.t > 1) fail('BAD_ENTRANCE', `${loc.id} entrance position out of range`);
      if (!graph.edge(entrance.edgeId).foot) fail('BAD_ENTRANCE', `${loc.id} entrance is not reachable on foot`);
      const point = graph.entrancePoint(entrance);
      const gap = pointRectDistance(point, loc.footprint);
      if (gap > MAP_REQUIREMENTS.maxEntranceGap) {
        fail('FAR_ENTRANCE', `${loc.id} entrance is ${Math.round(gap)} m from the building`);
      }
    }
    const nearestCar = Math.min(
      ...loc.entrances
        .filter((en) => graph.hasEdge(en.edgeId))
        .flatMap((en) => carPoints.map((p) => distance(p, graph.entrancePoint(en)))),
    );
    if (nearestCar > MAP_REQUIREMENTS.maxWalkFromCar) fail('NO_CAR_ACCESS', `${loc.id} is too far from any road`);

    for (const e of map.edges) {
      if (loc.open && !e.car) continue; // paths may cross parks, squares and the beach
      const clearance = HALF_WIDTH[e.kind] + (e.car ? PAVEMENT : 1);
      if (segmentRectDistance(graph.node(e.from), graph.node(e.to), loc.footprint) < clearance) {
        fail('BUILDING_ON_ROAD', `${loc.id} overlaps ${e.id}`);
      }
    }
  }
  for (let i = 0; i < map.locations.length; i++) {
    for (let j = i + 1; j < map.locations.length; j++) {
      const a = map.locations[i]!;
      const b = map.locations[j]!;
      if (rectsOverlap(a.footprint, b.footprint)) fail('OVERLAP', `${a.id} overlaps ${b.id}`);
    }
  }
  for (const f of map.fillers) {
    for (const loc of map.locations) {
      if (rectsOverlap(f.footprint, loc.footprint)) fail('OVERLAP', `Filler ${f.id} overlaps ${loc.id}`);
    }
  }

  return issues;
}

/** Undirected reachability over car roads (used for the chokepoint check). */
function reachableIgnoringOneWay(graph: TownGraph, start: string, blocked: ReadonlySet<string>): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    for (const e of graph.edgesAt(id)) {
      if (!e.car || blocked.has(e.id)) continue;
      const next = graph.other(e, id);
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
