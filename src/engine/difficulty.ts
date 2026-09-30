/**
 * Difficulty levels and their tunable settings.
 *
 * Every number here is provisional (blueprint section 10) and is meant to be
 * changed during playtesting, so gameplay code must read values from here
 * rather than hard-coding them.
 */

export const DIFFICULTIES = ['EASY', 'INTERMEDIATE', 'HARD', 'EXPERT'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** One-letter code used in seed codes, e.g. "BV-E-...". */
export const DIFFICULTY_LETTER: Record<Difficulty, string> = {
  EASY: 'E',
  INTERMEDIATE: 'I',
  HARD: 'H',
  EXPERT: 'X',
};

export type RepeatRule =
  | { kind: 'UNLIMITED' }
  | { kind: 'LIMITED'; maxPerChase: number }
  | { kind: 'COSTS_TIME'; secondsPerRepeat: number }
  | { kind: 'ONCE' };

export type TextDisplay = 'BRIEF' | 'BRIEF_THEN_REMOVED' | 'AUDIO_ONLY';

export interface DifficultySettings {
  label: { fr: string; en: string };
  /** Provisional time limit per chase, in seconds. */
  timeLimitSeconds: number;
  textDisplay: TextDisplay;
  repeat: RepeatRule;
  /** Approximate number of significant events per chase [min, max]. */
  eventCount: [number, number];
}

export const DIFFICULTY_SETTINGS: Record<Difficulty, DifficultySettings> = {
  EASY: {
    label: { fr: 'Facile', en: 'Easy' },
    timeLimitSeconds: 180,
    textDisplay: 'BRIEF',
    repeat: { kind: 'UNLIMITED' },
    eventCount: [1, 2],
  },
  INTERMEDIATE: {
    label: { fr: 'Intermédiaire', en: 'Intermediate' },
    timeLimitSeconds: 135,
    textDisplay: 'BRIEF_THEN_REMOVED',
    repeat: { kind: 'LIMITED', maxPerChase: 3 },
    eventCount: [2, 3],
  },
  HARD: {
    label: { fr: 'Difficile', en: 'Hard' },
    timeLimitSeconds: 90,
    textDisplay: 'AUDIO_ONLY',
    repeat: { kind: 'COSTS_TIME', secondsPerRepeat: 5 },
    eventCount: [3, 4],
  },
  EXPERT: {
    label: { fr: 'Expert', en: 'Expert' },
    timeLimitSeconds: 60,
    textDisplay: 'AUDIO_ONLY',
    repeat: { kind: 'ONCE' },
    eventCount: [4, 5],
  },
};

/** Campaign order: 8 suspects, two per difficulty (blueprint section 1). */
export const CAMPAIGN: readonly Difficulty[] = [
  'EASY',
  'EASY',
  'INTERMEDIATE',
  'INTERMEDIATE',
  'HARD',
  'HARD',
  'EXPERT',
  'EXPERT',
];
