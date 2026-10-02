import { CAMPAIGN, type Difficulty } from '../difficulty';
import { bestMedal, medalAtLeast, type Medal, type MissionScore } from './scoring';

/**
 * The campaign (blueprint sections 1 and 20): eight suspects, two per level,
 * played in order. No lives: after a capture or an escape the player can try
 * the mission again or go on to the next one; the case is complete once all
 * eight have been played. Progress is plain data so the game can save it.
 *
 * Suspects are known by nickname only; their looks are never something the
 * player has to remember (blueprint: no physical descriptions as a requirement).
 */
export interface MissionInfo {
  /** 0-based position in the campaign. */
  index: number;
  difficulty: Difficulty;
  /** The suspect's nickname, in French. */
  nickname: string;
  /** Short id for the suspect's picture. */
  picture: string;
}

const SUSPECTS: { nickname: string; picture: string }[] = [
  { nickname: 'Le Renard', picture: 'renard' },
  { nickname: 'La Pie', picture: 'pie' },
  { nickname: 'Le Chat', picture: 'chat' },
  { nickname: 'La Fouine', picture: 'fouine' },
  { nickname: 'Le Serpent', picture: 'serpent' },
  { nickname: 'Le Loup', picture: 'loup' },
  { nickname: 'Le Corbeau', picture: 'corbeau' },
  { nickname: 'Le Requin', picture: 'requin' },
];

export const MISSIONS: readonly MissionInfo[] = CAMPAIGN.map((difficulty, index) => ({
  index,
  difficulty,
  ...(SUSPECTS[index] as { nickname: string; picture: string }),
}));

export const MISSION_COUNT = MISSIONS.length;

export interface MissionRecord {
  captured: boolean;
  /** Best score and medal over all attempts. */
  bestScore: number;
  medal: Medal | null;
  attempts: number;
}

export interface CampaignProgress {
  version: 1;
  /** One entry per mission; null = not played yet. */
  missions: (MissionRecord | null)[];
  /** The mission to play next (MISSION_COUNT once all have been played). */
  current: number;
  /** The police car and uniform colours chosen. */
  livery: LiveryId;
  /** Colours earned so far; they stay earned when the campaign starts again. */
  earned: LiveryId[];
}

/** A fresh campaign; colours already earned (and the one chosen) carry over from `previous`. */
export function newCampaign(previous?: CampaignProgress): CampaignProgress {
  return {
    version: 1,
    missions: MISSIONS.map(() => null),
    current: 0,
    livery: previous?.livery ?? 'CLASSIQUE',
    earned: previous ? [...previous.earned] : [],
  };
}

/** Records an attempt at a mission (keeping the best score and medal) and moves `current` past it. */
export function recordMission(progress: CampaignProgress, index: number, score: MissionScore): CampaignProgress {
  const missions = [...progress.missions];
  const before = missions[index] ?? null;
  missions[index] = {
    captured: (before?.captured ?? false) || score.medal !== null,
    bestScore: Math.max(before?.bestScore ?? 0, score.total),
    medal: bestMedal(before?.medal ?? null, score.medal),
    attempts: (before?.attempts ?? 0) + 1,
  };
  const next = { ...progress, missions, current: Math.max(progress.current, Math.min(MISSION_COUNT, index + 1)) };
  next.earned = LIVERY_IDS.filter((id) => progress.earned.includes(id) || meetsUnlock(next, id));
  return next;
}

export function isComplete(progress: CampaignProgress): boolean {
  return progress.missions.every((m) => m !== null);
}

export function totalScore(progress: CampaignProgress): number {
  return progress.missions.reduce((sum, m) => sum + (m?.bestScore ?? 0), 0);
}

export function capturedCount(progress: CampaignProgress): number {
  return progress.missions.filter((m) => m?.captured).length;
}

/** A mission can be played once every mission before it has been played. */
export function isUnlocked(progress: CampaignProgress, index: number): boolean {
  return index >= 0 && index < MISSION_COUNT && index <= progress.current;
}

/* Cosmetics (blueprint section 21): police car and uniform colours unlocked by beating stages. */

export const LIVERY_IDS = ['CLASSIQUE', 'NUIT', 'COTIERE', 'BRONZE', 'ARGENT', 'OR'] as const;
export type LiveryId = (typeof LIVERY_IDS)[number];

