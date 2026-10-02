import { parseProgress, type CampaignProgress } from '../engine/campaign/campaign';

/**
 * The saved campaign (blueprint section 23: progress, cosmetics and stats),
 * kept in the browser's storage on this device. Private windows can refuse
 * storage; progress then lasts for this visit only.
 */
const KEY = 'chasseurs.campaign';
let memory: CampaignProgress | null = null;

export function loadProgress(): CampaignProgress {
  if (memory) return memory;
  try {
    memory = parseProgress(window.localStorage.getItem(KEY));
  } catch {
    memory = parseProgress(null);
  }
  return memory;
}

export function saveProgress(progress: CampaignProgress): void {
  memory = progress;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // storage unavailable: kept in memory for this visit
  }
}
