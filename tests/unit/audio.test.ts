import { beforeAll, describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { buildScript, type ScriptLine } from '../../src/engine/audio/script';
import { Chase } from '../../src/engine/chase/chase';
import { generateScenario } from '../../src/engine/chase/scenario';
import { DIFFICULTIES, type Difficulty } from '../../src/engine/difficulty';
import { Rng } from '../../src/engine/rng/prng';
import { createSeed } from '../../src/engine/rng/seedCode';
import { TownGraph } from '../../src/engine/world/graph';
import { ListenerBot } from './listenerBot';

const graph = new TownGraph(BELLEVUE);
let script: ScriptLine[] = [];

beforeAll(() => {
  script = buildScript(graph);
}, 60_000);

function seeds(difficulty: Difficulty, count: number, label: string): string[] {
  const rng = Rng.fromSeed(`${label}-${difficulty}`);
  return Array.from({ length: count }, () => createSeed(difficulty, (n) => rng.int(0, n - 1)).code);
}

describe('recording script', () => {
  it('has one line per audio ID, each a complete French sentence', () => {
    const ids = script.map((l) => l.audioId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const line of script) {
      expect(line.text).toMatch(/^[A-ZÀ-Ü].*[.!?]$/);
      // French typography keeps a space before "!" and "?".
      expect(line.text).not.toMatch(/\s{2,}|\s[.,]$/);
      expect(line.levels.length).toBeGreaterThan(0);
    }
  });

  it('keeps "troisième" out of Easy', () => {
    const easy = script.filter((l) => l.levels.includes('EASY'));
    expect(easy.filter((l) => l.text.includes('troisième'))).toEqual([]);
  });

  it('stays a manageable size for recording', () => {
    expect(script.length).toBeLessThan(500);
    expect(script.reduce((n, l) => n + l.text.length, 0)).toBeLessThan(25_000);
  });

  it.each(DIFFICULTIES)('chases work using only recorded sentences (%s)', (difficulty) => {
    const recorded = new Set(script.filter((l) => l.levels.includes(difficulty)).map((l) => l.audioId));
    let captured = 0;
    const list = seeds(difficulty, 80, 'recorded');
    for (const seed of list) {
      const chase = new Chase(graph, generateScenario(graph, seed), { hasAudio: (id) => recorded.has(id) });
      const bot = new ListenerBot(graph);
      for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) bot.step(chase, 0.05);
      expect(bot.log.length, seed).toBeGreaterThan(0);
      for (const t of bot.log) for (const i of t.instructions) expect(recorded, `${seed}: ${i.text}`).toContain(i.audioId);
      expect(bot.log.filter((t) => t.kind === 'RECOVERY'), seed).toEqual([]);
      if (chase.status.phase === 'CAPTURED') captured++;
    }
    expect(captured / list.length).toBeGreaterThanOrEqual(0.95);
  });
});
