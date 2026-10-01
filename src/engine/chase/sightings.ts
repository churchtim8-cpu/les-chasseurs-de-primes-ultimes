/**
 * Suspect sightings (blueprint section 18), planned with the chase (pipeline
 * step VALID EVENTS): as the suspect passes a place, the scanner reports it
 * ("La voiture verte est près de la bibliothèque.") and the player picks the
 * matching suspect from a few choices, each a vehicle and a place.
 *
 * The choices are built so that exactly one matches what was said: from
 * Intermediate up, one decoy is the right vehicle at the wrong place and
 * another the wrong vehicle at the right place, so both must be understood.
 * At Expert a driving suspect's vehicle is not repeated in the sighting
 * ("Le suspect est près de la bibliothèque."): the player must remember it
 * from the start of the stage (memory across transmissions, section 10).
 */

import type { Difficulty } from '../difficulty';
import { LOCATION_WORD_BY_ID } from '../language/locations';
import type { Rng } from '../rng/prng';
import { pointRectDistance, type Point } from '../world/geometry';
import type { TownGraph } from '../world/graph';
import { pathLength } from './route';
import { CHASE_SETTINGS, SIGHTING, VEHICLES, type Vehicle } from './settings';
import type { ChaseStage } from './scenario';

/** One choice: a vehicle (null on foot) at a place. */
export interface SightingCard {
  vehicle: Vehicle | null;
  place: string;
}

export interface Sighting {
  stage: number;
  /** The call comes as the suspect passes this node (index in the stage route). */
  at: number;
  /** The place the suspect is near (a location ID). */
  place: string;
  /** The vehicle named in the call, or null for "Le suspect" (on foot, or Expert memory). */
  named: Vehicle | null;
  cards: SightingCard[];
  /** Index of the right card. */
  answer: number;
}

/** The nearest place with a French name to a point, if within `within` metres of its building. */
export function nearestPlace(graph: TownGraph, p: Point, within: number = SIGHTING.nearWithin): string | null {
  let best: { id: string; d: number } | null = null;
  for (const location of graph.map.locations) {
    if (!LOCATION_WORD_BY_ID.has(location.id)) continue;
    const d = pointRectDistance(p, location.footprint);
    if (d <= within && (!best || d < best.d)) best = { id: location.id, d };
  }
  return best?.id ?? null;
}

/** Places with a French name that are not near a point (decoy places). */
function farPlaces(graph: TownGraph, p: Point): string[] {
  return graph.map.locations
    .filter((l) => LOCATION_WORD_BY_ID.has(l.id) && pointRectDistance(p, l.footprint) > SIGHTING.nearWithin * 2)
    .map((l) => l.id);
}

/** Does a card match the call (with the vehicle the player was told about)? */
export function cardMatches(card: SightingCard, place: string, vehicle: Vehicle | null): boolean {
  return card.place === place && card.vehicle === vehicle;
}

