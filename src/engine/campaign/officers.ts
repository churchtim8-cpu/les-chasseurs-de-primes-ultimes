import type { ChaseType } from '../chase/settings';
import type { Difficulty } from '../difficulty';

/**
 * The Escape Mode campaign (Mr Henry, 2026-10-04): the police version of the
 * suspects. Ten officers to get away from, two per level from Easy to Expert,
 * then two hidden motorcycle officers, the hardest to shake off, who open once
 * the player has escaped all eight. Each drives their own vehicle and colours,
 * and the higher the level the faster they are (a share of the player's speed:
 * listening well always wins, mistakes let them close in).
 *
 * Officers are known by nickname only, like the suspects.
 */
export interface OfficerInfo {
  /** Short id, also the picture's name (officer-<id>.jpg). */
  id: string;
  nickname: string;
  difficulty: Difficulty;
  /** Police speed, as a share of the player's cruising speed. */
  speed: number;
  /** Their vehicle and colours (garage ids, see cosmetics.ts). */
  vehicle: string;
  livery: string;
  outfit: string;
  /** A fixed kind of chase for the hidden officers (changes of transport); random otherwise. */
  chaseType?: ChaseType;
  /** One line for the dossier, in English like the menus. */
  note: string;
  hidden?: true;
}

export const OFFICERS: readonly OfficerInfo[] = [
  { id: 'escargot', nickname: 'Agent Escargot', difficulty: 'EASY', speed: 0.78, vehicle: 'VINTAGE', livery: 'CLASSIQUE', outfit: 'CASQUETTE', note: 'Slow and steady in an old 1970s patrol car. Never gives up, rarely catches up.' },
  { id: 'agouti', nickname: 'Agente Agouti', difficulty: 'EASY', speed: 0.81, vehicle: 'BERLINE', livery: 'COTIERE', outfit: 'CASQUETTE', note: 'Knows every street of Bellevue, but stops to say hello to everyone.' },
  { id: 'basset', nickname: 'Brigadier Basset', difficulty: 'INTERMEDIATE', speed: 0.84, vehicle: 'BERLINE', livery: 'CLASSIQUE', outfit: 'BERET', note: 'Follows your trail like a hound. One wrong turn and he is on your tail.' },
  { id: 'chouette', nickname: 'Brigadière Chouette', difficulty: 'INTERMEDIATE', speed: 0.86, vehicle: 'BANALISEE', livery: 'NUIT', outfit: 'CASQUETTE', note: 'An unmarked car: you will not see her coming until she is close.' },
  { id: 'faucon', nickname: 'Capitaine Faucon', difficulty: 'HARD', speed: 0.88, vehicle: 'GENDARMERIE', livery: 'CLASSIQUE', outfit: 'BERET', note: 'Sharp eyes and a big 4x4. Hesitate at a junction and he is there.' },
  { id: 'lionne', nickname: 'Lieutenante Lionne', difficulty: 'HARD', speed: 0.9, vehicle: 'GENDARMERIE', livery: 'BRONZE', outfit: 'LUNETTES', note: 'Leads the pack. Fast, patient, and she never loses a trail.' },
  { id: 'guepard', nickname: 'Commandant Guépard', difficulty: 'EXPERT', speed: 0.91, vehicle: 'PRESTIGE', livery: 'ARGENT', outfit: 'LUNETTES', note: 'The fastest car in the station. Only perfect listening shakes him off.' },
  { id: 'jaguar', nickname: 'Commissaire Jaguar', difficulty: 'EXPERT', speed: 0.92, vehicle: 'PRESTIGE', livery: 'OR', outfit: 'BERET', note: 'The chief of Bellevue police. Nobody has escaped her twice.' },
  { id: 'frelon', nickname: 'Le Frelon', difficulty: 'EXPERT', speed: 0.93, vehicle: 'MOTO', livery: 'NUIT', outfit: 'CASQUE', chaseType: 'CAR_FOOT_CAR', note: 'Secret motorcycle squad. Weaves through traffic and follows you on foot.', hidden: true },
  { id: 'mangouste', nickname: 'La Mangouste', difficulty: 'EXPERT', speed: 0.94, vehicle: 'MOTO', livery: 'OR', outfit: 'CASQUE', chaseType: 'FOOT_CAR_FOOT', note: 'The legend of the motorcycle squad. The hardest officer in Bellevue to escape.', hidden: true },
];

