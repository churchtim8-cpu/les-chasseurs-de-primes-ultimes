import { createSeed, type ChaseSeed, type Difficulty } from '../engine';

/** Crypto-backed randomness for brand-new seeds. The chase itself is then fully seeded. */
function cryptoIndex(n: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] as number) % n;
}

export function newSeed(difficulty: Difficulty): ChaseSeed {
  return createSeed(difficulty, cryptoIndex);
}
