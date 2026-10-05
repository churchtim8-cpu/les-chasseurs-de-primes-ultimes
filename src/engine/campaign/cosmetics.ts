import { capturedCount, isLiveryUnlocked, LIVERIES as CAMPAIGN_LIVERIES, type CampaignProgress } from './campaign';
import { RANKS, rankFor, totalStars, type BadgeId, type Profile, type RankId } from './profile';
import { medalAtLeast } from './scoring';

/**
 * The garage (Mr Henry, 2026-10-04, enlarged 2026-10-05): everything the
 * player can change about how their police look and celebrate, and in Escape
 * Mode how their fugitive and getaway car look, and how each choice is earned.
 * Plain data and rules only; the game draws them. Earned by arrests, escapes,
 * stars, ranks, badges and medals, never bought: there is no money in the game.
 * Locked items can be looked at in the garage, so players see what they are
 * working towards.
 */

export const COSMETIC_SLOTS = ['VEHICLE', 'LIVERY', 'OUTFIT', 'POSE', 'SMOKE', 'ARREST', 'HUD', 'GETAWAY', 'FUGITIVE'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/** Slot names shown in the garage (menus are in English). */
export const SLOT_NAMES: Record<CosmeticSlot, string> = {
  VEHICLE: 'Vehicle',
  LIVERY: 'Colours',
  OUTFIT: 'Officer',
  POSE: 'Victory',
  SMOKE: 'Smoke',
  ARREST: 'Arrest',
  HUD: 'Screen',
  GETAWAY: 'Getaway car',
  FUGITIVE: 'Fugitive',
};

/** Slots used in Escape Mode only (the player is the fugitive there). */
export const ESCAPE_SLOTS: readonly CosmeticSlot[] = ['GETAWAY', 'FUGITIVE'];

/** What the rules can look at. */
export interface CosmeticContext {
  progress: CampaignProgress;
  profile: Profile;
  /** 1-12: some looks are free in their season. */
  month: number;
}

/** How far along a counted unlock is (for "3 / 5 arrests" in the garage). */
export interface UnlockProgress {
  have: number;
  need: number;
}

export interface Cosmetic {
  slot: CosmeticSlot;
  id: string;
  /** Shown in the garage. */
  name: string;
  /** How it is earned ('' when free). */
  unlock: string;
  unlocked: (ctx: CosmeticContext) => boolean;
  /** For counted unlocks: how far along the player is. */
  progress?: (ctx: CosmeticContext) => UnlockProgress;
}

/** Police car and uniform colours; `pattern` is drawn over the body. */
export interface LiveryLook {
  id: string;
  body: number;
  stripe: number;
  uniform: number;
  pattern?: LiveryPattern;
}

export type LiveryPattern = 'CARNIVAL' | 'FLAG' | 'NEON' | 'CAMO' | 'WAVES' | 'FLOWERS' | 'CHECK' | 'STARS' | 'SUNSET';

type Rule = Pick<Cosmetic, 'unlock' | 'unlocked' | 'progress'>;

const free: Rule = { unlock: '', unlocked: () => true };
const rankIndex = (id: RankId) => RANKS.findIndex((r) => r.id === id);
const rankName = (id: RankId) => RANKS.find((r) => r.id === id)!.name;
const rankAtLeast = (id: RankId): Rule => ({
  unlock: `rank ${rankName(id)}`,
  unlocked: (ctx) => rankIndex(rankFor(ctx.profile.points).id) >= rankIndex(id),
  progress: (ctx) => ({ have: Math.min(ctx.profile.points, RANKS[rankIndex(id)]!.points), need: RANKS[rankIndex(id)]!.points }),
});
/** A counted unlock: `n` of something the profile keeps count of. */
const counted = (label: string, get: (ctx: CosmeticContext) => number, n: number): Rule => ({
  unlock: `${n} ${label}`,
  unlocked: (ctx) => get(ctx) >= n,
  progress: (ctx) => ({ have: Math.min(get(ctx), n), need: n }),
});
const arrests = (n: number) => counted(n === 1 ? 'arrest' : 'arrests', (ctx) => ctx.profile.arrests, n);
const stars = (n: number) => counted('stars', (ctx) => totalStars(ctx.profile), n);
const nightArrests = (n: number) => counted(n === 1 ? 'night arrest' : 'night arrests', (ctx) => ctx.profile.nightArrests, n);
const escapes = (n: number) => counted(n === 1 ? 'escape' : 'escapes', (ctx) => ctx.profile.escapes, n);
const badge = (id: BadgeId, name: string): Rule => ({ unlock: `${name} badge`, unlocked: (ctx) => ctx.profile.badges[id] !== undefined });
const either = (a: Rule, b: Rule, unlock: string): Rule => ({ unlock, unlocked: (ctx) => a.unlocked(ctx) || b.unlocked(ctx), ...(a.progress ? { progress: a.progress } : {}) });
const inMonth = (month: number, name: string): Rule => ({ unlock: `in ${name}`, unlocked: (ctx) => ctx.month === month });

/** The garage's extra colours, after the campaign's six (see campaign.ts). */
export const EXTRA_LIVERIES: readonly (LiveryLook & { name: string } & Rule)[] = [
  // School house colours: free, so every house can drive its own.
  { id: 'MAISON_ROUGE', name: 'Red house', body: 0xd23b30, stripe: 0xf7f7f2, uniform: 0x9c2a22, ...free },
  { id: 'MAISON_BLEUE', name: 'Blue house', body: 0x2f6fd6, stripe: 0xf7f7f2, uniform: 0x1f4e9c, ...free },
  { id: 'MAISON_VERTE', name: 'Green house', body: 0x2e9e5b, stripe: 0xf7f7f2, uniform: 0x1f6e40, ...free },
  { id: 'MAISON_JAUNE', name: 'Yellow house', body: 0xf2c230, stripe: 0x21313a, uniform: 0xb38a12, ...free },
  { id: 'OCEAN', name: 'Ocean waves', body: 0x1f8fa8, stripe: 0xf7f7f2, uniform: 0x176a7d, pattern: 'WAVES', ...arrests(2) },
  { id: 'DRAPEAU', name: 'Flag', body: 0xd0212d, stripe: 0x111111, uniform: 0x111111, pattern: 'FLAG', ...arrests(3) },
  { id: 'HIBISCUS', name: 'Hibiscus', body: 0xf07a8a, stripe: 0xfff1d6, uniform: 0xb8405a, pattern: 'FLOWERS', ...stars(6) },
  { id: 'DAMIER', name: 'Racing chequers', body: 0xf4f4f0, stripe: 0x111111, uniform: 0x202020, pattern: 'CHECK', ...badge('ECLAIR', 'Éclair') },
  { id: 'CARNAVAL', name: 'Carnival', body: 0x7b2fbe, stripe: 0xf2c230, uniform: 0x5a1f8c, pattern: 'CARNIVAL', ...stars(10) },
  { id: 'ETOILES', name: 'Starry night', body: 0x14214a, stripe: 0xf2c230, uniform: 0x14214a, pattern: 'STARS', ...nightArrests(1) },
  { id: 'NEON', name: 'Neon', body: 0x1a1d29, stripe: 0x29f0ff, uniform: 0x1a1d29, pattern: 'NEON', ...nightArrests(3) },
  { id: 'SOLEIL', name: 'Sunset', body: 0xf26b3a, stripe: 0xffd166, uniform: 0xb8431f, pattern: 'SUNSET', ...stars(18) },
  { id: 'CAMOUFLAGE', name: 'Camouflage', body: 0x5f6b3a, stripe: 0x2f3420, uniform: 0x4a5430, pattern: 'CAMO', ...rankAtLeast('LIEUTENANT') },
];

const campaignLiveries: Cosmetic[] = CAMPAIGN_LIVERIES.map((l) => ({
  slot: 'LIVERY',
  id: l.id,
  name: l.name,
  unlock: l.unlock,
  unlocked: (ctx) => isLiveryUnlocked(ctx.progress, l.id),
}));

const item = (slot: CosmeticSlot, id: string, name: string, rule: Rule): Cosmetic => ({ slot, id, name, ...rule });

export const COSMETICS: readonly Cosmetic[] = [
  // Vehicles: each drawn the same size as every other car in town (the motorbike and bicycle smaller).
  item('VEHICLE', 'BERLINE', 'Police saloon', free),
  item('VEHICLE', 'MOTO', 'Police motorbike', rankAtLeast('AGENT')),
  item('VEHICLE', 'VELO', 'Police bicycle', stars(5)),
  item('VEHICLE', 'BANALISEE', 'Unmarked car', arrests(5)),
  item('VEHICLE', 'FOURGON', 'Police van', arrests(8)),
  item('VEHICLE', 'VINTAGE', '1970s classic', badge('SANS_FAUTE', 'Sans faute')),
  item('VEHICLE', 'PICKUP', 'Beach patrol pickup', stars(20)),
  item('VEHICLE', 'GENDARMERIE', 'Gendarmerie 4x4', rankAtLeast('BRIGADIER')),
  item('VEHICLE', 'SPORTIVE', 'Sports interceptor', arrests(15)),
  item('VEHICLE', 'PRESTIGE', 'Commissaire’s car', rankAtLeast('COMMISSAIRE')),

  ...campaignLiveries,
  ...EXTRA_LIVERIES.map((l) => item('LIVERY', l.id, l.name, l)),

  // The officer's look, seen on foot and in the garage.
  item('OUTFIT', 'CASQUETTE', 'Cap', free),
  item('OUTFIT', 'LUNETTES', 'Sunglasses', arrests(1)),
  item('OUTFIT', 'PAILLE', 'Straw hat', arrests(4)),
  item('OUTFIT', 'CASQUE', 'Motorbike helmet', rankAtLeast('AGENT')),
  item('OUTFIT', 'BANDANA', 'Bandana', stars(8)),
  item('OUTFIT', 'BERET', 'Beret', rankAtLeast('BRIGADIER')),
  item('OUTFIT', 'CARNAVAL', 'Carnival headdress', stars(15)),
  item('OUTFIT', 'NOEL', 'Christmas hat', either(stars(20), inMonth(12, 'December'), 'in December, or 20 stars')),
  item('OUTFIT', 'COURONNE', 'Gold crown', badge('CHASSEUR_ULTIME', 'Chasseur ultime')),

  // What the officer does after an arrest.
  item('POSE', 'SALUT', 'Salute', free),
  item('POSE', 'POING', 'Fist pump', badge('ECLAIR', 'Éclair')),
  item('POSE', 'PIROUETTE', 'Pirouette', arrests(6)),
  item('POSE', 'SAUT', 'Star jump', badge('INSAISISSABLE', 'Insaisissable')),
  item('POSE', 'DANSE', 'Little dance', stars(24)),

  // Tyre smoke and skid marks.
  item('SMOKE', 'CLASSIQUE', 'Classic', free),
  item('SMOKE', 'BLEUE', 'Blue smoke', rankAtLeast('AGENT')),
  item('SMOKE', 'BONBON', 'Candy pink', stars(4)),
  item('SMOKE', 'EMERAUDE', 'Emerald', arrests(7)),
  item('SMOKE', 'ARC_EN_CIEL', 'Rainbow', stars(12)),
  item('SMOKE', 'GALAXIE', 'Galaxy', rankAtLeast('BRIGADIER')),
  item('SMOKE', 'NEIGE', 'Snow', either(stars(16), inMonth(12, 'December'), 'in December, or 16 stars')),
  item('SMOKE', 'FLAMMES', 'Gold flames', rankAtLeast('CAPITAINE')),

  // The effect when the suspect is caught.
  item('ARREST', 'TAMPON', '« ARRÊTÉ ! » stamp', free),
  item('ARREST', 'CONFETTIS', 'Confetti', arrests(2)),
  item('ARREST', 'ETINCELLES', 'Sparkling handcuffs', badge('PIED_LEGER', 'Pied léger')),
  item('ARREST', 'FEUX', 'Fireworks', arrests(10)),
  item('ARREST', 'ETOILES', 'Shooting stars', rankAtLeast('LIEUTENANT')),
  item('ARREST', 'TOUT', 'All at once', {
    unlock: `8 gold medals, or rank ${rankName('CAPITAINE')}`,
    unlocked: (ctx) => ctx.progress.missions.every((m) => medalAtLeast(m?.medal ?? null, 'GOLD')) || rankAtLeast('CAPITAINE').unlocked(ctx),
  }),

  // The chase screen's colours.
  item('HUD', 'TABLETTE', 'Police tablet', free),
  item('HUD', 'OCEAN', 'Ocean', arrests(2)),
  item('HUD', 'RETRO', 'Retro screen', { unlock: '4 campaign suspects arrested', unlocked: (ctx) => capturedCount(ctx.progress) >= 4, progress: (ctx) => ({ have: Math.min(4, capturedCount(ctx.progress)), need: 4 }) }),
  item('HUD', 'NUIT', 'Midnight', nightArrests(2)),
  item('HUD', 'ROSE', 'Candy', stars(8)),
  item('HUD', 'CARNAVAL', 'Carnival', stars(10)),
  item('HUD', 'OR', 'Gold', rankAtLeast('COMMISSAIRE')),

  // Escape Mode: the getaway car (the colour the story gives it, or a car of the player's own).
  item('GETAWAY', 'STANDARD', 'Any old car', free),
  item('GETAWAY', 'SPORTIVE', 'Red sports car', escapes(1)),
  item('GETAWAY', 'CABRIOLET', 'Yellow convertible', escapes(2)),
  item('GETAWAY', 'MUSCLE', 'Black muscle car', escapes(3)),
  item('GETAWAY', 'RETRO', 'Mint classic', escapes(5)),
  item('GETAWAY', 'CAMION', 'Delivery van', stars(14)),

  // Escape Mode: the fugitive on foot.
  item('FUGITIVE', 'ROUGE', 'Red hoodie', free),
  item('FUGITIVE', 'NOIR', 'Black hoodie', escapes(1)),
  item('FUGITIVE', 'VERT', 'Green tracksuit', escapes(2)),
  item('FUGITIVE', 'CASQUETTE', 'Backwards cap', escapes(4)),
  item('FUGITIVE', 'MASQUE', 'Carnival mask', stars(10)),
];

/** The free first choice in each slot. */
export const DEFAULT_LOOK: Record<CosmeticSlot, string> = {
  VEHICLE: 'BERLINE',
  LIVERY: 'CLASSIQUE',
  OUTFIT: 'CASQUETTE',
  POSE: 'SALUT',
  SMOKE: 'CLASSIQUE',
  ARREST: 'TAMPON',
  HUD: 'TABLETTE',
  GETAWAY: 'STANDARD',
  FUGITIVE: 'ROUGE',
};

export function cosmeticsIn(slot: CosmeticSlot): Cosmetic[] {
  return COSMETICS.filter((c) => c.slot === slot);
}

export function cosmetic(slot: CosmeticSlot, id: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.slot === slot && c.id === id);
}

