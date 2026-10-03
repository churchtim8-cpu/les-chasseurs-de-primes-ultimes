import type { Difficulty } from '../difficulty';
import type { ChaseType } from '../chase/settings';
import type { Vehicle } from '../chase/settings';
import type { TravelMode } from '../world/graph';
import { type CampaignProgress, MISSIONS } from './campaign';
import { bestMedal, medalAtLeast, type Medal, type MissionScore, type MissionStats } from './scoring';

/**
 * The player's record across every chase (campaign, practice and the daily
 * challenge): points towards a police rank, badges for listening well, and a
 * case file for each suspect. Plain data, so the game can save it; nothing
 * here depends on the browser.
 */

/* Ranks: titles earned from the points of every chase ever played. */

export const RANKS = [
  { id: 'STAGIAIRE', name: 'Stagiaire', points: 0 },
  { id: 'AGENT', name: 'Agent', points: 1000 },
  { id: 'BRIGADIER', name: 'Brigadier', points: 3000 },
  { id: 'LIEUTENANT', name: 'Lieutenant', points: 6500 },
  { id: 'CAPITAINE', name: 'Capitaine', points: 11000 },
  { id: 'COMMISSAIRE', name: 'Commissaire', points: 18000 },
] as const;

export type RankId = (typeof RANKS)[number]['id'];
export interface Rank {
  id: RankId;
  name: string;
  /** Points needed. */
  points: number;
}

export function rankFor(points: number): Rank {
  let rank: Rank = RANKS[0];
  for (const r of RANKS) if (points >= r.points) rank = r;
  return rank;
}

/** The rank after this one, or null at the top. */
export function nextRank(rank: Rank): Rank | null {
  const i = RANKS.findIndex((r) => r.id === rank.id);
  return RANKS[i + 1] ?? null;
}

/* Badges: one-off awards for the way a chase was played. */

export const BADGE_IDS = [
  'PREMIERE',
  'SANS_FAUTE',
  'ECLAIR',
  'OREILLE_D_OR',
  'PIED_LEGER',
  'NOCTAMBULE',
  'MARATHONIEN',
  'CHASSEUR_ULTIME',
  'BOSS',
  'PATRONNE',
] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export interface Badge {
  id: BadgeId;
  name: string;
  /** How it is earned, in French (shown while locked). */
  how: string;
  /** Emoji drawn on the badge. */
  icon: string;
}

export const BADGES: readonly Badge[] = [
  { id: 'PREMIERE', name: 'Première arrestation', how: 'Arrêtez votre premier suspect.', icon: '⭐' },
  { id: 'SANS_FAUTE', name: 'Sans faute', how: 'Une poursuite sans aucune mauvaise direction.', icon: '🎯' },
  { id: 'ECLAIR', name: 'Éclair', how: 'Arrêtez un suspect avec plus de la moitié du temps restant.', icon: '⚡' },
  { id: 'OREILLE_D_OR', name: 'Oreille d’or', how: 'Une arrestation au niveau Expert sans répétition.', icon: '👂' },
  { id: 'PIED_LEGER', name: 'Pied léger', how: 'Arrêtez un suspect à pied.', icon: '👟' },
  { id: 'NOCTAMBULE', name: 'Noctambule', how: `${10} arrestations en mode nuit.`, icon: '🌙' },
  { id: 'MARATHONIEN', name: 'Marathonien', how: `${25} arrestations en tout.`, icon: '🏃' },
  { id: 'CHASSEUR_ULTIME', name: 'Chasseur ultime', how: 'Une médaille d’or pour les 8 suspects de la campagne.', icon: '🏆' },
  { id: 'BOSS', name: 'Le Boss sous les verrous', how: 'Arrêtez le Boss.', icon: '🐻' },
  { id: 'PATRONNE', name: 'La Patronne sous les verrous', how: 'Arrêtez la Patronne.', icon: '🐆' },
];

/** Captures needed for the counting badges. */
export const BADGE_COUNTS = { NOCTAMBULE: 10, MARATHONIEN: 25 } as const;

export function badge(id: BadgeId): Badge {
  return BADGES.find((b) => b.id === id) as Badge;
}

/* The hidden bosses: two secret suspects beyond the campaign's eight. */

export interface BossInfo {
  nickname: string;
  /** Short id for the picture, and the key of its case file. */
  picture: string;
  difficulty: Difficulty;
  /** The longest kinds of chase: three stages. */
  chaseType: ChaseType;
  /** Extra seconds on the clock for the longer chase. */
  extraSeconds: number;
  /** How it is found, in French (shown while locked). */
  unlock: string;
}

