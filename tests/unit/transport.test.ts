import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { TRANSPORT_LINES } from '../../src/engine/audio/script';
import { Chase, type ChaseEvent } from '../../src/engine/chase/chase';
import { footwayLength } from '../../src/engine/chase/route';
import { generateScenario, validateScenario } from '../../src/engine/chase/scenario';
import {
  CHASE_TYPE_MODES,
  CHASE_TYPE_WEIGHTS,
  CHASE_TYPES,
  TRANSFER,
  type ChaseType,
} from '../../src/engine/chase/settings';
import { DIFFICULTIES, DIFFICULTY_SETTINGS, type Difficulty } from '../../src/engine/difficulty';
import { exitsAt, type TurnIntent } from '../../src/engine/movement/turns';
import { Rng } from '../../src/engine/rng/prng';
import { createSeed } from '../../src/engine/rng/seedCode';
import { TownGraph } from '../../src/engine/world/graph';
import { ListenerBot } from './listenerBot';

const graph = new TownGraph(BELLEVUE);

function seeds(difficulty: Difficulty, count: number, label: string): string[] {
  const rng = Rng.fromSeed(`${label}-${difficulty}`);
  return Array.from({ length: count }, () => createSeed(difficulty, (n) => rng.int(0, n - 1)).code);
}

/** Every (difficulty, chase type) pair the game can draw. */
const PLAYED: [Difficulty, ChaseType][] = DIFFICULTIES.flatMap((d) =>
  CHASE_TYPES.filter((t) => (CHASE_TYPE_WEIGHTS[d][t] ?? 0) > 0).map((t): [Difficulty, ChaseType] => [d, t]),
);
const CHANGING = CHASE_TYPES.filter((t) => CHASE_TYPE_MODES[t].length > 1);

function listen(seed: string, chaseType: ChaseType) {
  const chase = new Chase(graph, generateScenario(graph, seed, { chaseType }));
  const bot = new ListenerBot(graph);
  const announced: string[] = [];
  for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
    for (const e of bot.step(chase, 0.05)) if (e.type === 'ANNOUNCE') announced.push(...e.lines.map((l) => l.audioId));
  }
  return { chase, bot, announced };
}

describe('chase types', () => {
  it('follows the difficulty rules: Easy mostly Car → Car, three-stage chains only at Expert', () => {
    const drawn = (d: Difficulty) => new Set(seeds(d, 200, 'types').map((s) => generateScenario(graph, s).chaseType));
    expect([...drawn('EASY')].sort()).toEqual(['CAR_CAR', 'FOOT_FOOT']);
    expect(drawn('INTERMEDIATE')).toContain('CAR_FOOT');
    expect(drawn('HARD')).toContain('FOOT_CAR');
    expect(drawn('EXPERT')).toEqual(new Set(['CAR_CAR', 'CAR_FOOT', 'FOOT_CAR', 'CAR_FOOT_CAR', 'FOOT_CAR_FOOT']));
    const easy = seeds('EASY', 200, 'types').map((s) => generateScenario(graph, s).chaseType);
    expect(easy.filter((t) => t === 'CAR_CAR').length / easy.length).toBeGreaterThan(0.6);
  }, 60_000);

  it.each(CHASE_TYPES)('builds valid %s chases at every level', (chaseType) => {
    for (const difficulty of DIFFICULTIES) {
      for (const seed of seeds(difficulty, 25, `valid-${chaseType}`)) {
        const scenario = generateScenario(graph, seed, { chaseType });
        expect(validateScenario(graph, scenario), seed).toEqual([]);
        expect(scenario.stages.map((s) => s.mode)).toEqual(CHASE_TYPE_MODES[chaseType]);
        expect(scenario.playerStart.mode).toBe(CHASE_TYPE_MODES[chaseType][0]);
      }
    }
  }, 60_000);

  it('rejects a stage that does not start where the last one ended', () => {
    const scenario = generateScenario(graph, seeds('EXPERT', 1, 'broken')[0]!, { chaseType: 'CAR_FOOT' });
    const [car, foot] = scenario.stages;
    const broken = { ...scenario, stages: [car!, { ...foot!, route: foot!.route.slice(1) }] };
    expect(validateScenario(graph, broken).join()).toMatch(/does not lead into the next stage/);
  });

  it('gives extra time for each change of transport', () => {
    const seed = seeds('EXPERT', 1, 'time')[0]!;
    const time = (chaseType: ChaseType) => new Chase(graph, generateScenario(graph, seed, { chaseType })).status.timeLeft;
    expect(time('CAR_CAR')).toBe(DIFFICULTY_SETTINGS.EXPERT.timeLimitSeconds);
    expect(time('CAR_FOOT_CAR')).toBe(DIFFICULTY_SETTINGS.EXPERT.timeLimitSeconds + 2 * TRANSFER.extraSeconds);
  });
});

describe('foot routes', () => {
  it('cut through the park, the square, alleys, the footbridge and the promenade', () => {
    let share = 0;
    const list = seeds('INTERMEDIATE', 30, 'footways');
    for (const seed of list) {
      const stage = generateScenario(graph, seed, { chaseType: 'FOOT_FOOT' }).stages[0]!;
      share += footwayLength(graph, stage.route) / stage.length;
    }
    expect(share / list.length).toBeGreaterThan(0.25);
  });
});

