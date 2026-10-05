import { describe, expect, it } from 'vitest';
import { newCampaign } from '../../src/engine/campaign/campaign';
import {
  COSMETIC_SLOTS,
  cosmeticsIn,
  DEFAULT_LOOK,
  equippedLook,
  isCosmeticUnlocked,
  liveryLook,
  newlyEarned,
  nextReward,
  unlockedCount,
  type CosmeticContext,
} from '../../src/engine/campaign/cosmetics';
import { EMPTY_FILE, newProfile, parseProfile, starsFor, totalStars, type Profile } from '../../src/engine/campaign/profile';

const ctx = (profile: Partial<Profile> = {}, month = 6): CosmeticContext => ({
  progress: newCampaign(),
  profile: { ...newProfile(), ...profile },
  month,
});

describe('stars', () => {
  it('gives one star for the arrest, one for no wrong turn, one for no repeat', () => {
    expect(starsFor({ captured: false, wrongTurns: 0, repeatsUsed: 0 })).toBe(0);
    expect(starsFor({ captured: true, wrongTurns: 2, repeatsUsed: 1 })).toBe(1);
    expect(starsFor({ captured: true, wrongTurns: 0, repeatsUsed: 1 })).toBe(2);
    expect(starsFor({ captured: true, wrongTurns: 1, repeatsUsed: 0 })).toBe(2);
    expect(starsFor({ captured: true, wrongTurns: 0, repeatsUsed: 0 })).toBe(3);
  });

  it('adds up the best stars per suspect and keeps them through a save', () => {
    const profile: Profile = { ...newProfile(), files: { renard: { ...EMPTY_FILE, stars: 3 }, chat: { ...EMPTY_FILE, stars: 2 } } };
    expect(totalStars(profile)).toBe(5);
    const back = parseProfile(JSON.stringify({ ...profile, look: { SMOKE: 'BLEUE' } }));
    expect(totalStars(back)).toBe(5);
    expect(back.look.SMOKE).toBe('BLEUE');
  });

  it('reads an old save without stars or garage choices', () => {
    const old = JSON.parse(JSON.stringify(newProfile()));
    delete old.look;
    old.files = { renard: { ...EMPTY_FILE, arrests: 1 } };
    delete old.files.renard.stars;
    const back = parseProfile(JSON.stringify(old));
    expect(back.files.renard!.stars).toBe(0);
    expect(back.look).toEqual({});
  });
});

describe('garage', () => {
  it('has a free default in every slot', () => {
    for (const slot of COSMETIC_SLOTS) {
      expect(cosmeticsIn(slot).length).toBeGreaterThan(1);
      expect(isCosmeticUnlocked(ctx(), slot, DEFAULT_LOOK[slot])).toBe(true);
    }
  });

  it('wears only what has been earned, and falls back to the default', () => {
    const fresh = ctx({ look: { SMOKE: 'ARC_EN_CIEL', VEHICLE: 'NOPE' } });
    expect(equippedLook(fresh)).toEqual(DEFAULT_LOOK);
    expect(equippedLook(fresh, true).SMOKE).toBe('ARC_EN_CIEL');
    const starry = ctx({ look: { SMOKE: 'ARC_EN_CIEL' }, files: { a: { ...EMPTY_FILE, stars: 3 }, b: { ...EMPTY_FILE, stars: 3 }, c: { ...EMPTY_FILE, stars: 3 }, d: { ...EMPTY_FILE, stars: 3 } } });
    expect(equippedLook(starry).SMOKE).toBe('ARC_EN_CIEL');
  });

  it('opens the Christmas hat in December', () => {
    expect(isCosmeticUnlocked(ctx({}, 6), 'OUTFIT', 'NOEL')).toBe(false);
    expect(isCosmeticUnlocked(ctx({}, 12), 'OUTFIT', 'NOEL')).toBe(true);
  });

  it('lists what a chase newly earned', () => {
    const before = ctx();
    const after = ctx({ arrests: 2 });
    const ids = newlyEarned(before, after).map((c) => `${c.slot}:${c.id}`);
    expect(ids).toContain('OUTFIT:LUNETTES');
    expect(ids).toContain('ARREST:CONFETTIS');
    expect(newlyEarned(after, after)).toEqual([]);
  });

  it('counts what is open and points at the closest locked reward', () => {
    const fresh = unlockedCount(ctx());
    expect(fresh.have).toBeGreaterThan(0);
    expect(fresh.have).toBeLessThan(fresh.total);
    const next = nextReward(ctx({ arrests: 1 }));
    expect(next).not.toBeNull();
    expect(next!.progress.have).toBeLessThan(next!.progress.need);
    expect(next!.item.unlocked(ctx({ arrests: 1 }))).toBe(false);
    // One arrest away from the two-arrest rewards: those come first.
    expect(next!.progress.need - next!.progress.have).toBe(1);
  });

  it('opens the getaway cars and fugitive looks with escapes', () => {
    expect(isCosmeticUnlocked(ctx(), 'GETAWAY', 'SPORTIVE')).toBe(false);
    expect(isCosmeticUnlocked(ctx({ escapes: 1 }), 'GETAWAY', 'SPORTIVE')).toBe(true);
    expect(isCosmeticUnlocked(ctx({ escapes: 1 }), 'FUGITIVE', 'NOIR')).toBe(true);
    expect(isCosmeticUnlocked(ctx({ escapes: 1 }), 'FUGITIVE', 'VERT')).toBe(false);
  });

  it('knows the colours of every livery, falling back to the classic one', () => {
    for (const item of cosmeticsIn('LIVERY')) expect(liveryLook(item.id).id).toBe(item.id);
    expect(liveryLook('UNKNOWN').id).toBe('CLASSIQUE');
  });
});
