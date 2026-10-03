import { parseProfile, type Profile } from '../engine/campaign/profile';

/**
 * The player's record (points, rank, badges, case files), kept in the
 * browser's storage on this device like the campaign. Private windows can
 * refuse storage; the record then lasts for this visit only.
 */
const KEY = 'chasseurs.profile';
let memory: Profile | null = null;

export function loadProfile(): Profile {
  if (memory) return memory;
  try {
    memory = parseProfile(window.localStorage.getItem(KEY));
  } catch {
    memory = parseProfile(null);
  }
  return memory;
}

export function saveProfile(profile: Profile): void {
  memory = profile;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // storage unavailable: kept in memory for this visit
  }
}

/** Today's date as YYYY-MM-DD, in the player's own time zone. */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `?boss=1` in the address opens the Boss without the eight gold medals (for testing). */
export function bossForced(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('boss') === '1';
  } catch {
    return false;
  }
}
