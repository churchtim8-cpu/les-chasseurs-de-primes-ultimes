import type { Difficulty } from '../difficulty';
import type { Relation, TemplateId } from './instructions';

/**
 * Which instruction templates each difficulty uses (blueprint sections 10 and
 * 12), and how often. Provisional: tune in playtesting. Hard and Expert reuse
 * the Intermediate set until their own templates (H1–H4, X1–X3) arrive in M6.
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
  /** How long the French text stays on screen, in seconds. */
  textSeconds: number;
}

const INTERMEDIATE: LanguageSettings = {
  weights: { E1: 0.6, E2: 1, E3: 1, I1: 1.5, I2: 2, I3: 2.5, RB: 1 },
  relations: ['DEVANT', 'APRES', 'AVANT'],
  maxStreetOrdinal: 3,
  maxRoundaboutOrdinal: 3,
  pairWithin: 420,
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
    textSeconds: 6,
  },
  INTERMEDIATE,
  HARD: { ...INTERMEDIATE, textSeconds: 3 },
  EXPERT: { ...INTERMEDIATE, textSeconds: 3 },
};
