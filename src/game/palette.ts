// Bellevue City palette (blueprint section 4). Shared by title, map and HUD.
export const PALETTE = {
  cream: 0xf6ecd2,
  paleYellow: 0xf3e2a9,
  terracotta: 0xc8674a,
  softRed: 0xd98c75,
  lightBlue: 0x9fd0e6,
  roof: 0x5b4a42,
  road: 0x8c8580,
  green: 0x7fb069,
  sea: 0x2a8c9e,
  seaDeep: 0x1f6f8b,
  sand: 0xecd9a6,
  stone: 0xe4ddd0,
  ink: 0x21313a,
} as const;

export const toCss = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

export const FONT_FAMILY = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
