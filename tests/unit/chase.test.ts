import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { Chase } from '../../src/engine/chase/chase';
import { roadDistance } from '../../src/engine/chase/distance';
import { generateScenario, validateScenario } from '../../src/engine/chase/scenario';
import { DIFFICULTIES, type Difficulty } from '../../src/engine/difficulty';
import { Mover } from '../../src/engine/movement/mover';
import { exitsAt, type TurnIntent } from '../../src/engine/movement/turns';
import { Rng } from '../../src/engine/rng/prng';
import { createSeed } from '../../src/engine/rng/seedCode';
import { TownGraph } from '../../src/engine/world/graph';

const graph = new TownGraph(BELLEVUE);

function seeds(difficulty: Difficulty, count: number, label = 'tests'): string[] {
  const rng = Rng.fromSeed(`${label}-${difficulty}`);
  return Array.from({ length: count }, () => createSeed(difficulty, (n) => rng.int(0, n - 1)).code);
}

describe('chase generation', () => {
  it.each(DIFFICULTIES)('generates valid chases for %s', (difficulty) => {
    for (const seed of seeds(difficulty, 300)) {
      const scenario = generateScenario(graph, seed);
      expect(validateScenario(graph, scenario)).toEqual([]);
    }
  });

  it('recreates exactly the same chase from the same seed', () => {
    for (const seed of seeds('HARD', 50)) {
      expect(generateScenario(graph, seed)).toEqual(generateScenario(graph, seed));
    }
  });

  it('varies routes and destinations (no fixed suspect routes)', () => {
    const scenarios = seeds('EASY', 200).map((s) => generateScenario(graph, s));
    expect(new Set(scenarios.map((s) => s.route.join())).size).toBeGreaterThan(190);
    expect(new Set(scenarios.map((s) => s.destination)).size).toBeGreaterThanOrEqual(25);
  });

  it('rejects a doctored chase', () => {
    const scenario = generateScenario(graph, seeds('EASY', 1)[0]!);
    const broken = { ...scenario, route: [...scenario.route].reverse() };
    expect(validateScenario(graph, broken).length).toBeGreaterThan(0);
    const teleport = { ...scenario, route: [scenario.route[0]!, ...scenario.route.slice(2)] };
    expect(validateScenario(graph, teleport).length).toBeGreaterThan(0);
  });

  it('rejects malformed seed codes', () => {
    expect(() => generateScenario(graph, 'hello')).toThrow();
  });
});

describe('road distance', () => {
  const at = (edgeId: string, t: number, towards: string) => ({ edgeId, t, towards, mode: 'CAR' as const });

  it('measures along the same road', () => {
    expect(roadDistance(graph, at('c3r2-c4r2', 0.1, 'c4r2'), at('c3r2-c4r2', 0.6, 'c4r2'), 'CAR')).toBeCloseTo(110, 0);
  });

  it('counts a suspect behind you as reachable by turning around', () => {
    expect(roadDistance(graph, at('c3r2-c4r2', 0.6, 'c4r2'), at('c3r2-c4r2', 0.1, 'c4r2'), 'CAR')).toBeCloseTo(110, 0);
  });

  it('follows the roads, not a straight line', () => {
    // Either side of the park: 220 m apart in a straight line, much further by car.
    const d = roadDistance(graph, at('c6r2-c7r2', 0.99, 'c7r2'), at('c8r2-c9r2', 0.01, 'c9r2'), 'CAR');
    expect(d).toBeGreaterThan(450);
    const walk = roadDistance(
      graph,
      { edgeId: 'c6r2-c7r2', t: 0.99, towards: 'c7r2', mode: 'FOOT' },
      { edgeId: 'c8r2-c9r2', t: 0.01, towards: 'c9r2', mode: 'FOOT' },
      'FOOT',
    );
    expect(walk).toBeLessThan(240);
  });
});

/** Plays a whole chase with a simple bot. `choose` picks a turn at each junction. */
function play(seed: string, bot: 'LISTENER' | 'RANDOM', rng = Rng.fromSeed(`bot-${seed}`)) {
  const chase = new Chase(graph, generateScenario(graph, seed));
  if (bot === 'LISTENER') chase.player.followPlan(chase.scenario.route.slice(1));
  let lastEdge = '';
  for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
    if (bot === 'RANDOM') {
      const me = chase.player.snapshot();
      if (me.edgeId !== lastEdge || me.waiting) {
        lastEdge = me.edgeId;
        const exits = exitsAt(graph, graph.edge(me.edgeId), me.towards, 'CAR');
        if (exits.length > 0) chase.player.queue(rng.pick(exits).kind as TurnIntent);
        else chase.player.uTurn();
      }
    }
    chase.update(0.05);
  }
  return chase.status;
}

describe('pursuit balance (comprehension must beat luck)', () => {
  it.each(DIFFICULTIES)('a player who follows the route catches the suspect (%s)', (difficulty) => {
    const results = seeds(difficulty, 60, 'balance').map((s) => play(s, 'LISTENER'));
    const captured = results.filter((r) => r.phase === 'CAPTURED').length;
    expect(captured / results.length).toBeGreaterThanOrEqual(0.95);
  });

  // Easy is the most forgiving (the suspect is slowest), so a lucky run happens more often.
  const LUCK_LIMIT: Record<Difficulty, number> = { EASY: 0.2, INTERMEDIATE: 0.1, HARD: 0.05, EXPERT: 0.05 };

  it.each(DIFFICULTIES)('a player who turns at random usually loses the suspect (%s)', (difficulty) => {
    const results = seeds(difficulty, 80, 'balance').map((s) => play(s, 'RANDOM'));
    const captured = results.filter((r) => r.phase === 'CAPTURED').length;
    expect(captured / results.length).toBeLessThanOrEqual(LUCK_LIMIT[difficulty]);
  });

  it('one wrong turn costs distance but is recoverable', () => {
    // Follow the route but take one detour early, then return to following.
    let recovered = 0;
    const all = seeds('EASY', 40, 'detour');
    for (const seed of all) {
      const chase = new Chase(graph, generateScenario(graph, seed));
      const route = chase.scenario.route;
      // Drive 3 s along the route, then wander off for a block.
      chase.player.followPlan(route.slice(1));
      for (let t = 0; t < 3; t += 0.05) chase.update(0.05);
      const before = chase.status.distance;
      const me = chase.player.snapshot();
      const detour = new Mover(graph, chase.player.location());
      chase.player = detour;
      const exits = exitsAt(graph, graph.edge(me.edgeId), me.towards, 'CAR');
      const wrong = exits.find((e) => route.indexOf(e.step.to) === -1);
      if (!wrong) continue;
      detour.queue(wrong.kind as TurnIntent);
      for (let t = 0; t < 6 && chase.status.phase === 'PURSUIT'; t += 0.05) chase.update(0.05);
      expect(chase.status.distance).toBeGreaterThan(before);
      recovered++;
    }
    expect(recovered).toBeGreaterThan(10);
  });
});

describe('capture rules', () => {
  it('captures a player who stays on the suspect in the car (debug jump)', () => {
    let captured = 0;
    const list = seeds('EXPERT', 40, 'capture');
    for (const seed of list) {
      const chase = new Chase(graph, generateScenario(graph, seed));
      for (let i = 0; i < 30; i++) chase.update(0.1);
      chase.teleportPlayerToSuspect();
      for (let i = 0; i < 20 && chase.status.phase === 'PURSUIT'; i++) chase.update(0.1);
      if (chase.status.phase === 'CAPTURED') captured++;
    }
    expect(captured).toBeGreaterThanOrEqual(list.length * 0.9);
  });
});
