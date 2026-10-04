import { parseBoard, type DailyBoard } from '../engine/campaign/daily';

/**
 * Le défi du jour's class boards, kept in the browser's storage on this
 * device like the campaign. Private windows can refuse storage; the board then
 * lasts for this visit only.
 */
const KEY = 'chasseurs.daily';
let memory: DailyBoard | null = null;

export function loadBoard(): DailyBoard {
  if (memory) return memory;
  try {
    memory = parseBoard(window.localStorage.getItem(KEY));
  } catch {
    memory = parseBoard(null);
  }
  return memory;
}

export function saveBoard(board: DailyBoard): void {
  memory = board;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(board));
  } catch {
    // storage unavailable: kept in memory for this visit
  }
}
