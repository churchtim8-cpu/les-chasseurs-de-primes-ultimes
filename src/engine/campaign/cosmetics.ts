import { capturedCount, isLiveryUnlocked, LIVERIES as CAMPAIGN_LIVERIES, type CampaignProgress } from './campaign';
import { RANKS, rankFor, totalStars, type Profile, type RankId } from './profile';
import { medalAtLeast } from './scoring';

/**
 * The garage (Mr Henry, 2026-10-04): everything the player can change about
 * how their police look and celebrate, and how each choice is earned. Plain
 * data and rules only; the game draws them. Earned by arrests, stars, ranks,
 * badges and medals, never bought: there is no money in the game.
 */

export const COSMETIC_SLOTS = ['VEHICLE', 'LIVERY', 'OUTFIT', 'POSE', 'SMOKE', 'ARREST', 'HUD'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/** Slot names shown in the garage, in French. */
export const SLOT_NAMES: Record<CosmeticSlot, string> = {
  VEHICLE: 'Véhicule',
  LIVERY: 'Couleurs',
  OUTFIT: 'Agent',
  POSE: 'Victoire',
  SMOKE: 'Fumée',
  ARREST: 'Arrestation',
  HUD: 'Écran',
};

/** What the rules can look at. */
export interface CosmeticContext {
  progress: CampaignProgress;
  profile: Profile;
  /** 1-12: some looks are free in their season. */
  month: number;
}

export interface Cosmetic {
  slot: CosmeticSlot;
  id: string;
  /** Shown in the garage, in French. */
  name: string;
  /** How it is earned, in French ('' when free). */
  unlock: string;
  unlocked: (ctx: CosmeticContext) => boolean;
}

/** Police car and uniform colours; `pattern` is drawn over the body. */
export interface LiveryLook {
  id: string;
  body: number;
  stripe: number;
  uniform: number;
  pattern?: 'CARNIVAL' | 'FLAG' | 'NEON' | 'CAMO';
}

const free = () => true;
const rankAtLeast = (id: RankId) => (ctx: CosmeticContext) =>
  RANKS.findIndex((r) => r.id === rankFor(ctx.profile.points).id) >= RANKS.findIndex((r) => r.id === id);
const arrests = (n: number) => (ctx: CosmeticContext) => ctx.profile.arrests >= n;
const stars = (n: number) => (ctx: CosmeticContext) => totalStars(ctx.profile) >= n;
const rankName = (id: RankId) => RANKS.find((r) => r.id === id)!.name;

/** The garage's extra colours, after the campaign's six (see campaign.ts). */
export const EXTRA_LIVERIES: readonly (LiveryLook & { name: string; unlock: string; unlocked: Cosmetic['unlocked'] })[] = [
  // School house colours: free, so every house can drive its own.
  { id: 'MAISON_ROUGE', name: 'Maison rouge', body: 0xd23b30, stripe: 0xf7f7f2, uniform: 0x9c2a22, unlock: '', unlocked: free },
  { id: 'MAISON_BLEUE', name: 'Maison bleue', body: 0x2f6fd6, stripe: 0xf7f7f2, uniform: 0x1f4e9c, unlock: '', unlocked: free },
  { id: 'MAISON_VERTE', name: 'Maison verte', body: 0x2e9e5b, stripe: 0xf7f7f2, uniform: 0x1f6e40, unlock: '', unlocked: free },
  { id: 'MAISON_JAUNE', name: 'Maison jaune', body: 0xf2c230, stripe: 0x21313a, uniform: 0xb38a12, unlock: '', unlocked: free },
  { id: 'DRAPEAU', name: 'Drapeau', body: 0xd0212d, stripe: 0x111111, uniform: 0x111111, pattern: 'FLAG', unlock: '3 arrestations', unlocked: arrests(3) },
  { id: 'CARNAVAL', name: 'Carnaval', body: 0x7b2fbe, stripe: 0xf2c230, uniform: 0x5a1f8c, pattern: 'CARNIVAL', unlock: '10 étoiles', unlocked: stars(10) },
  { id: 'NEON', name: 'Néon', body: 0x1a1d29, stripe: 0x29f0ff, uniform: 0x1a1d29, pattern: 'NEON', unlock: '3 arrestations de nuit', unlocked: (ctx) => ctx.profile.nightArrests >= 3 },
  { id: 'CAMOUFLAGE', name: 'Camouflage', body: 0x5f6b3a, stripe: 0x2f3420, uniform: 0x4a5430, pattern: 'CAMO', unlock: `grade ${rankName('LIEUTENANT')}`, unlocked: rankAtLeast('LIEUTENANT') },
];

const campaignLiveries: Cosmetic[] = CAMPAIGN_LIVERIES.map((l) => ({
  slot: 'LIVERY',
  id: l.id,
  name: l.name,
  unlock: l.unlock,
  unlocked: (ctx) => isLiveryUnlocked(ctx.progress, l.id),
}));

export const COSMETICS: readonly Cosmetic[] = [
  // Vehicles: each drawn the same size as every other car in town (the motorbike smaller).
  { slot: 'VEHICLE', id: 'BERLINE', name: 'Berline de police', unlock: '', unlocked: free },
  { slot: 'VEHICLE', id: 'MOTO', name: 'Moto de police', unlock: `grade ${rankName('AGENT')}`, unlocked: rankAtLeast('AGENT') },
  { slot: 'VEHICLE', id: 'BANALISEE', name: 'Voiture banalisée', unlock: '5 arrestations', unlocked: arrests(5) },
  { slot: 'VEHICLE', id: 'VINTAGE', name: 'Classique des années 70', unlock: 'badge Sans faute', unlocked: (ctx) => ctx.profile.badges.SANS_FAUTE !== undefined },
  { slot: 'VEHICLE', id: 'GENDARMERIE', name: '4x4 de la gendarmerie', unlock: `grade ${rankName('BRIGADIER')}`, unlocked: rankAtLeast('BRIGADIER') },
  { slot: 'VEHICLE', id: 'PRESTIGE', name: 'Voiture du commissaire', unlock: `grade ${rankName('COMMISSAIRE')}`, unlocked: rankAtLeast('COMMISSAIRE') },

  ...campaignLiveries,
  ...EXTRA_LIVERIES.map((l): Cosmetic => ({ slot: 'LIVERY', id: l.id, name: l.name, unlock: l.unlock, unlocked: l.unlocked })),

  // The officer's look, seen on foot and in the garage.
  { slot: 'OUTFIT', id: 'CASQUETTE', name: 'Casquette', unlock: '', unlocked: free },
  { slot: 'OUTFIT', id: 'LUNETTES', name: 'Lunettes de soleil', unlock: '1 arrestation', unlocked: arrests(1) },
  { slot: 'OUTFIT', id: 'CASQUE', name: 'Casque de moto', unlock: `grade ${rankName('AGENT')}`, unlocked: rankAtLeast('AGENT') },
  { slot: 'OUTFIT', id: 'BERET', name: 'Béret', unlock: `grade ${rankName('BRIGADIER')}`, unlocked: rankAtLeast('BRIGADIER') },
  { slot: 'OUTFIT', id: 'CARNAVAL', name: 'Coiffe de Carnaval', unlock: '15 étoiles', unlocked: stars(15) },
  { slot: 'OUTFIT', id: 'NOEL', name: 'Bonnet de Noël', unlock: 'en décembre, ou 20 étoiles', unlocked: (ctx) => ctx.month === 12 || totalStars(ctx.profile) >= 20 },

  // What the officer does after an arrest.
  { slot: 'POSE', id: 'SALUT', name: 'Salut', unlock: '', unlocked: free },
  { slot: 'POSE', id: 'POING', name: 'Poing levé', unlock: 'badge Éclair', unlocked: (ctx) => ctx.profile.badges.ECLAIR !== undefined },
  { slot: 'POSE', id: 'DANSE', name: 'Petite danse', unlock: '24 étoiles', unlocked: stars(24) },

  // Tyre smoke and skid marks.
  { slot: 'SMOKE', id: 'CLASSIQUE', name: 'Classique', unlock: '', unlocked: free },
  { slot: 'SMOKE', id: 'BLEUE', name: 'Fumée bleue', unlock: `grade ${rankName('AGENT')}`, unlocked: rankAtLeast('AGENT') },
  { slot: 'SMOKE', id: 'ARC_EN_CIEL', name: 'Arc-en-ciel', unlock: '12 étoiles', unlocked: stars(12) },
  { slot: 'SMOKE', id: 'FLAMMES', name: 'Flammes dorées', unlock: `grade ${rankName('CAPITAINE')}`, unlocked: rankAtLeast('CAPITAINE') },

  // The effect when the suspect is caught.
  { slot: 'ARREST', id: 'TAMPON', name: 'Tampon « ARRÊTÉ ! »', unlock: '', unlocked: free },
  { slot: 'ARREST', id: 'CONFETTIS', name: 'Confettis', unlock: '2 arrestations', unlocked: arrests(2) },
  { slot: 'ARREST', id: 'ETINCELLES', name: 'Menottes étincelantes', unlock: 'badge Pied léger', unlocked: (ctx) => ctx.profile.badges.PIED_LEGER !== undefined },
  {
    slot: 'ARREST',
    id: 'TOUT',
    name: 'Les trois à la fois',
    unlock: `8 médailles d’or, ou grade ${rankName('CAPITAINE')}`,
    unlocked: (ctx) => ctx.progress.missions.every((m) => medalAtLeast(m?.medal ?? null, 'GOLD')) || rankAtLeast('CAPITAINE')(ctx),
  },

  // The chase screen's colours.
  { slot: 'HUD', id: 'TABLETTE', name: 'Tablette de police', unlock: '', unlocked: free },
  { slot: 'HUD', id: 'RETRO', name: 'Écran rétro', unlock: '4 suspects de la campagne arrêtés', unlocked: (ctx) => capturedCount(ctx.progress) >= 4 },
  { slot: 'HUD', id: 'CARNAVAL', name: 'Carnaval', unlock: '10 étoiles', unlocked: stars(10) },
  { slot: 'HUD', id: 'OR', name: 'Or', unlock: `grade ${rankName('COMMISSAIRE')}`, unlocked: rankAtLeast('COMMISSAIRE') },
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
  if (extra) return extra;
  const campaign = CAMPAIGN_LIVERIES.find((l) => l.id === id) ?? CAMPAIGN_LIVERIES[0]!;
  return { id: campaign.id, body: campaign.body, stripe: campaign.stripe, uniform: campaign.uniform };
}

/** Everything newly earned between two moments, for the results screen. */
export function newlyEarned(before: CosmeticContext, after: CosmeticContext): Cosmetic[] {
  return COSMETICS.filter((c) => !c.unlocked(before) && c.unlocked(after));
}