export const BOSSES: readonly BossInfo[] = [
  { nickname: 'Le Boss', picture: 'boss', difficulty: 'EXPERT', chaseType: 'CAR_FOOT_CAR', extraSeconds: 30, unlock: 'Une médaille d’or pour les 8 suspects' },
  { nickname: 'La Patronne', picture: 'patronne', difficulty: 'EXPERT', chaseType: 'FOOT_CAR_FOOT', extraSeconds: 30, unlock: 'Le Boss arrêté' },
];

export const BOSS = BOSSES[0] as BossInfo;

export function bossInfo(picture: string): BossInfo | undefined {
  return BOSSES.find((b) => b.picture === picture);
}

/** The first boss waits for gold on every mission; the second for the first one's arrest. */
export function bossUnlocked(progress: CampaignProgress, profile: Profile, picture: string = BOSS.picture): boolean {
  const i = BOSSES.findIndex((b) => b.picture === picture);
  if (i < 0) return false;
  if (i === 0) return progress.missions.every((m) => medalAtLeast(m?.medal ?? null, 'GOLD'));
  const before = BOSSES[i - 1] as BossInfo;
  return (profile.files[before.picture]?.arrests ?? 0) > 0;
}

/**
 * Suspects run and drive a little faster at each rank (their last-stage
 * speed is multiplied by this, per rank above Stagiaire), so a Commissaire's
 * chases stay a challenge; the police still close in.
 */
export const RANK_PACE = 0.02;

export function suspectPaceFor(points: number): number {
  const i = RANKS.findIndex((r) => r.id === rankFor(points).id);
  return 1 + RANK_PACE * i;
}

/* Case files: what the police know about each suspect. */

export interface CaseFile {
  /** Times arrested, and times it got away. */
  arrests: number;
  escapes: number;
  bestScore: number;
  medal: Medal | null;
  /** Quickest arrest (seconds from the start), or null. */
  quickest: number | null;
  /** Location ID the suspect was last arrested near (or last seen heading for). */
  lastSeen: string | null;
  /** Its vehicle in that chase (null on foot). */
  vehicle: Vehicle | null;
  chaseType: ChaseType | null;
  /** The date (YYYY-MM-DD) of the first arrest. */
  firstArrest: string | null;
}

export const EMPTY_FILE: CaseFile = {
  arrests: 0,
  escapes: 0,
  bestScore: 0,
  medal: null,
  quickest: null,
  lastSeen: null,
  vehicle: null,
  chaseType: null,
  firstArrest: null,
};

export interface Profile {
  version: 1;
  /** Points from every chase ever played. */
  points: number;
  /** Suspects arrested, in every mode. */
  arrests: number;
  nightArrests: number;
  /** Badge → the date it was earned (YYYY-MM-DD). */
  badges: Partial<Record<BadgeId, string>>;
  /** Case files by suspect picture id ("renard" … "requin", "boss", "patronne"). */
  files: Record<string, CaseFile>;
}

export function newProfile(): Profile {
  return { version: 1, points: 0, arrests: 0, nightArrests: 0, badges: {}, files: {} };
}

/** Everything about one finished chase that the record keeps. */
export interface ChaseOutcome {
  stats: MissionStats;
  score: MissionScore;
  /** Seconds the whole chase allowed (to tell a quick arrest). */
  timeLimit: number;
  night: boolean;
  /** The player's mode at the end. */
  mode: TravelMode;
  /** Which suspect: a campaign suspect's or a boss's picture id, or null for practice. */
  suspect: string | null;
  lastSeen: string | null;
  vehicle: Vehicle | null;
  chaseType: ChaseType;
  /** The campaign as it stands after this chase. */
  campaign: CampaignProgress;
  /** Today, as YYYY-MM-DD. */
  date: string;
}

export interface Recorded {
  profile: Profile;
  newBadges: Badge[];
  rankBefore: Rank;
  rankAfter: Rank;
}

