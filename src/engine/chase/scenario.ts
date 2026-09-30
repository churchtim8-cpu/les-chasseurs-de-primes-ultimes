/**
 * A generated chase, reproducible from its seed code. This milestone covers
 * the route part of the pipeline (MAP → VALID ROUTE → VALIDATE CHASE); the
 * French instructions, audio and transport changes are added in later
 * milestones and slot in after validation.
 */

import type { Difficulty } from '../difficulty';
import type { MoverStart } from '../movement/mover';
import { Rng } from '../rng/prng';
import { parseSeed } from '../rng/seedCode';
import type { TownGraph } from '../world/graph';
import { arrivalNode, followProblem, generateRoute, pathLength, placeOnRoute } from './route';
import { CHASE_SETTINGS } from './settings';

export type ChaseType = 'CAR_CAR';

/** Metres into the route where the player starts. */
const PLAYER_OFFSET = 10;

export interface ChaseScenario {
  seed: string;
  difficulty: Difficulty;
  chaseType: ChaseType;
  /** The suspect's full route, starting where the player starts. */
  route: string[];
  routeLength: number;
  /** Location ID the suspect is heading for. */
  destination: string;
  playerStart: MoverStart;
  suspectStart: MoverStart;
  /** Nodes the suspect will follow, starting with the node it is heading towards. */
  suspectPlan: string[];
}

export function generateScenario(graph: TownGraph, seedCode: string): ChaseScenario {
  const parsed = parseSeed(seedCode);
  if (!parsed.ok) throw new Error(parsed.error);
  const { code, difficulty } = parsed.seed;
  const settings = CHASE_SETTINGS[difficulty];
  const rng = Rng.fromSeed(code);

  const route = generateRoute(graph, rng.fork('route'), { length: settings.routeLength, mode: 'CAR' });
  const player = placeOnRoute(graph, route.nodes, PLAYER_OFFSET, 'CAR');
  const suspect = placeOnRoute(graph, route.nodes, PLAYER_OFFSET + settings.headStart, 'CAR');

  const scenario: ChaseScenario = {
    seed: code,
    difficulty,
    chaseType: 'CAR_CAR',
    route: route.nodes,
    routeLength: route.length,
    destination: route.destination,
    playerStart: player.start,
    suspectStart: suspect.start,
    suspectPlan: suspect.plan,
  };
  const problems = validateScenario(graph, scenario);
  if (problems.length > 0) throw new Error(`Invalid chase ${code}: ${problems.join('; ')}`);
  return scenario;
}

/** Pipeline step "VALIDATE CHASE": every check a generated chase must pass. */
export function validateScenario(graph: TownGraph, s: ChaseScenario): string[] {
  const problems: string[] = [];
  const settings = CHASE_SETTINGS[s.difficulty];
  if (s.route.some((id) => !graph.hasNode(id))) return ['Route uses an unknown node'];

  const follow = followProblem(graph, s.route, 'CAR');
  if (follow) problems.push(follow);
  if (new Set(s.route).size !== s.route.length) problems.push('Route visits a node twice');

  const length = pathLength(graph, s.route);
  if (Math.abs(length - s.routeLength) > 0.01) problems.push('Route length does not match');
  if (length < settings.routeLength[0] || length > settings.routeLength[1]) problems.push('Route length out of range');

  const destination = graph.map.locations.find((l) => l.id === s.destination);
  if (!destination) problems.push(`Destination ${s.destination} is not on the map`);
  else if (arrivalNode(graph, destination, 'CAR') !== s.route[s.route.length - 1]) {
    problems.push('Route does not end at the destination');
  }

  const firstEdge = graph.edgeBetween(s.route[0] as string, s.route[1] as string);
  if (s.playerStart.edgeId !== firstEdge?.id || s.playerStart.towards !== s.route[1]) {
    problems.push('Player does not start at the beginning of the route');
  }
  if (s.suspectPlan[0] !== s.suspectStart.towards) problems.push('Suspect plan does not match its start');
  const planStart = s.route.indexOf(s.suspectPlan[0] as string);
  if (planStart < 1 || s.route.slice(planStart).join() !== s.suspectPlan.join()) {
    problems.push('Suspect plan is not the rest of the route');
  }
  return problems;
}
