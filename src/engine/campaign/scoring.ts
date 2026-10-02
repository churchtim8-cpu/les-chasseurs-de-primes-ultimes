import type { Difficulty } from '../difficulty';

/**
 * Mission scoring (blueprint section 21): listening accuracy, navigation
 * mistakes, repeat usage, time remaining, and reactions to events
 * (sightings answered, changes of transport followed). There are no lives:
 * an escape still scores what the player achieved, it just earns no medal.
 *
 * Every number here is provisional and meant to be tuned in playtesting.
 */
export const SCORING = {
  /** Points for the capture, before the level multiplier. */
  capture: 500,
  /** Points per second left on the clock at the capture, before the level multiplier. */
  perSecondLeft: 4,
  /** Points lost per wrong turn (each one triggers a recovery call), before the level multiplier. */
  perWrongTurn: -40,
  /** Points lost per repeat asked for, before the level multiplier. Easy repeats are free. */
  perRepeat: -10,
  freeRepeats: { EASY: Infinity, INTERMEDIATE: 0, HARD: 0, EXPERT: 0 } as Record<Difficulty, number>,
  /** Points per sighting answered correctly. */
  perSighting: 100,
  /** Points per change of transport the player followed (getting out, getting back in). */
  perTransportChange: 100,
  /** Harder levels are worth more. */
  multiplier: { EASY: 1, INTERMEDIATE: 1.5, HARD: 2, EXPERT: 3 } as Record<Difficulty, number>,
  /** Medals for a capture: gold with no wrong turns and at most `goldRepeats` repeats (Easy: any), silver with up to `silverWrongTurns`. */
  goldRepeats: 1,
  silverWrongTurns: 2,
} as const;

export type Medal = 'GOLD' | 'SILVER' | 'BRONZE';

export interface MissionStats {
  difficulty: Difficulty;
  captured: boolean;
  timeLeft: number;
  /** Directions the scanner gave, and the wrong turns that needed a recovery call. */
  directions: number;
  wrongTurns: number;
  repeatsUsed: number;
  sightingsAsked: number;
  sightingsRight: number;
  transportChanges: number;
}

export type ScoreLineKey = 'CAPTURE' | 'TIME' | 'WRONG_TURNS' | 'REPEATS' | 'SIGHTINGS' | 'TRANSPORT';

export interface ScoreLine {
  key: ScoreLineKey;
  /** How many (seconds, wrong turns, repeats...). */
  count: number;
  points: number;
}

export interface MissionScore {
  total: number;
  lines: ScoreLine[];
  medal: Medal | null;
  /** Share of directions followed without a wrong turn, 0..1. */
  accuracy: number;
}

export function scoreMission(stats: MissionStats): MissionScore {
  const m = SCORING.multiplier[stats.difficulty];
  const lines: ScoreLine[] = [];
  const add = (key: ScoreLineKey, count: number, points: number) => {
    if (count > 0) lines.push({ key, count, points: Math.round(points) });
  };
  if (stats.captured) {
    add('CAPTURE', 1, SCORING.capture * m);
    const seconds = Math.max(0, Math.floor(stats.timeLeft));
    add('TIME', seconds, seconds * SCORING.perSecondLeft * m);
  }
  add('SIGHTINGS', stats.sightingsRight, stats.sightingsRight * SCORING.perSighting);
  add('TRANSPORT', stats.transportChanges, stats.transportChanges * SCORING.perTransportChange);
  add('WRONG_TURNS', stats.wrongTurns, stats.wrongTurns * SCORING.perWrongTurn * m);
  const paidRepeats = Math.max(0, stats.repeatsUsed - SCORING.freeRepeats[stats.difficulty]);
  if (stats.repeatsUsed > 0) lines.push({ key: 'REPEATS', count: stats.repeatsUsed, points: Math.round(paidRepeats * SCORING.perRepeat * m) });
  const total = Math.max(0, lines.reduce((sum, l) => sum + l.points, 0));
  return { total, lines, medal: medalFor(stats), accuracy: accuracyOf(stats) };
}

export function accuracyOf(stats: Pick<MissionStats, 'directions' | 'wrongTurns'>): number {
  if (stats.directions <= 0) return stats.wrongTurns > 0 ? 0 : 1;
  return Math.max(0, Math.min(1, 1 - stats.wrongTurns / stats.directions));
}

export function medalFor(stats: MissionStats): Medal | null {
  if (!stats.captured) return null;
  const repeatsOk = stats.difficulty === 'EASY' || stats.repeatsUsed <= SCORING.goldRepeats;
  if (stats.wrongTurns === 0 && repeatsOk) return 'GOLD';
  if (stats.wrongTurns <= SCORING.silverWrongTurns) return 'SILVER';
  return 'BRONZE';
}

const MEDAL_RANK: Record<Medal, number> = { BRONZE: 1, SILVER: 2, GOLD: 3 };

/** The better of two medals (null = none). */
export function bestMedal(a: Medal | null, b: Medal | null): Medal | null {
  if (!a) return b;
  if (!b) return a;
  return MEDAL_RANK[a] >= MEDAL_RANK[b] ? a : b;
}

export function medalAtLeast(medal: Medal | null, wanted: Medal): boolean {
  return medal !== null && MEDAL_RANK[medal] >= MEDAL_RANK[wanted];
}