export const REGULAR_OFFICERS = OFFICERS.filter((o) => !o.hidden).length;

export function officerInfo(id: string | undefined): OfficerInfo | undefined {
  return OFFICERS.find((o) => o.id === id);
}

export interface EscapeRecord {
  escaped: boolean;
  bestScore: number;
  /** Best stars: escaped / no wrong turn / no repeat. */
  stars: number;
  attempts: number;
}

export interface EscapeProgress {
  version: 1;
  /** By officer id. */
  records: Record<string, EscapeRecord>;
}

export function newEscapeProgress(): EscapeProgress {
  return { version: 1, records: {} };
}

/** Records an attempt, keeping the best score and stars. */
export function recordEscape(progress: EscapeProgress, id: string, result: { escaped: boolean; score: number; stars: number }): EscapeProgress {
  const before = progress.records[id];
  return {
    ...progress,
    records: {
      ...progress.records,
      [id]: {
        escaped: (before?.escaped ?? false) || result.escaped,
        bestScore: Math.max(before?.bestScore ?? 0, result.score),
        stars: Math.max(before?.stars ?? 0, result.stars),
        attempts: (before?.attempts ?? 0) + 1,
      },
    },
  };
}

/** Officers escaped so far. */
export function escapedCount(progress: EscapeProgress): number {
  return OFFICERS.filter((o) => progress.records[o.id]?.escaped).length;
}

/**
 * The first officer is open from the start; each next one once the one before
 * has been tried (no lives, as in the campaign); the hidden pair once all
 * eight have been escaped.
 */
export function officerUnlocked(progress: EscapeProgress, id: string): boolean {
  const i = OFFICERS.findIndex((o) => o.id === id);
  if (i < 0) return false;
  const officer = OFFICERS[i] as OfficerInfo;
  if (officer.hidden) return OFFICERS.filter((o) => !o.hidden).every((o) => progress.records[o.id]?.escaped);
  return i === 0 || progress.records[(OFFICERS[i - 1] as OfficerInfo).id] !== undefined;
}

/** The next officer to face: the first open one not yet escaped, else null. */
export function nextOfficer(progress: EscapeProgress, after?: string): OfficerInfo | null {
  const start = after ? OFFICERS.findIndex((o) => o.id === after) + 1 : 0;
  for (let i = start; i < OFFICERS.length; i++) {
    const o = OFFICERS[i] as OfficerInfo;
    if (officerUnlocked(progress, o.id) && !progress.records[o.id]?.escaped) return o;
  }
  return null;
}

/** Reads saved progress back, or a fresh one from missing or damaged data. */
export function parseEscapeProgress(raw: string | null): EscapeProgress {
  if (!raw) return newEscapeProgress();
  try {
    const data = JSON.parse(raw) as Partial<EscapeProgress>;
    const records: Record<string, EscapeRecord> = {};
    if (data && typeof data.records === 'object' && data.records) {
      for (const o of OFFICERS) {
        const r = (data.records as Record<string, Partial<EscapeRecord>>)[o.id];
        if (!r || typeof r !== 'object') continue;
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
        records[o.id] = { escaped: r.escaped === true, bestScore: num(r.bestScore), stars: Math.min(3, num(r.stars)), attempts: Math.max(1, num(r.attempts)) };
      }
    }
    return { version: 1, records };
  } catch {
    return newEscapeProgress();
  }
}