export function planSightings(
  graph: TownGraph,
  rng: Rng,
  stages: readonly ChaseStage[],
  vehicles: readonly (Vehicle | null)[],
  difficulty: Difficulty,
  suspectStartsAt: number,
  /** At least this many (debug and tests force sightings on even where the level has none). */
  atLeast = 0,
): Sighting[] {
  const { cards } = CHASE_SETTINGS[difficulty].sightings;
  const count = Math.max(CHASE_SETTINGS[difficulty].sightings.count, atLeast);
  const candidates: { stage: number; at: number; s: number; place: string }[] = [];
  for (const [stage, { route, length }] of stages.entries()) {
    const earliest = (stage === 0 ? suspectStartsAt : 0) + SIGHTING.minFromStart;
    let s = 0;
    for (let i = 1; i < route.length - 1; i++) {
      s += pathLength(graph, [route[i - 1] as string, route[i] as string]);
      if (s < earliest || length - s < length * SIGHTING.minRemainingShare) continue;
      const place = nearestPlace(graph, graph.node(route[i] as string));
      if (place) candidates.push({ stage, at: i, s, place });
    }
  }
  const chosen: typeof candidates = [];
  for (const c of rng.shuffle(candidates)) {
    if (chosen.length >= count) break;
    const clash = chosen.some(
      (o) => o.place === c.place || (o.stage === c.stage && Math.abs(o.s - c.s) < SIGHTING.spacing),
    );
    if (!clash) chosen.push(c);
  }
  chosen.sort((a, b) => a.stage - b.stage || a.at - b.at);

  return chosen.map(({ stage, at, place }) => {
    const own = vehicles[stage] ?? null;
    const others = rng.shuffle(farPlaces(graph, graph.node((stages[stage] as ChaseStage).route[at] as string)));
    const otherVehicles = rng.shuffle(VEHICLES.filter((v) => v !== own));
    const real: SightingCard = { vehicle: own, place };
    const decoys: SightingCard[] = [];
    if (own === null) {
      for (let k = 0; k < cards - 1; k++) decoys.push({ vehicle: null, place: others[k] as string });
    } else if (cards === 2) {
      decoys.push({ vehicle: otherVehicles[0] as Vehicle, place: others[0] as string });
    } else {
      // Right vehicle at the wrong place, wrong vehicle at the right place, then any others.
      decoys.push({ vehicle: own, place: others[0] as string });
      decoys.push({ vehicle: otherVehicles[0] as Vehicle, place });
      for (let k = 2; k < cards - 1; k++) {
        decoys.push({ vehicle: otherVehicles[k - 1] as Vehicle, place: others[k - 1] as string });
      }
    }
    const all = rng.shuffle([real, ...decoys]);
    return {
      stage,
      at,
      place,
      named: own !== null && difficulty !== 'EXPERT' ? own : null,
      cards: all,
      answer: all.indexOf(real),
    };
  });
}

/**
 * The suspect's vehicle in each stage (null on foot). A car it gets into
 * mid-chase ("Il monte dans une voiture !") is a car, not the van, and never
 * the one it left behind.
 */
export function pickVehicles(rng: Rng, stages: readonly ChaseStage[]): (Vehicle | null)[] {
  const used = new Set<Vehicle>();
  return stages.map((stage, i) => {
    if (stage.mode !== 'CAR') return null;
    const vehicle = rng.pick(VEHICLES.filter((v) => !used.has(v) && (i === 0 || v !== 'VAN')));
    used.add(vehicle);
    return vehicle;
  });
}

/** Pipeline step "VALIDATE CHASE" for sightings: true calls with exactly one matching choice. */
export function sightingProblems(
  graph: TownGraph,
  stages: readonly ChaseStage[],
  vehicles: readonly (Vehicle | null)[],
  sightings: readonly Sighting[],
): string[] {
  const problems: string[] = [];
  for (const [i, stage] of stages.entries()) {
    const vehicle = vehicles[i] ?? null;
    if ((stage.mode === 'CAR') !== (vehicle !== null)) problems.push(`Stage ${i + 1} vehicle does not match its mode`);
    if (i > 0 && vehicle === 'VAN') problems.push(`Stage ${i + 1}: the suspect gets into a van, not a car`);
    if (vehicle && vehicles.indexOf(vehicle) !== i) problems.push(`Stage ${i + 1} reuses an abandoned vehicle`);
  }
  for (const [i, s] of sightings.entries()) {
    const label = `Sighting ${i + 1}`;
    const stage = stages[s.stage];
    const node = stage?.route[s.at];
    if (!stage || !node || s.at < 1 || s.at > stage.route.length - 2) {
      problems.push(`${label} is not on the route`);
      continue;
    }
    if (nearestPlace(graph, graph.node(node)) !== s.place) problems.push(`${label}: the suspect is not near that place`);
    const own = vehicles[s.stage] ?? null;
    if (s.named !== null && s.named !== own) problems.push(`${label} names the wrong vehicle`);
    const matching = s.cards.filter((c) => cardMatches(c, s.place, own));
    if (matching.length !== 1 || !cardMatches(s.cards[s.answer] as SightingCard, s.place, own)) {
      problems.push(`${label} does not have exactly one right choice`);
    }
    const keys = new Set(s.cards.map((c) => `${c.vehicle}-${c.place}`));
    if (keys.size !== s.cards.length) problems.push(`${label} repeats a choice`);
  }
  return problems;
}