/** Adds a finished chase to the record: points, arrests, badges and the suspect's case file. */
export function recordChase(before: Profile, outcome: ChaseOutcome): Recorded {
  const { stats, score } = outcome;
  const captured = stats.captured;
  const profile: Profile = {
    ...before,
    points: before.points + score.total,
    arrests: before.arrests + (captured ? 1 : 0),
    nightArrests: before.nightArrests + (captured && outcome.night ? 1 : 0),
    badges: { ...before.badges },
    files: { ...before.files },
  };
  if (outcome.suspect) {
    const file = profile.files[outcome.suspect] ?? EMPTY_FILE;
    const elapsed = outcome.timeLimit - stats.timeLeft;
    profile.files[outcome.suspect] = {
      arrests: file.arrests + (captured ? 1 : 0),
      escapes: file.escapes + (captured ? 0 : 1),
      bestScore: Math.max(file.bestScore, score.total),
      medal: bestMedal(file.medal, score.medal),
      quickest: captured ? Math.min(file.quickest ?? Infinity, Math.round(elapsed)) : file.quickest,
      lastSeen: outcome.lastSeen ?? file.lastSeen,
      vehicle: outcome.vehicle,
      chaseType: outcome.chaseType,
      firstArrest: file.firstArrest ?? (captured ? outcome.date : null),
    };
  }
  const newBadges = BADGES.filter((b) => !before.badges[b.id] && earned(b.id, profile, outcome));
  for (const b of newBadges) profile.badges[b.id] = outcome.date;
  return { profile, newBadges, rankBefore: rankFor(before.points), rankAfter: rankFor(profile.points) };
}

function earned(id: BadgeId, after: Profile, outcome: ChaseOutcome): boolean {
  const { stats } = outcome;
  const captured = stats.captured;
  switch (id) {
    case 'PREMIERE':
      return captured;
    case 'SANS_FAUTE':
      return captured && stats.wrongTurns === 0;
    case 'ECLAIR':
      return captured && stats.timeLeft > outcome.timeLimit / 2;
    case 'OREILLE_D_OR':
      return captured && stats.difficulty === 'EXPERT' && stats.repeatsUsed === 0;
    case 'PIED_LEGER':
      return captured && outcome.mode === 'FOOT';
    case 'NOCTAMBULE':
      return after.nightArrests >= BADGE_COUNTS.NOCTAMBULE;
    case 'MARATHONIEN':
      return after.arrests >= BADGE_COUNTS.MARATHONIEN;
    case 'CHASSEUR_ULTIME':
      return outcome.campaign.missions.every((m) => medalAtLeast(m?.medal ?? null, 'GOLD'));
    case 'BOSS':
      return captured && outcome.suspect === 'boss';
    case 'PATRONNE':
      return captured && outcome.suspect === 'patronne';
  }
}

/** The suspects with a file on the wall: the campaign's eight, then the bosses. */
export const SUSPECT_FILES: readonly { picture: string; nickname: string; difficulty: Difficulty }[] = [
  ...MISSIONS.map((m) => ({ picture: m.picture, nickname: m.nickname, difficulty: m.difficulty })),
  ...BOSSES.map((b) => ({ picture: b.picture, nickname: b.nickname, difficulty: b.difficulty })),
];

/** Reads a saved record back, or starts a fresh one from missing or damaged data. */
export function parseProfile(json: string | null): Profile {
  if (!json) return newProfile();
  try {
    const data = JSON.parse(json) as Partial<Profile>;
    if (data.version !== 1) return newProfile();
    const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
    const isMedal = (m: unknown): m is Medal => m === 'GOLD' || m === 'SILVER' || m === 'BRONZE';
    const badges: Partial<Record<BadgeId, string>> = {};
    if (data.badges && typeof data.badges === 'object') {
      for (const id of BADGE_IDS) {
        const on = (data.badges as Record<string, unknown>)[id];
        if (typeof on === 'string') badges[id] = on;
      }
    }
    const files: Record<string, CaseFile> = {};
    if (data.files && typeof data.files === 'object') {
      for (const [picture, f] of Object.entries(data.files as Record<string, Partial<CaseFile>>)) {
        if (!f || typeof f !== 'object') continue;
        files[picture] = {
          arrests: count(f.arrests),
          escapes: count(f.escapes),
          bestScore: count(f.bestScore),
          medal: isMedal(f.medal) ? f.medal : null,
          quickest: typeof f.quickest === 'number' ? count(f.quickest) : null,
          lastSeen: typeof f.lastSeen === 'string' ? f.lastSeen : null,
          vehicle: typeof f.vehicle === 'string' ? (f.vehicle as Vehicle) : null,
          chaseType: typeof f.chaseType === 'string' ? (f.chaseType as ChaseType) : null,
          firstArrest: typeof f.firstArrest === 'string' ? f.firstArrest : null,
        };
      }
    }
    return { version: 1, points: count(data.points), arrests: count(data.arrests), nightArrests: count(data.nightArrests), badges, files };
  } catch {
    return newProfile();
  }
}
