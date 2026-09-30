import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/engine';

const sample = (rng: Rng, n = 20) => Array.from({ length: n }, () => rng.next());

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(sample(Rng.fromSeed('BV-E-7K3Q-M2PX'))).toEqual(sample(Rng.fromSeed('BV-E-7K3Q-M2PX')));
  });

  it('produces different sequences for different seeds', () => {
    expect(sample(Rng.fromSeed('a'))).not.toEqual(sample(Rng.fromSeed('b')));
  });

  it('keeps forked streams independent of each other and of the parent', () => {
    const route = Rng.fromSeed('seed').fork('route');
    const events = Rng.fromSeed('seed').fork('events');
    expect(sample(route)).not.toEqual(sample(events));

    // Drawing from one stream must not change another stream from the same seed.
    const parent = Rng.fromSeed('seed');
    sample(parent.fork('events'), 500);
    expect(sample(parent.fork('route'))).toEqual(sample(Rng.fromSeed('seed').fork('route')));
  });

  it('stays in range and is roughly uniform', () => {
    const rng = Rng.fromSeed('uniform');
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60_000; i++) {
      const v = rng.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      counts[v - 1]++;
    }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });

  it('never returns 1 from next()', () => {
    const rng = Rng.fromSeed('bounds');
    for (let i = 0; i < 100_000; i++) expect(rng.next()).toBeLessThan(1);
  });

  it('respects weights', () => {
    const rng = Rng.fromSeed('weights');
    let heavy = 0;
    for (let i = 0; i < 10_000; i++) if (rng.weighted(['a', 'b'], [9, 1]) === 'a') heavy++;
    expect(heavy).toBeGreaterThan(8_700);
    expect(heavy).toBeLessThan(9_300);
  });

  it('shuffles without losing or changing items', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = Rng.fromSeed('shuffle').shuffle(items);
    expect(shuffled).not.toEqual(items);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it('rejects invalid input', () => {
    const rng = Rng.fromSeed('errors');
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.int(5, 1)).toThrow();
    expect(() => rng.weighted(['a'], [0])).toThrow();
  });
});
