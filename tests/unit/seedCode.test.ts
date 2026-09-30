import { describe, expect, it } from 'vitest';
import { createSeed, DIFFICULTIES, parseSeed, Rng } from '../../src/engine';

const deterministicIndex = (seed: string) => {
  const rng = Rng.fromSeed(seed);
  return (n: number) => rng.int(0, n - 1);
};

describe('seed codes', () => {
  it('have the documented shape for every difficulty', () => {
    for (const difficulty of DIFFICULTIES) {
      const seed = createSeed(difficulty, deterministicIndex(difficulty));
      expect(seed.code).toMatch(/^BV-[EIHX]-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(seed.difficulty).toBe(difficulty);
    }
  });

  it('round-trip through parseSeed', () => {
    const next = deterministicIndex('round-trip');
    for (let i = 0; i < 500; i++) {
      const seed = createSeed(DIFFICULTIES[i % 4]!, next);
      expect(parseSeed(seed.code)).toEqual({ ok: true, seed });
    }
  });

  it('accept sloppy typing: lower case, spaces, O for 0, I or L for 1', () => {
    const seed = createSeed('HARD', () => 1); // every random character is "1"
    const sloppy = seed.code.toLowerCase().replace(/-/g, ' ').replace(/1/g, 'l');
    expect(parseSeed(sloppy)).toEqual({ ok: true, seed });
    const zeros = createSeed('EASY', () => 0);
    expect(parseSeed(zeros.code.replace(/0/g, 'O'))).toEqual({ ok: true, seed: zeros });
  });

  it('reject any single mistyped character', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const seed = createSeed('EXPERT', deterministicIndex('typo'));
    const compact = seed.code.replace(/-/g, '');
    for (let pos = 3; pos < compact.length; pos++) {
      for (const c of alphabet) {
        if (c === compact[pos]) continue;
        const typo = compact.slice(0, pos) + c + compact.slice(pos + 1);
        const result = parseSeed(typo);
        if (result.ok) expect(result.seed.code).not.toBe(seed.code);
        expect(result.ok).toBe(false);
      }
    }
  });

  it('reject malformed codes with a helpful message', () => {
    for (const bad of ['', 'hello', 'BV-Q-1234-5678', 'BV-E-1234-567', 'BV-E-UUUU-UUUU']) {
      const result = parseSeed(bad);
      expect(result.ok).toBe(false);
    }
  });
});