describe('changing transport in a chase', () => {
  it.each(PLAYED)('a student who understands the French catches the suspect (%s, %s)', (difficulty, chaseType) => {
    const runs = seeds(difficulty, 40, `listen-${chaseType}`).map((s) => listen(s, chaseType));
    const captured = runs.filter((r) => r.chase.status.phase === 'CAPTURED').length;
    expect(captured / runs.length).toBeGreaterThanOrEqual(0.95);
    // Following the French never earns a correction, and every order can be obeyed.
    expect(runs.filter((r) => r.bot.log.some((t) => t.kind === 'RECOVERY')).map((r) => r.chase.scenario.seed)).toEqual([]);
    expect(runs.flatMap((r) => r.bot.failedOrders)).toEqual([]);
  }, 60_000);

  it.each(CHANGING)('announces the suspect getting out, then orders the player out (%s)', (chaseType) => {
    let checked = 0;
    for (const seed of seeds('EXPERT', 30, `order-${chaseType}`)) {
      const { chase, announced } = listen(seed, chaseType);
      if (chase.suspectStage === 0) continue; // caught before the first change
      checked++;
      const firstChange = CHASE_TYPE_MODES[chaseType][1];
      const expected =
        firstChange === 'FOOT'
          ? [TRANSPORT_LINES.SUSPECT_LEFT_CAR, TRANSPORT_LINES.ON_FOOT, TRANSPORT_LINES.GET_OUT]
          : [TRANSPORT_LINES.SUSPECT_BOARDS, TRANSPORT_LINES.GET_IN];
      // Vehicles and a lost signal are other events, checked elsewhere.
      const transport = announced.filter((id) => !id.startsWith('event.vehicle.') && id !== 'event.lost_signal');
      expect(transport.slice(0, expected.length), seed).toEqual(expected.map((l) => l.audioId));
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('cannot catch a runner from the car: the player must get out', () => {
    let checked = 0;
    for (const seed of seeds('INTERMEDIATE', 30, 'runner')) {
      const chase = new Chase(graph, generateScenario(graph, seed, { chaseType: 'CAR_FOOT' }));
      chase.player.followPlan(chase.scenario.route.slice(1));
      // Hang back so the suspect is out and running before we arrive.
      for (let t = 0; t < 120 && chase.suspectStage === 0 && chase.status.phase === 'PURSUIT'; t += 0.05) {
        chase.player.setThrottle(chase.status.distance < 150 ? 'BRAKE' : 'CRUISE');
        chase.update(0.05);
      }
      if (chase.status.phase !== 'PURSUIT') continue;
      for (let t = 0; t < 3; t += 0.05) chase.update(0.05); // the suspect is running
      const runningOn = graph.edge(chase.suspect.location().edgeId);
      if (chase.suspect.mode !== 'FOOT' || chase.player.mode !== 'CAR' || !runningOn.car) continue;
      chase.teleportPlayerToSuspect();
      for (let t = 0; t < 2; t += 0.05) chase.update(0.05);
      expect(chase.status.phase, seed).toBe('PURSUIT');
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('brings the police car when the suspect drives off, and the player can get in', () => {
    for (const seed of seeds('HARD', 20, 'pickup')) {
      const { chase } = listen(seed, 'FOOT_CAR');
      if (chase.suspectStage === 0) continue;
      // A last-second crash adds a stage on foot after the car.
      expect(chase.playerStage, seed).toBeGreaterThanOrEqual(1);
      if (chase.status.phase === 'PURSUIT' && chase.playerStage === 1) expect(chase.player.mode).toBe('CAR');
    }
  });

  it('a player who turns at random still usually loses the suspect', () => {
    const results: string[] = [];
    for (const [difficulty, chaseType] of PLAYED.filter(([d, t]) => d !== 'EASY' && t !== 'CAR_CAR')) {
      for (const seed of seeds(difficulty, 12, `random-${chaseType}`)) {
        const chase = new Chase(graph, generateScenario(graph, seed, { chaseType }));
        const rng = Rng.fromSeed(`random-${seed}`);
        let lastEdge = '';
        for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
          // It obeys "Descendez / Montez" (anyone would), but picks turns at random.
          if (chase.status.switchTo) chase.toggleMode();
          const me = chase.player.snapshot();
          if (me.edgeId !== lastEdge || me.waiting) {
            lastEdge = me.edgeId;
            const exits = exitsAt(graph, graph.edge(me.edgeId), me.towards, me.mode);
            if (exits.length > 0) chase.player.queue(rng.pick(exits).kind as TurnIntent);
            else chase.player.uTurn();
          }
          const events: ChaseEvent[] = chase.update(0.05);
          void events;
        }
        results.push(chase.status.phase);
      }
    }
    expect(results.filter((p) => p === 'CAPTURED').length / results.length).toBeLessThanOrEqual(0.15);
  }, 60_000);
});
