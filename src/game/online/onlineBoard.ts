import { DAILY_ONLINE, parseOnlineRows, parseQueue, queueScore, type DailyEntry, type PendingScore } from '../../engine/campaign/daily';
import { today } from '../profileStore';
import { onlineConfig, type OnlineConfig } from './config';

/**
 * Talks to the online class board (a Supabase database, through its plain web
 * address, no extra library). Every call gives up quietly after a few seconds:
 * the device board and score codes keep working when the school network blocks
 * the site or the free project is asleep. First tries that cannot be sent wait
 * in the browser's storage and go the next time the daily screen opens.
 */
const QUEUE_KEY = 'chasseurs.daily.unsent';

export function onlineOn(): boolean {
  return onlineConfig() !== null;
}

async function call(cfg: OnlineConfig, path: string, init: RequestInit = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), DAILY_ONLINE.timeoutMs);
  try {
    return await fetch(`${cfg.url}/rest/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** One class's board for one day from the server, or null when it cannot be reached. */
export async function fetchBoard(date: string, classCode: string): Promise<DailyEntry[] | null> {
  const cfg = onlineConfig();
  if (!cfg) return null;
  const query = new URLSearchParams({ select: 'nickname,score,stars', day: `eq.${date}`, class_code: `eq.${classCode}`, order: 'score.desc,stars.desc,nickname.asc', limit: '30' });
  const res = await call(cfg, `daily_scores?${query.toString()}`);
  if (!res?.ok) return null;
  try {
    return parseOnlineRows(await res.json(), date, classCode);
  } catch {
    return null;
  }
}

function loadQueue(): PendingScore[] {
  try {
    return parseQueue(window.localStorage.getItem(QUEUE_KEY));
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingScore[]): void {
  try {
    if (queue.length) window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    else window.localStorage.removeItem(QUEUE_KEY);
  } catch {
    // storage unavailable: the try is lost from the online board, the score code still proves it
  }
}

/** 'sent', 'refused' (the server will never take it, e.g. too old) or 'offline' (try again later). */
type SendResult = 'sent' | 'refused' | 'offline';

async function send(cfg: OnlineConfig, score: PendingScore): Promise<SendResult> {
  const body = { day: score.date, class_code: score.classCode, nickname: score.nickname, score: score.score, stars: score.stars };
  // A second send of the same first try is ignored by the server, never doubled.
  const res = await call(cfg, 'daily_scores?on_conflict=day,class_code,nickname', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res) return 'offline';
  if (res.ok) return 'sent';
  return res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 ? 'refused' : 'offline';
}

/** Puts a first try on the waiting list and sends everything waiting. Resolves true when this try reached the server. */
export async function submitScore(score: PendingScore): Promise<boolean> {
  if (!onlineOn()) return false;
  saveQueue(queueScore(loadQueue(), score, today()));
  const left = await flushScores();
  return !left.some((p) => p.date === score.date && p.nickname === score.nickname && p.classCode === score.classCode);
}

/** Sends the first tries still waiting; returns the ones that must wait longer. */
export async function flushScores(): Promise<PendingScore[]> {
  const cfg = onlineConfig();
  const queue = loadQueue();
  if (!cfg || queue.length === 0) return queue;
  const left: PendingScore[] = [];
  for (const score of queue) {
    if ((await send(cfg, score)) === 'offline') left.push(score);
  }
  // Something new may have been queued meanwhile: keep it too.
  const now = loadQueue().filter((p) => !queue.some((q) => q.date === p.date && q.nickname === p.nickname && q.classCode === p.classCode));
  saveQueue([...left, ...now]);
  return [...left, ...now];
}

/** For the teacher: removes one name from a class board with the teacher PIN. 'removed', 'wrong' (PIN or name) or 'offline'. */
export async function removeScore(date: string, classCode: string, nickname: string, pin: string): Promise<'removed' | 'wrong' | 'offline'> {
  const cfg = onlineConfig();
  if (!cfg) return 'offline';
  const res = await call(cfg, 'rpc/remove_daily_score', {
    method: 'POST',
    body: JSON.stringify({ p_day: date, p_class: classCode, p_nickname: nickname, p_pin: pin }),
  });
  if (!res?.ok) return 'offline';
  try {
    return (await res.json()) === true ? 'removed' : 'wrong';
  } catch {
    return 'offline';
  }
}
