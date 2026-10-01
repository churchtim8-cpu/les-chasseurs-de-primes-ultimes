/**
 * A generated chase, reproducible from its seed code: pipeline steps MAP →
 * VALID ROUTE → TRANSPORTATION STAGES → VALIDATE CHASE. The French
 * instructions and audio are chosen live from this route by the navigator.
 *
 * A chase has one stage per mode of transport. In a Car → Foot chase the
 * suspect drives to a junction, gets out and runs on; the player is told to
 * get out too, and follows on foot.
 */

import type { Difficulty } from '../difficulty';
import { actionIndices, describable } from '../language/generate';
import type { MoverStart } from '../movement/mover';
import { Rng } from '../rng/prng';
import { parseSeed } from '../rng/seedCode';
import type { TownGraph, TravelMode } from '../world/graph';
import { arrivalNode, followProblem, generateRoute, pathLength, placeOnRoute, transferNodes } from './route';
import {
  CHASE_SETTINGS,
  CHASE_TYPE_MODES,
  CHASE_TYPE_WEIGHTS,
  CHASE_TYPES,
  type ChaseSettings,
  type ChaseType,
} from './settings';

export type { ChaseType } from './settings';

/** Metres into the route where the player starts. */
const PLAYER_OFFSET = 10;

export interface ChaseStage {
  mode: TravelMode;
  /** Nodes in order. Each later stage starts where the previous one ended. */
  route: string[];
  length: number;
}

export interface ChaseScenario {
  seed: string;
  difficulty: Difficulty;
  chaseType: ChaseType;
  /** The suspect's route stage by stage; the first starts where the player starts. */
  stages: ChaseStage[];
  /** The first stage's route (the whole route in a one-stage chase). */
  route: string[];
  /** Total length of all stages. */
  routeLength: number;
  /** Location ID the suspect is heading for (at the end of the last stage). */
  destination: string;
  playerStart: MoverStart;
  suspectStart: MoverStart;
  /** Nodes the suspect will follow in the first stage, starting with the node it is heading towards. */
  suspectPlan: string[];
}

export interface ScenarioOptions {
  /** Debug and tests: force a chase type instead of drawing one from the seed. */
  chaseType?: ChaseType;
}

/** The chase type a seed gives at its difficulty (its own random stream, so routes are not reshuffled). */
export function pickChaseType(rng: Rng, difficulty: Difficulty): ChaseType {
  const weights = CHASE_TYPE_WEIGHTS[difficulty];
  const types = CHASE_TYPES.filter((t) => (weights[t] ?? 0) > 0);
  return rng.weighted(
    types,
    types.map((t) => weights[t] as number),
  );
}

function stageLength(settings: ChaseSettings, modes: readonly TravelMode[], mode: TravelMode): [number, number] {
  if (modes.length > 1) return settings.stageLength[mode];
  return mode === 'CAR' ? settings.routeLength : settings.footRouteLength;
}

export function generateScenario(graph: TownGraph, seedCode: string, options: ScenarioOptions = {}): ChaseScenario {
  const parsed = parseSeed(seedCode);
  if (!parsed.ok) throw new Error(parsed.error);
  const { code, difficulty } = parsed.seed;
  const settings = CHASE_SETTINGS[difficulty];
  const rng = Rng.fromSeed(code);
  const chaseType = options.chaseType ?? pickChaseType(rng.fork('stages'), difficulty);
  const modes = CHASE_TYPE_MODES[chaseType];
  const routeRng = rng.fork('route');

  // A later stage can be impossible from where an earlier one ended: start the chase again.
  let planned: { stages: ChaseStage[]; destination: string } | null = null;
  for (let attempt = 0; attempt < 40 && !planned; attempt++) {
    planned = planStages(graph, routeRng, settings, modes, difficulty);
  }
  if (!planned) throw new Error(`No valid ${chaseType} chase for ${code}`);
  const { stages, destination } = planned;

  const first = stages[0] as ChaseStage;
  const player = placeOnRoute(graph, first.route, PLAYER_OFFSET, first.mode);
  const headStart = Math.min(settings.headStart[first.mode], first.length - PLAYER_OFFSET - 20);
  const suspect = placeOnRoute(graph, first.route, PLAYER_OFFSET + headStart, first.mode);

  const scenario: ChaseScenario = {
    seed: code,
    difficulty,
    chaseType,
    stages,
    route: first.route,
    routeLength: stages.reduce((n, s) => n + s.length, 0),
    destination,
    playerStart: player.start,
    suspectStart: suspect.start,
    suspectPlan: suspect.plan,
  };
  const problems = validateScenario(graph, scenario);
  if (problems.length > 0) throw new Error(`Invalid chase ${code}: ${problems.join('; ')}`);
  return scenario;
}

