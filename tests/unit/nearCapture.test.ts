import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { EVENT_LINES, TRANSPORT_LINES } from '../../src/engine/audio/script';
import { Chase, type ChaseEvent } from '../../src/engine/chase/chase';
import { generateScenario, type ScenarioOptions } from '../../src/engine/chase/scenario';
import { DIFFICULTIES, type Difficulty } from '../../src/engine/difficulty';
import { Rng } from '../../src/engine/rng/prng';
import { createSeed } from '../../src/engine/rng/seedCode';
import { TownGraph } from '../../src/engine/world/graph';
import { ListenerBot } from './listenerBot';

const graph = new TownGraph(BELLEVUE);

function seeds(difficulty: Difficulty, count: number, label: string): string[] {
  const rng = Rng.fromSeed(`${label}-${difficulty}`);
  return Array.from({ length: count }, () => createSeed(difficulty, (n) => rng.int(0, n - 1)).code);
}

/** Plays a chase with the listening bot, keeping every event. */
function listen(seed: string, options: ScenarioOptions) {
  const chase = new Chase(graph, generateScenario(graph, seed, options));
  const bot = new ListenerBot(graph);
  const events: ChaseEvent[] = [];
  for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) events.push(...bot.step(chase, 0.05));
  return { chase, bot, events };
}

const spoken = (events: ChaseEvent[]) => events.flatMap((e) => (e.type === 'ANNOUNCE' ? e.lines.map((l) => l.audioId) : []));

describe('last-second escapes are planned from the seed', () => {
  it('never at Easy; crashes from Intermediate; U-turns at Hard and Expert only', () => {
    for (const difficulty of DIFFICULTIES) {
      const kinds = new Set(seeds(difficulty, 60, 'near-plan').map((s) => generateScenario(graph, s).nearCapture));
      if (difficulty === 'EASY') expect([...kinds]).toEqual([null]);
      if (difficulty === 'INTERMEDIATE') expect([...kinds].sort()).toEqual(['CRASH', null].sort());
      if (difficulty === 'HARD' || difficulty === 'EXPERT') expect(kinds).toEqual(new Set(['CRASH', 'DODGE', null]));
    }
  });

  it('a crash only comes in a chase that ends in a car', () => {
    for (const seed of seeds('HARD', 30, 'near-foot')) {
      expect(generateScenario(graph, seed, { chaseType: 'FOOT_FOOT', nearCapture: 'CRASH' }).nearCapture).toBeNull();
    }
  });
});

describe('the suspect crashes and runs just before the arrest', () => {
  it.each(['INTERMEDIATE', 'HARD'] as const)('the scanner orders the player out, and a listener still catches it on foot (%s)', (difficulty) => {
    const runs = seeds(difficulty, 40, 'near-crash').map((s) => listen(s, { chaseType: 'CAR_CAR', nearCapture: 'CRASH' }));
    const crashed = runs.filter((r) => r.events.some((e) => e.type === 'SUSPECT_CRASH'));
    expect(crashed.length).toBeGreaterThanOrEqual(runs.length * 0.85);
    for (const r of crashed) {
      expect(spoken(r.events)).toEqual(
        expect.arrayContaining([TRANSPORT_LINES.SUSPECT_LEFT_CAR.audioId, TRANSPORT_LINES.ON_FOOT.audioId, TRANSPORT_LINES.GET_OUT.audioId]),
      );
      expect(r.bot.failedOrders).toEqual([]);
    }
    const caught = runs.filter((r) => r.chase.status.phase === 'CAPTURED');
    expect(caught.length / runs.length).toBeGreaterThanOrEqual(0.95);
    expect(caught.filter((r) => r.chase.player.mode === 'FOOT').length).toBeGreaterThanOrEqual(crashed.length * 0.95);
  });
});

describe('the suspect turns round just before the arrest', () => {
  it.each([
    ['HARD', 'CAR_CAR'],
    ['EXPERT', 'CAR_CAR'],
    ['HARD', 'FOOT_FOOT'],
    ['EXPERT', 'FOOT_FOOT'],
  ] as const)('the scanner says so and "Faites demi-tour.", and a listener still catches it (%s %s)', (difficulty, chaseType) => {
    const runs = seeds(difficulty, 40, `near-dodge-${chaseType}`).map((s) => listen(s, { chaseType, nearCapture: 'DODGE' }));
    const dodged = runs.filter((r) => r.events.some((e) => e.type === 'SUSPECT_DODGE'));
    // Now and then no fair new route leaves that spot, and the arrest goes ahead.
    expect(dodged.length).toBeGreaterThanOrEqual(runs.length * 0.75);
    let turnedRound = 0;
    for (const r of dodged) {
      expect(spoken(r.events)).toEqual(expect.arrayContaining([EVENT_LINES.ATTENTION.audioId, EVENT_LINES.CHANGED_DIRECTION.audioId]));
      const uTurn = r.events.some(
        (e) =>
          e.type === 'TRANSMISSION' &&
          e.transmission.kind === 'CORRECTION' &&
          e.transmission.instructions.some((i) => i.clauses.some((c) => c.action === 'U_TURN')),
      );
      if (uTurn) turnedRound++;
      // Following the French exactly never produces "Ce n'est pas la bonne rue".
      expect(r.events.some((e) => e.type === 'TRANSMISSION' && e.transmission.kind === 'RECOVERY'), r.chase.scenario.seed).toBe(false);
    }
    // Usually "Faites demi-tour."; now and then going on round the block is quicker.
    expect(turnedRound).toBeGreaterThanOrEqual(dodged.length * 0.7);
    const caught = runs.filter((r) => r.chase.status.phase === 'CAPTURED');
    expect(caught.length / runs.length).toBeGreaterThanOrEqual(0.95);
  });

  it('happens at most once a chase', () => {
    for (const seed of seeds('EXPERT', 20, 'near-once')) {
      const { events } = listen(seed, { chaseType: 'CAR_CAR', nearCapture: 'DODGE' });
      expect(events.filter((e) => e.type === 'SUSPECT_DODGE').length).toBeLessThanOrEqual(1);
    }
  });
});
