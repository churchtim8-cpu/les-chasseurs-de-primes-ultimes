/**
 * Chase seed codes, e.g. "BV-E-7K3Q-M2PX".
 *
 *   BV   fixed prefix (Bellevue)
 *   E    difficulty letter (E, I, H, X)
 *   7K3Q-M2P  seven random characters (about 34 billion possibilities)
 *   X    check character, so a mistyped code is rejected instead of
 *        silently loading a different chase
 *
 * Characters use Crockford base 32 (no I, L, O or U), so codes are easy to read
 * aloud and copy from a projector. When parsing, lower case is accepted and
 * O is read as 0, I and L as 1.
 */

import { DIFFICULTY_LETTER, type Difficulty } from '../difficulty';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_LENGTH = 7;
/** Odd weights are coprime with 32, so any single wrong character is detected. */
const CHECK_WEIGHTS = [3, 5, 7, 11, 13, 17, 19, 23];

const LETTER_TO_DIFFICULTY = Object.fromEntries(
  Object.entries(DIFFICULTY_LETTER).map(([difficulty, letter]) => [letter, difficulty]),
) as Record<string, Difficulty>;

export interface ChaseSeed {
  /** Canonical code, e.g. "BV-E-7K3Q-M2PX". Also the string the Rng is seeded with. */
  code: string;
  difficulty: Difficulty;
}

export type SeedParseResult = { ok: true; seed: ChaseSeed } | { ok: false; error: string };

function checkChar(letter: string, random: string): string {
  const values = [ALPHABET.indexOf(letter), ...[...random].map((c) => ALPHABET.indexOf(c))];
  const sum = values.reduce((acc, v, i) => acc + v * (CHECK_WEIGHTS[i] as number), 0);
  return ALPHABET[sum % 32] as string;
}

function format(letter: string, random: string): string {
  const body = random + checkChar(letter, random);
  return `BV-${letter}-${body.slice(0, 4)}-${body.slice(4)}`;
}

/**
 * Makes a new seed. `randomIndex(n)` must return an integer in [0, n); the game
 * passes a crypto-backed source, tests can pass a deterministic one.
 */
export function createSeed(difficulty: Difficulty, randomIndex: (n: number) => number): ChaseSeed {
  let random = '';
  for (let i = 0; i < RANDOM_LENGTH; i++) random += ALPHABET[randomIndex(32)];
  return { code: format(DIFFICULTY_LETTER[difficulty], random), difficulty };
}

export function parseSeed(input: string): SeedParseResult {
  const compact = input.toUpperCase().replace(/[\s_-]/g, '');
  // Only the random part is normalised: "I" is also the Intermediate letter.
  const cleaned = compact.slice(0, 3) + compact.slice(3).replace(/O/g, '0').replace(/[IL]/g, '1');

  const match = /^BV([EIHX])([0-9A-Z]{8})$/.exec(cleaned);
  if (!match) {
    return { ok: false, error: 'A seed code looks like BV-E-7K3Q-M2PX.' };
  }
  const letter = match[1] as string;
  const body = match[2] as string;
  if ([...body].some((c) => !ALPHABET.includes(c))) {
    return { ok: false, error: 'The seed code contains a character that is not allowed.' };
  }
  const random = body.slice(0, RANDOM_LENGTH);
  if (checkChar(letter, random) !== body[RANDOM_LENGTH]) {
    return { ok: false, error: 'This seed code has a typo (the check character does not match).' };
  }
  const difficulty = LETTER_TO_DIFFICULTY[letter] as Difficulty;
  return { ok: true, seed: { code: format(letter, random), difficulty } };
}
