import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { EVENT_LINES } from '../../src/engine/audio/script';
import { Chase } from '../../src/engine/chase/chase';
import { generateScenario, validateScenario, type ScenarioOptions } from '../../src/engine/chase/scenario';
import { CHASE_SETTINGS, CHASE_TYPE_WEIGHTS, CHASE_TYPES } from '../../src/engine/chase/settings';
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

function listen(seed: string, options: ScenarioOptions = {}) {
  const chase = new Chase(graph, generateScenario(graph, seed, options));
  const bot = new ListenerBot(graph);
  const heard: string[] = [];
  for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
    for (const e of bot.step(chase, 0.05)) {
      if (e.type === 'ANNOUNCE') heard.push(...e.lines.map((l) => l.audioId));
      if (e.type === 'TRANSMISSION') heard.push(...e.transmission.instructions.map((i) => i.template));
    }
  }
  return { chase, bot, heard };
}

const LEVELS = DIFFICULTIES.filter((d) => CHASE_SETTINGS[d].directionChange > 0);

describe('the suspect changes direction', () => {
  it('happens from Intermediate up, more often at higher levels, never at Easy', () => {
    const share = (d: Difficulty) =>
      seeds(d, 150, 'share').filter((s) => generateScenario(graph, s).turnOff !== null).length / 150;
    expect(share('EASY')).toBe(0);
    expect(share('INTERMEDIATE')).toBeGreaterThan(0.1);
    expect(share('EXPERT')).toBeGreaterThan(share('INTERMEDIATE'));
  }, 60_000);

  it.each(LEVELS)('plans a fair predicted route that leaves the real one (%s)', (difficulty) => {
    let planned = 0;
    let tried = 0;
    for (const chaseType of CHASE_TYPES.filter((t) => (CHASE_TYPE_WEIGHTS[difficulty][t] ?? 0) > 0)) {
      for (const seed of seeds(difficulty, 15, `plan-${chaseType}`)) {
        const scenario = generateScenario(graph, seed, { chaseType, turnOff: true });
        tried++;
        expect(validateScenario(graph, scenario), seed).toEqual([]);
        const turnOff = scenario.turnOff;
        if (!turnOff) continue;
        planned++;
        const route = scenario.stages[turnOff.stage]!.route;
        expect(turnOff.decoy[0]).toBe(route[turnOff.at]);
        expect(turnOff.decoy[1]).not.toBe(route[turnOff.at + 1]);
      }
    }
    // Short foot stages often leave no room for one; most chases have one when asked.
    expect(planned / tried).toBeGreaterThan(0.4);
  }, 60_000);

  it.each(LEVELS)('a student who follows the correction still catches the suspect (%s)', (difficulty) => {
    const runs = seeds(difficulty, 60, 'follow').map((s) => listen(s, { turnOff: true }));
    const changed = runs.filter((r) => r.heard.includes(EVENT_LINES.CHANGED_DIRECTION.audioId));
    expect(changed.length).toBeGreaterThan(20);
    const captured = changed.filter((r) => r.chase.status.phase === 'CAPTURED').length;
    expect(captured / changed.length).toBeGreaterThanOrEqual(0.95);
    // Following the French exactly is never called a wrong turn.
    expect(changed.filter((r) => r.bot.log.some((t) => t.kind === 'RECOVERY' && t.text.includes('bonne rue')))).toEqual([]);
  }, 60_000);

  it('announces "Attention ! Le suspect a changé de direction." before the corrected directions', () => {
    for (const seed of seeds('EXPERT', 30, 'order')) {
      const { heard } = listen(seed, { turnOff: true });
      const at = heard.indexOf(EVENT_LINES.CHANGED_DIRECTION.audioId);
      if (at === -1) continue;
      expect(heard[at - 1]).toBe(EVENT_LINES.ATTENTION.audioId);
    }
  }, 60_000);
});