export function isCosmeticUnlocked(ctx: CosmeticContext, slot: CosmeticSlot, id: string, all = false): boolean {
  const item = cosmetic(slot, id);
  return item !== undefined && (all || item.unlocked(ctx));
}

/** How many of the garage's items are earned, and how many there are. */
export function unlockedCount(ctx: CosmeticContext): { have: number; total: number } {
  return { have: COSMETICS.filter((c) => c.unlocked(ctx)).length, total: COSMETICS.length };
}

/**
 * What is worn in each slot: the saved choice when it exists and is earned
 * (a choice can be lost by starting a new campaign), else the free default.
 * `all` (testing) treats everything as earned.
 */
export function equippedLook(ctx: CosmeticContext, all = false): Record<CosmeticSlot, string> {
  const look = { ...DEFAULT_LOOK };
  for (const slot of COSMETIC_SLOTS) {
    const chosen = ctx.profile.look[slot] ?? (slot === 'LIVERY' ? ctx.progress.livery : undefined);
    if (chosen && isCosmeticUnlocked(ctx, slot, chosen, all)) look[slot] = chosen;
  }
  return look;
}

/** The colours of a livery id (the campaign's or the garage's). */
export function liveryLook(id: string): LiveryLook {
  const extra = EXTRA_LIVERIES.find((l) => l.id === id);
  if (extra) return { id: extra.id, body: extra.body, stripe: extra.stripe, uniform: extra.uniform, ...(extra.pattern ? { pattern: extra.pattern } : {}) };
  const campaign = CAMPAIGN_LIVERIES.find((l) => l.id === id) ?? CAMPAIGN_LIVERIES[0]!;
  return { id: campaign.id, body: campaign.body, stripe: campaign.stripe, uniform: campaign.uniform };
}

/** Everything newly earned between two moments, for the results screen. */
export function newlyEarned(before: CosmeticContext, after: CosmeticContext): Cosmetic[] {
  return COSMETICS.filter((c) => !c.unlocked(before) && c.unlocked(after));
}

/**
 * The locked item the player is closest to earning (by share of its count),
 * for "Next reward" on the results screen; null when everything counted is earned.
 */
export function nextReward(ctx: CosmeticContext): { item: Cosmetic; progress: UnlockProgress } | null {
  let best: { item: Cosmetic; progress: UnlockProgress } | null = null;
  for (const item of COSMETICS) {
    if (!item.progress || item.unlocked(ctx)) continue;
    const progress = item.progress(ctx);
    if (progress.need <= 0) continue;
    const share = progress.have / progress.need;
    const bestShare = best ? best.progress.have / best.progress.need : -1;
    if (share > bestShare || (share === bestShare && best && progress.need - progress.have < best.progress.need - best.progress.have)) {
      best = { item, progress };
    }
  }
  return best;
}
