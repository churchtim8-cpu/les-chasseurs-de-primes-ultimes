import { equippedLook, isCosmeticUnlocked, type CosmeticContext, type CosmeticSlot } from '../engine/campaign/cosmetics';
import { loadProgress } from './campaignStore';
import { loadProfile, saveProfile } from './profileStore';

/** `?unlock=all` in the address opens everything in the garage (for testing and for showing the class). */
export function everythingUnlocked(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('unlock') === 'all';
  } catch {
    return false;
  }
}

export function lookContext(): CosmeticContext {
  return { progress: loadProgress(), profile: loadProfile(), month: new Date().getMonth() + 1 };
}

/** What the player's police wear now, slot by slot. */
export function currentLook(): Record<CosmeticSlot, string> {
  return equippedLook(lookContext(), everythingUnlocked());
}

export function isEarned(slot: CosmeticSlot, id: string): boolean {
  return isCosmeticUnlocked(lookContext(), slot, id, everythingUnlocked());
}

/** Wear `id` in `slot` from now on (only if it has been earned). */
export function chooseLook(slot: CosmeticSlot, id: string): void {
  if (!isEarned(slot, id)) return;
  const profile = loadProfile();
  saveProfile({ ...profile, look: { ...profile.look, [slot]: id } });
}