export interface Livery {
  id: LiveryId;
  /** Name shown in the game, in French. */
  name: string;
  /** Car body, car stripe and uniform colours. */
  body: number;
  stripe: number;
  uniform: number;
  /** How it is earned, in French (shown while locked). */
  unlock: string;
}

export const LIVERIES: readonly Livery[] = [
  { id: 'CLASSIQUE', name: 'Classique', body: 0xf7f7f2, stripe: 0x1f4e9c, uniform: 0x1f4e9c, unlock: '' },
  { id: 'NUIT', name: 'Nuit', body: 0x2b2f3a, stripe: 0xf2f2f2, uniform: 0x2b2f3a, unlock: '2 suspects arrêtés' },
  { id: 'COTIERE', name: 'Côtière', body: 0x2bb3b1, stripe: 0xf7f7f2, uniform: 0x1d8a88, unlock: '4 suspects arrêtés' },
  { id: 'BRONZE', name: 'Bronze', body: 0xc98a4b, stripe: 0x6b3f1d, uniform: 0x8a5a2e, unlock: '8 suspects arrêtés' },
  { id: 'ARGENT', name: 'Argent', body: 0xc9d1d9, stripe: 0x4a5866, uniform: 0x5d6b78, unlock: '8 médailles d’argent ou mieux' },
  { id: 'OR', name: 'Or', body: 0xf0c53c, stripe: 0x8a6a10, uniform: 0xb8901e, unlock: '8 médailles d’or' },
];

export function livery(id: LiveryId): Livery {
  return LIVERIES.find((l) => l.id === id) ?? (LIVERIES[0] as Livery);
}

export function isLiveryUnlocked(progress: CampaignProgress, id: LiveryId): boolean {
  return id === 'CLASSIQUE' || progress.earned.includes(id) || meetsUnlock(progress, id);
}

function meetsUnlock(progress: CampaignProgress, id: LiveryId): boolean {
  const records = progress.missions;
  const all = (medal: Medal) => records.every((m) => medalAtLeast(m?.medal ?? null, medal));
  switch (id) {
    case 'CLASSIQUE':
      return true;
    case 'NUIT':
      return capturedCount(progress) >= 2;
    case 'COTIERE':
      return capturedCount(progress) >= 4;
    case 'BRONZE':
      return all('BRONZE');
    case 'ARGENT':
      return all('SILVER');
    case 'OR':
      return all('GOLD');
  }
}

/** Liveries unlocked by going from `before` to `after`, for the results screen. */
export function newlyUnlocked(before: CampaignProgress, after: CampaignProgress): Livery[] {
  return LIVERIES.filter((l) => !isLiveryUnlocked(before, l.id) && isLiveryUnlocked(after, l.id));
}

/** Reads saved progress, or starts a new campaign if it is missing or damaged. */
export function parseProgress(json: string | null): CampaignProgress {
  if (!json) return newCampaign();
  try {
    const data = JSON.parse(json) as Partial<CampaignProgress>;
    if (data.version !== 1 || !Array.isArray(data.missions) || data.missions.length !== MISSION_COUNT) return newCampaign();
    const missions = data.missions.map((m) =>
      m && typeof m === 'object' && typeof m.bestScore === 'number'
        ? {
            captured: m.captured === true,
            bestScore: Math.max(0, m.bestScore),
            medal: m.medal === 'GOLD' || m.medal === 'SILVER' || m.medal === 'BRONZE' ? m.medal : null,
            attempts: typeof m.attempts === 'number' ? m.attempts : 1,
          }
        : null,
    );
    const current = typeof data.current === 'number' ? Math.max(0, Math.min(MISSION_COUNT, Math.floor(data.current))) : 0;
    const isLivery = (id: unknown): id is LiveryId => (LIVERY_IDS as readonly unknown[]).includes(id);
    const progress: CampaignProgress = {
      version: 1,
      missions,
      current,
      livery: isLivery(data.livery) ? data.livery : 'CLASSIQUE',
      earned: Array.isArray(data.earned) ? data.earned.filter(isLivery) : [],
    };
    if (!isLiveryUnlocked(progress, progress.livery)) progress.livery = 'CLASSIQUE';
    return progress;
  } catch {
    return newCampaign();
  }
}
