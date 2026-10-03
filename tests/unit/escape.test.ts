import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { Chase } from '../../src/engine/chase/chase';
import { generateScenario } from '../../src/engine/chase/scenario';
import { CHASE_TYPES, type ChaseType } from '../../src/engine/chase/settings';
import { DIFFICULTIES, type Difficulty } from '../../src/engine/difficulty';
import { Rng } from '../../src/engine/rng/prng';
import { createSeed } from '../../src/engine/rng/seedCode';
import { TownGraph } from '../../src/engine/world/graph';

const graph = new TownGraph(BELLEVUE);

function seeds(difficulty: Difficulty, count: number, label: string): string[] {
  const rng = Rng.fromSeed(`${label}-${difficulty}`);
  return Array.from({ length: count }, () => createSeed(difficulty, (n) => rng.int(0, n - 1)).code);
}

/** A player who never moves: the suspect reaches the end of its route long before the clock runs out. */
function standStill(seed: string, chaseType: ChaseType = CHASE_TYPES[0]!) {
  const chase = new Chase(graph, generateScenario(graph, seed, { chaseType, turnOff: false, sightings: false }));
  chase.openingCall();
  const plannedEnd = chase.scenario.stages[chase.scenario.stages.length - 1]!.route.at(-1);
  let arrivedAt: number | null = null;
  let movingAfter = false;
  let endedEarly = false;
  for (let t = 0; t < 600 && chase.status.phase === 'PURSUIT'; t += 0.1) {
    const events = chase.update(0.1);
    const suspect = chase.suspect.snapshot();
    if (arrivedAt === null && suspect.towards === plannedEnd && suspect.speed === 0) arrivedAt = t;
    if (arrivedAt !== null && t > arrivedAt + 2 && suspect.speed > 1) movingAfter = true;
    const after = chase.status as { phase: string; timeLeft: number };
    if (after.phase === 'ESCAPED' && after.timeLeft > 0) endedEarly = true;
  }
  return { chase, movingAfter, endedEarly };
}

describe('the suspect only escapes when time runs out', () => {
  it.each(DIFFICULTIES)('standing still never loses the suspect by distance, only to the clock (%s)', (difficulty) => {
    let escaped = 0;
    for (const seed of seeds(difficulty, 6, 'escape')) {
      const { chase, endedEarly } = standStill(seed);
      const status = chase.status;
      expect(endedEarly, seed).toBe(false);
      // Driving on past the end of its route, the suspect can pass the waiting police car and be caught.
      if (status.phase !== 'ESCAPED') continue;
      escaped++;
      expect(status.escapeReason, seed).toBe('TIME');
      expect(status.timeLeft, seed).toBe(0);
    }
    expect(escaped).toBeGreaterThan(0);
  }, 60_000);

  it('keeps the suspect moving past the end of its planned route, with directions following it', () => {
    let kept = 0;
    let tried = 0;
    for (const chaseType of CHASE_TYPES) {
      for (const seed of seeds('EASY', 4, `keep-going-${chaseType}`)) {
        const { chase, movingAfter } = standStill(seed, chaseType);
        tried++;
        if (!movingAfter) continue;
        kept++;
        expect(chase.status.phase === 'ESCAPED' ? chase.status.timeLeft : 0, seed).toBe(0);
      }
    }
    // A dead end with no way back is the only reason to stop; it is rare.
    expect(kept / tried).toBeGreaterThan(0.9);
  }, 60_000);
});
