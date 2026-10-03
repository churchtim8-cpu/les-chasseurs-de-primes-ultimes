import type { Difficulty } from '../difficulty';
import type { Relation, TemplateId } from './instructions';

/**
 * Which instruction templates each difficulty uses (blueprint sections 10 and
 * 12), and how often. Provisional: tune in playtesting. Hard adds longer
 * sentences (H1–H4); Expert adds "D'abord … Ensuite … Enfin" sequences (X1,
 * X2). Difficulty comes from length and memory, never faster speech.
 */
export interface LanguageSettings {
  /** Relative weight of each template when several valid ones exist; missing = not used. */
  weights: Partial<Record<TemplateId, number>>;
  /** Landmark relations allowed in turn instructions. */
  relations: Relation[];
  /** Highest street ordinal ("la deuxième rue" = 2). 0 = street counting not used. */
  maxStreetOrdinal: number;
  /** Highest roundabout exit ("la troisième sortie" = 3). Easy routes never need more. */
  maxRoundaboutOrdinal: number;
  /** Two actions closer together than this (metres) may be given as one "…, puis …" instruction. */
  pairWithin: number;
  /** Three actions within this distance (metres, first to last) may be given in one transmission (H3, X1, X2). 0 = never. */
  tripleWithin: number;
  /** How long the French text stays on screen, in seconds. */
  textSeconds: number;
}

const INTERMEDIATE: LanguageSettings = {
  weights: { E1: 0.6, E2: 1, E3: 1, I1: 1.5, I2: 2, I3: 2.5, RB: 1 },
  relations: ['DEVANT', 'APRES', 'AVANT'],
  maxStreetOrdinal: 3,
  maxRoundaboutOrdinal: 3,
  pairWithin: 420,
  tripleWithin: 0,
  textSeconds: 4,
};

export const LANGUAGE_SETTINGS: Record<Difficulty, LanguageSettings> = {
  EASY: {
    weights: { E1: 1, E2: 1, E3: 1.5, RB: 1 },
    relations: ['DEVANT', 'APRES'],
    maxStreetOrdinal: 0,
    // "troisième" is used from Intermediate upwards (Mr Henry, 2026-09-30).
    maxRoundaboutOrdinal: 2,
    pairWithin: 0,
    tripleWithin: 0,
    textSeconds: 6,
  },
  INTERMEDIATE,
  HARD: {
    ...INTERMEDIATE,
    weights: { E1: 0.4, E2: 1, I1: 1, I2: 1, I3: 1.5, H1: 2, H2: 2, H3: 3, H4: 2.5, RB: 1 },
    tripleWithin: 650,
    textSeconds: 3,
  },
  EXPERT: {
    ...INTERMEDIATE,
    weights: { E1: 0.3, E2: 1, I1: 0.8, I2: 0.8, I3: 0.8, H1: 1, H2: 1, H4: 1.5, X1: 3, X2: 3, RB: 1 },
    tripleWithin: 900,
    textSeconds: 3,
  },
};

/**
 * How long the scanner takes to say things, used to plan every direction so
 * it is heard out before its junction (Mr Henry, 2026-10-03: never slow the
 * chase down for a call). `secondsPerChar` and `baseSeconds` are an upper
 * bound fitted to Alain's recordings (slowed 15 %): no clip is longer than
 * this estimate. The radio framing matches the game's scanner: a beep and a
 * burst of static before the voice, a short gap between clips, a click after.
 */
export const SPEECH = {
  baseSeconds: 0.8,
  secondsPerChar: 1 / 16.3,
  radioLeadSeconds: 0.34,
  clipGapSeconds: 0.18,
  radioTailSeconds: 0.15,
  /** Time to act on a step once it has been heard, before its junction. */
  reactSeconds: 1,
} as const;
