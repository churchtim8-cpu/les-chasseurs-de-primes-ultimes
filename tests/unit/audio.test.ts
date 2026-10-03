import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { audioCheck, EMPTY_MANIFEST, type AudioManifest } from '../../src/engine/audio/manifest';
import { RepeatCounter, repeatUrgency } from '../../src/engine/audio/repeat';
import { buildScript, type ScriptLine } from '../../src/engine/audio/script';
import { Chase } from '../../src/engine/chase/chase';
import { generateScenario } from '../../src/engine/chase/scenario';
import { DIFFICULTIES, DIFFICULTY_SETTINGS, type Difficulty } from '../../src/engine/difficulty';
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
    // Two-step Hard sentences are recorded whole (only the pairs the map can produce);
    // three-step and Expert calls reuse one clip per linked clause. Sightings add about 140 short lines.
    expect(script.length).toBeLessThan(1_900);
    expect(script.reduce((n, l) => n + l.text.length, 0)).toBeLessThan(110_000);
  });

  it.each(DIFFICULTIES)('chases work using only recorded sentences (%s)', (difficulty) => {
    const recorded = new Set(script.filter((l) => l.levels.includes(difficulty)).map((l) => l.audioId));
    let captured = 0;
    const list = seeds(difficulty, 80, 'recorded');
    for (const seed of list) {
      const chase = new Chase(graph, generateScenario(graph, seed), { hasAudio: (id) => recorded.has(id) });
      const bot = new ListenerBot(graph);
      const spoken: string[] = [];
      for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
        for (const e of bot.step(chase, 0.05)) {
          if (e.type === 'ANNOUNCE') spoken.push(...e.lines.map((l) => l.audioId));
          if (e.type === 'SIGHTING') spoken.push(e.line.audioId);
        }
      }
      // Events, vehicles and sightings are in the script for this level too.
      for (const id of spoken) expect(recorded, `${seed}: ${id}`).toContain(id);
      expect(bot.log.length, seed).toBeGreaterThan(0);
      for (const t of bot.log) {
        for (const i of t.instructions) for (const c of i.clips) expect(recorded, `${seed}: ${i.text}`).toContain(c.audioId);
      }
      expect(bot.log.filter((t) => t.kind === 'RECOVERY'), seed).toEqual([]);
      if (chase.status.phase === 'CAPTURED') captured++;
    }
    expect(captured / list.length).toBeGreaterThanOrEqual(0.95);
  });
});

describe('audio manifest', () => {
  it('allows every sentence before any clip exists, then only recorded ones', () => {
    expect(audioCheck(EMPTY_MANIFEST)('dir.turn.left')).toBe(true);
    const manifest = {
      ...EMPTY_MANIFEST,
      clips: { 'dir.turn.left': { file: 'dispatcher/dir.turn.left.mp3', text: 'Tournez à gauche.', voice: 'DISPATCHER' as const, durationMs: 900 } },
    };
    expect(audioCheck(manifest)('dir.turn.left')).toBe(true);
    expect(audioCheck(manifest)('dir.turn.right')).toBe(false);
  });
});

describe('repeat mechanic', () => {
  it('follows each level rule', () => {
    const easy = new RepeatCounter(DIFFICULTY_SETTINGS.EASY.repeat);
    for (let i = 0; i < 20; i++) expect(easy.request(1, false).allowed).toBe(true);
    expect(easy.left).toBeNull();

    const intermediate = new RepeatCounter(DIFFICULTY_SETTINGS.INTERMEDIATE.repeat);
    const limit = DIFFICULTY_SETTINGS.INTERMEDIATE.repeat.kind === 'LIMITED' ? DIFFICULTY_SETTINGS.INTERMEDIATE.repeat.maxPerChase : 0;
    for (let i = 0; i < limit; i++) expect(intermediate.request(1, false).allowed).toBe(true);
    expect(intermediate.request(1, false)).toEqual({ allowed: false, reason: 'NO_REPEATS_LEFT' });

    const hard = new RepeatCounter(DIFFICULTY_SETTINGS.HARD.repeat);
    const result = hard.request(1, false);
    expect(result.allowed && result.penaltySeconds).toBeGreaterThan(0);

    const expert = new RepeatCounter(DIFFICULTY_SETTINGS.EXPERT.repeat);
    expect(expert.request(1, false).allowed).toBe(true);
    expect(expert.request(1, false).allowed).toBe(false);
    expect(expert.used).toBe(1);
  });

  it('sounds more urgent as the signal weakens', () => {
    expect(repeatUrgency(0.9, false)).toBe('CALM');
    expect(repeatUrgency(0.45, false)).toBe('URGENT');
    expect(repeatUrgency(0.1, false)).toBe('FRANTIC');
    expect(repeatUrgency(0.9, true)).toBe('FRANTIC');
  });

  it('costs time on Hard and is counted for scoring', () => {
    const seed = seeds('HARD', 1, 'repeat')[0]!;
    const chase = new Chase(graph, generateScenario(graph, seed));
    chase.openingCall();
    for (let i = 0; i < 20 && !chase.navigator.last; i++) chase.update(0.1);
    const before = chase.status.timeLeft;
    const result = chase.requestRepeat();
    expect(result?.allowed).toBe(true);
    expect(chase.status.timeLeft).toBeCloseTo(before - (result?.allowed ? result.penaltySeconds : 0));
    expect(chase.status.repeatsUsed).toBe(1);
  });
});

describe('recorded library', () => {
  it('only holds clips for current script lines, with the same French', () => {
    const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as AudioManifest;
    const byId = new Map(script.map((l) => [l.audioId, l]));
    for (const [id, clip] of Object.entries(manifest.clips)) {
      expect(byId.get(id)?.text, id).toBe(clip.text);
      expect(byId.get(id)?.voice, id).toBe(clip.voice);
    }
  });

  it.each(DIFFICULTIES)('keeps chases catchable with no corrections using only the clips in the library (%s)', (difficulty) => {
    const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as AudioManifest;
    const list = seeds(difficulty, 60, 'library');
    let captured = 0;
    for (const seed of list) {
      const chase = new Chase(graph, generateScenario(graph, seed), { hasAudio: audioCheck(manifest) });
      const bot = new ListenerBot(graph);
      for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) bot.step(chase, 0.05);
      expect(bot.log.filter((t) => t.kind === 'RECOVERY'), seed).toEqual([]);
      if (chase.status.phase === 'CAPTURED') captured++;
    }
    expect(captured / list.length).toBeGreaterThanOrEqual(0.95);
  });
});
