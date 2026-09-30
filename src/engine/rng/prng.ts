/**
 * Seeded pseudo-random numbers for the scenario engine.
 *
 * Game logic must never call Math.random: every chase has to be reproducible
 * from its seed code. Use `Rng.fromSeed(...)` and derive independent streams
 * with `fork(label)` so that, for example, changing how events are placed
 * does not change the suspect's route for the same seed.
 */

/** xmur3 string hash: turns any string into a stream of 32-bit seeds. */
function xmur3(input: string): () => number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** sfc32: small, fast, well-distributed 32-bit generator. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly source: () => number;

  private constructor(readonly seed: string) {
    const hash = xmur3(seed);
    this.source = sfc32(hash(), hash(), hash(), hash());
    // Discard the first outputs; sfc32 mixes poorly for its first few steps.
    for (let i = 0; i < 12; i++) this.source();
  }

  static fromSeed(seed: string): Rng {
    return new Rng(seed);
  }

  /** An independent stream, stable for the same parent seed and label. */
  fork(label: string): Rng {
    return new Rng(`${this.seed}/${label}`);
  }

  /** Float in [0, 1). */
  next(): number {
    return this.source();
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Invalid integer range [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with the given probability (0 to 1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Pick using relative weights (weights need not sum to 1). */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError('Items and weights must be non-empty and the same length');
    }
    const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
    if (total <= 0) throw new RangeError('At least one weight must be positive');
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i] as number);
      if (roll < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Returns a shuffled copy (Fisher-Yates); the input is not modified. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}
