import { parseEscapeProgress, type EscapeProgress, type OfficerInfo } from '../engine/campaign/officers';
import { newSeed } from './seedSource';

/**
 * The escape campaign's progress (officers escaped, best scores and stars),
 * kept in the browser's storage on this device like the campaign. Private
 * windows can refuse storage; progress then lasts for this visit only.
 */
const KEY = 'chasseurs.escape';
let memory: EscapeProgress | null = null;

export function loadEscapeProgress(): EscapeProgress {
  if (memory) return memory;
  try {
    memory = parseEscapeProgress(window.localStorage.getItem(KEY));
  } catch {
    memory = parseEscapeProgress(null);
  }
  return memory;
}

export function saveEscapeProgress(progress: EscapeProgress): void {
  memory = progress;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // storage unavailable: kept in memory for this visit
  }
}

/** A fresh escape at the officer's level (a new town route every try, as in the campaign). */
export function newEscapeSeed(officer: OfficerInfo): string {
  return newSeed(officer.difficulty).code;
}
