import type { Difficulty } from '../difficulty';
import { createSeed, type ChaseSeed } from '../rng/seedCode';
import { Rng } from '../rng/prng';
import { pickWeather, type Weather } from '../world/weather';

/**
 * Le défi du jour (Mr Henry, 2026-10-04): one chase a day, the same for every
 * student, made from the date alone, so a whole class hears the same French
 * and can compare scores. Only the first try counts on the class board (later
 * tries are practice: by then the route is known).
 *
 * There is no server, so each device keeps its own board, per class code. A
 * finished daily chase shows a short score code that proves the score for that
 * nickname, class and day; the teacher can type codes into their own device to
 * gather the whole class on one board.
 */
export const DAILY = {
  /** The level of the day, Sunday first (Date.getDay() order). */
  levelByWeekday: ['HARD', 'EASY', 'INTERMEDIATE', 'HARD', 'INTERMEDIATE', 'EXPERT', 'EASY'] as readonly Difficulty[],
  /** Entries kept per class and day, and how long old days are kept. */
  boardSize: 30,
  keepDays: 14,
  maxNickname: 14,
  maxClassCode: 8,
} as const;

export interface DailyChase {
  /** The day, as YYYY-MM-DD in the player's own time zone. */
  date: string;
  difficulty: Difficulty;
  seed: ChaseSeed;
  /** Everybody gets the same weather too, so the board is fair. */
  weather: Weather;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 2000-01-01 for a YYYY-MM-DD date (calendar arithmetic, no time zones). */
export function dayNumber(date: string): number {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`Not a date: ${date}`);
  const y = Number(m[1]);
  const month = Number(m[2]);
  const d = Number(m[3]);
  // Days from civil (Howard Hinnant's algorithm), shifted to 2000-01-01.
  const yy = month <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468 - 10957;
}

/** The day's chase: the same for everybody on that date. */
export function dailyChase(date: string): DailyChase {
  // 2000-01-01 was a Saturday (getDay() 6).
  const weekday = (((dayNumber(date) + 6) % 7) + 7) % 7;
  const difficulty = DAILY.levelByWeekday[weekday] as Difficulty;
  const rng = Rng.fromSeed(`daily/${date}`);
  const seed = createSeed(difficulty, (n) => rng.int(0, n - 1));
  return { date, difficulty, seed, weather: pickWeather(rng.fork('weather')) };
}

/** Nicknames and class codes as they are compared: trimmed, single spaces, upper case. */
export function cleanName(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max);
}

// ---------------------------------------------------------------- score codes

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SCORE_BITS = 13;
const MAX_SCORE = 2 ** SCORE_BITS - 1;

/** A small, steady string hash (FNV-1a, 32 bits). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface DailyScore {
  score: number;
  stars: number;
}

/**
 * The score code for one result, e.g. "7K3Q-M2PX": the score and stars, mixed
 * with the nickname, class and day and sealed with a check, so a code only
 * works for the student, class and day it was earned on.
 */