/** One route per stage, each starting where the last one ended; null if a stage cannot be built. */
function planStages(
  graph: TownGraph,
  rng: Rng,
  settings: ChaseSettings,
  modes: readonly TravelMode[],
  difficulty: Difficulty,
): { stages: ChaseStage[]; destination: string } | null {
  const stages: ChaseStage[] = [];
  const used = new Set<string>();
  let destination: string | null = null;
  for (const [i, mode] of modes.entries()) {
    const previous = stages[i - 1];
    const at = previous?.route[previous.route.length - 1];
    const arrivedBy =
      previous && at ? graph.edgeBetween(previous.route[previous.route.length - 2] as string, at)?.id : undefined;
    try {
      const route = generateRoute(
        graph,
        rng,
        {
          length: stageLength(settings, modes, mode),
          mode,
          // The suspect does not double back over ground it has already covered, and a stage that
          // ends in a change of transport has at least one turn to announce (it has no final line).
          accept: (nodes) =>
            nodes.slice(1).every((n) => !used.has(n)) &&
            (i === modes.length - 1 || actionIndices(graph, nodes, mode).length > 0) &&
            describable(graph, nodes, mode, difficulty),
          ...(at ? { from: at } : {}),
          ...(arrivedBy ? { avoidEdge: arrivedBy } : {}),
          ...(i < modes.length - 1 ? { transferTo: modes[i + 1] as TravelMode } : {}),
        },
        i === 0 ? 400 : 150,
      );
      stages.push({ mode, route: route.nodes, length: route.length });
      for (const n of route.nodes) used.add(n);
      destination = route.destination;
    } catch {
      return null;
    }
  }
  return destination ? { stages, destination } : null;
}

/** Pipeline step "VALIDATE CHASE": every check a generated chase must pass. */
export function validateScenario(graph: TownGraph, s: ChaseScenario): string[] {
  const problems: string[] = [];
  const settings = CHASE_SETTINGS[s.difficulty];
  const modes = CHASE_TYPE_MODES[s.chaseType];
  if (s.stages.length !== modes.length) return ['Stages do not match the chase type'];

  let total = 0;
  for (const [i, stage] of s.stages.entries()) {
    const label = `Stage ${i + 1}`;
    if (stage.mode !== modes[i]) problems.push(`${label} has the wrong mode`);
    if (stage.route.some((id) => !graph.hasNode(id))) return [`${label} uses an unknown node`];
    const follow = followProblem(graph, stage.route, stage.mode);
    if (follow) problems.push(`${label}: ${follow}`);
    if (new Set(stage.route).size !== stage.route.length) problems.push(`${label} visits a node twice`);
    const earlier = new Set(s.stages.slice(0, i).flatMap((e) => e.route));
    if (stage.route.slice(1).some((n) => earlier.has(n))) problems.push(`${label} doubles back over an earlier stage`);
    if (!describable(graph, stage.route, stage.mode, s.difficulty)) {
      problems.push(`${label} needs a roundabout exit this level cannot name`);
    }
    const length = pathLength(graph, stage.route);
    total += length;
    if (Math.abs(length - stage.length) > 0.01) problems.push(`${label} length does not match`);
    const [min, max] = stageLength(settings, modes, stage.mode);
    if (length < min || length > max) problems.push(`${label} length out of range`);

    const next = s.stages[i + 1];
    if (next) {
      const at = stage.route[stage.route.length - 1] as string;
      if (next.route[0] !== at) problems.push(`${label} does not lead into the next stage`);
      if (!transferNodes(graph, stage.mode, next.mode).includes(at)) {
        problems.push(`${label} ends where the suspect cannot change transport`);
      }
    }
  }
  if (Math.abs(total - s.routeLength) > 0.01) problems.push('Route length does not match');
  if (s.route.join() !== s.stages[0]?.route.join()) problems.push('Route is not the first stage');

  const last = s.stages[s.stages.length - 1] as ChaseStage;
  const destination = graph.map.locations.find((l) => l.id === s.destination);
  if (!destination) problems.push(`Destination ${s.destination} is not on the map`);
  else if (arrivalNode(graph, destination, last.mode) !== last.route[last.route.length - 1]) {
    problems.push('Route does not end at the destination');
  }

  const firstMode = modes[0] as TravelMode;
  const firstEdge = graph.edgeBetween(s.route[0] as string, s.route[1] as string);
  if (s.playerStart.edgeId !== firstEdge?.id || s.playerStart.towards !== s.route[1]) {
    problems.push('Player does not start at the beginning of the route');
  }
  if (s.playerStart.mode !== firstMode || s.suspectStart.mode !== firstMode) {
    problems.push('Player and suspect do not start in the first stage’s mode');
  }
  if (s.suspectPlan[0] !== s.suspectStart.towards) problems.push('Suspect plan does not match its start');
  const planStart = s.route.indexOf(s.suspectPlan[0] as string);
  if (planStart < 1 || s.route.slice(planStart).join() !== s.suspectPlan.join()) {
    problems.push('Suspect plan is not the rest of the route');
  }
  return problems;
}