export function scoreCode(date: string, nickname: string, classCode: string, result: DailyScore): string {
  const who = `${cleanName(nickname, DAILY.maxNickname)}|${cleanName(classCode, DAILY.maxClassCode)}|${date}`;
  const score = Math.max(0, Math.min(MAX_SCORE, Math.round(result.score)));
  const stars = Math.max(0, Math.min(3, result.stars));
  const payload = (score << 2) | stars; // 15 bits
  const mask = hash(`mask|${who}`) & 0x7fff;
  const check = hash(`check|${who}|${payload}`) & 0x7fff;
  const value = ((payload ^ mask) * 0x8000 + check) % 2 ** 30; // 30 bits: 6 characters
  let out = '';
  let rest = value;
  for (let i = 0; i < 6; i++) {
    out = (ALPHABET[rest % 32] as string) + out;
    rest = Math.floor(rest / 32);
  }
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

/** Reads a score code back for that student, class and day, or null if it does not belong to them. */
export function readScoreCode(code: string, date: string, nickname: string, classCode: string): DailyScore | null {
  const compact = code.toUpperCase().replace(/[\s_-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-Z]{6}$/.test(compact) || [...compact].some((c) => !ALPHABET.includes(c))) return null;
  const value = [...compact].reduce((acc, c) => acc * 32 + ALPHABET.indexOf(c), 0);
  const who = `${cleanName(nickname, DAILY.maxNickname)}|${cleanName(classCode, DAILY.maxClassCode)}|${date}`;
  const payload = (Math.floor(value / 0x8000) ^ (hash(`mask|${who}`) & 0x7fff)) & 0x7fff;
  const check = value % 0x8000;
  if ((hash(`check|${who}|${payload}`) & 0x7fff) !== check) return null;
  return { score: payload >> 2, stars: payload & 3 };
}

// ---------------------------------------------------------------- the board

export interface DailyEntry extends DailyScore {
  date: string;
  nickname: string;
  classCode: string;
  /** Played on this device (true), or typed in from a score code (false). */
  local: boolean;
}

export interface DailyBoard {
  version: 1;
  /** The nickname and class last used on this device. */
  nickname: string;
  classCode: string;
  entries: DailyEntry[];
  /** Days already played on this device: later tries are practice. */
  played: string[];
}

export function newBoard(): DailyBoard {
  return { version: 1, nickname: '', classCode: '', entries: [], played: [] };
}

/** Reads a saved board back, or a fresh one from missing or damaged data. */
export function parseBoard(raw: string | null): DailyBoard {
  if (!raw) return newBoard();
  try {
    const data = JSON.parse(raw) as Partial<DailyBoard>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const entries = Array.isArray(data.entries)
      ? data.entries.filter(
          (e): e is DailyEntry =>
            !!e && DATE.test(str(e.date)) && typeof e.nickname === 'string' && typeof e.classCode === 'string' && Number.isFinite(e.score) && Number.isFinite(e.stars),
        ).map((e) => ({ ...e, local: e.local === true }))
      : [];
    const played = Array.isArray(data.played) ? data.played.filter((d): d is string => DATE.test(str(d))) : [];
    return { version: 1, nickname: str(data.nickname), classCode: str(data.classCode), entries, played };
  } catch {
    return newBoard();
  }
}

/** Has today's daily chase already been played on this device? */
export function hasPlayed(board: DailyBoard, date: string): boolean {
  return board.played.includes(date);
}

/** The daily chase has started on this device: whatever happens next, later tries are practice. */
export function markPlayed(board: DailyBoard, date: string): DailyBoard {
  return hasPlayed(board, date) ? board : { ...board, played: [...board.played, date] };
}

/**
 * Adds a result: one entry per student, class and day (a code typed in again
 * replaces the old one), and drops days older than `keepDays`.
 */
export function addEntry(board: DailyBoard, entry: DailyEntry): DailyBoard {
  const nickname = cleanName(entry.nickname, DAILY.maxNickname);
  const classCode = cleanName(entry.classCode, DAILY.maxClassCode);
  const today = dayNumber(entry.date);
  const kept = board.entries.filter(
    (e) => today - dayNumber(e.date) < DAILY.keepDays && !(e.date === entry.date && e.nickname === nickname && e.classCode === classCode),
  );
  const played = entry.local && !board.played.includes(entry.date) ? [...board.played, entry.date] : board.played;
  return {
    ...board,
    entries: [...kept, { ...entry, nickname, classCode }],
    played: played.filter((d) => today - dayNumber(d) < DAILY.keepDays),
  };
}

/** One class's board for one day, best first (score, then stars, then name). */
export function boardFor(board: DailyBoard, date: string, classCode: string): DailyEntry[] {
  const code = cleanName(classCode, DAILY.maxClassCode);
  return board.entries
    .filter((e) => e.date === date && e.classCode === code)
    .sort((a, b) => b.score - a.score || b.stars - a.stars || a.nickname.localeCompare(b.nickname))
    .slice(0, DAILY.boardSize);
}
