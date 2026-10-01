import Phaser from 'phaser';
import type { Rect } from '../../engine/world/types';
import { PALETTE } from '../palette';

/**
 * Small drawing kit for the town art (blueprint section 4: a clean,
 * colourful, slightly 3D top-down coastal town). Everything is drawn in
 * metres onto one Graphics object, seen from slightly south: roofs from
 * above, with the south wall showing below them.
 */

export type G = Phaser.GameObjects.Graphics;

export const shade = (colour: number, percent: number): number =>
  percent >= 0
    ? Phaser.Display.Color.IntegerToColor(colour).lighten(percent).color
    : Phaser.Display.Color.IntegerToColor(colour).darken(-percent).color;

export const WHITE = 0xfbf7ee;
export const GLASS = 0x9fd0e6;
export const DARK = 0x2e3a40;
export const LEAF = 0x5f9e4f;

export interface BuildingStyle {
  roof: number;
  /** Front wall colour (defaults to the roof, darkened). */
  wall?: number;
  /** How much of the south wall shows, in metres: taller buildings show more. */
  wallHeight?: number;
  /** Gable (pitched, with a ridge) or flat roof with a parapet. */
  roofKind?: 'gable' | 'flat';
  windows?: boolean;
  door?: boolean;
}

/**
 * Draws a building on its footprint: shadow, south wall with windows and a
 * door, then the roof. Returns the roof rectangle so details can sit on it.
 */
export function building(g: G, r: Rect, style: BuildingStyle): Rect {
  const wallHeight = style.wallHeight ?? 6;
  const wall = style.wall ?? shade(style.roof, -30);
  const roof: Rect = { x: r.x, y: r.y, w: r.w, h: r.h - wallHeight };
  g.fillStyle(0x000000, 0.14).fillRect(r.x + wallHeight * 0.7, r.y + wallHeight * 0.9, r.w, r.h);
  g.fillStyle(wall).fillRect(r.x, roof.y + roof.h, r.w, wallHeight);
  if (style.windows !== false) {
    const glass = shade(GLASS, -10);
    const step = 9;
    const count = Math.max(1, Math.floor((r.w - 6) / step));
    const start = r.x + (r.w - count * step) / 2 + 2.5;
    for (let i = 0; i < count; i++) {
      g.fillStyle(glass, 0.9).fillRect(start + i * step, roof.y + roof.h + wallHeight * 0.3, 4, wallHeight * 0.45);
    }
  }
  if (style.door !== false) {
    g.fillStyle(shade(wall, -35)).fillRect(r.x + r.w / 2 - 3, roof.y + roof.h + wallHeight * 0.25, 6, wallHeight * 0.75);
  }
  if (style.roofKind === 'flat') flatRoof(g, roof, style.roof);
  else gableRoof(g, roof, style.roof);
  return roof;
}

/** Pitched roof: lit northern slope, shaded southern slope, ridge along the long side. */
export function gableRoof(g: G, r: Rect, colour: number): void {
  if (r.w >= r.h) {
    g.fillStyle(shade(colour, 8)).fillRect(r.x, r.y, r.w, r.h / 2);
    g.fillStyle(shade(colour, -12)).fillRect(r.x, r.y + r.h / 2, r.w, r.h / 2);
    g.lineStyle(1.2, shade(colour, -30), 0.9).lineBetween(r.x + 1, r.y + r.h / 2, r.x + r.w - 1, r.y + r.h / 2);
  } else {
    g.fillStyle(shade(colour, 8)).fillRect(r.x, r.y, r.w / 2, r.h);
    g.fillStyle(shade(colour, -12)).fillRect(r.x + r.w / 2, r.y, r.w / 2, r.h);
    g.lineStyle(1.2, shade(colour, -30), 0.9).lineBetween(r.x + r.w / 2, r.y + 1, r.x + r.w / 2, r.y + r.h - 1);
  }
  g.lineStyle(1, shade(colour, -35), 0.6).strokeRect(r.x, r.y, r.w, r.h);
}

/** Flat roof with a light parapet and a couple of roof boxes. */
export function flatRoof(g: G, r: Rect, colour: number, boxes = true): void {
  g.fillStyle(colour).fillRect(r.x, r.y, r.w, r.h);
  g.lineStyle(2, shade(colour, 18), 1).strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  g.lineStyle(1, shade(colour, -30), 0.6).strokeRect(r.x, r.y, r.w, r.h);
  if (boxes && r.w > 40 && r.h > 30) {
    g.fillStyle(shade(colour, -18)).fillRect(r.x + r.w - 16, r.y + 6, 9, 7);
    g.fillStyle(shade(colour, -18)).fillRect(r.x + 7, r.y + r.h - 14, 7, 6);
  }
}

/** Striped shop awning along the front (south) of a building, with a scalloped edge. */
export function awning(g: G, x: number, y: number, w: number, depth: number, a: number, b: number): void {
  const stripe = 4;
  for (let i = 0, sx = x; sx < x + w; i++, sx += stripe) {
    g.fillStyle(i % 2 === 0 ? a : b).fillRect(sx, y, Math.min(stripe, x + w - sx), depth);
  }
  for (let i = 0, sx = x + stripe / 2; sx < x + w; i++, sx += stripe) {
    g.fillStyle(i % 2 === 0 ? a : b).fillCircle(sx, y + depth, stripe / 2);
  }
}

/** Round plaque for an icon. */
export function plaque(g: G, x: number, y: number, radius: number, colour: number): void {
  g.fillStyle(0x000000, 0.18).fillCircle(x + 1.2, y + 1.6, radius);
  g.fillStyle(colour).fillCircle(x, y, radius);
  g.lineStyle(1.4, WHITE, 0.95).strokeCircle(x, y, radius - 1.2);
}

export function cross(g: G, x: number, y: number, size: number, colour: number): void {
  const t = size / 3;
  g.fillStyle(colour).fillRect(x - t / 2, y - size / 2, t, size).fillRect(x - size / 2, y - t / 2, size, t);
}

export function tree(g: G, x: number, y: number, radius: number, leaf: number = LEAF): void {
  g.fillStyle(0x000000, 0.16).fillEllipse(x + radius * 0.45, y + radius * 0.6, radius * 2.1, radius * 1.7);
  g.fillStyle(shade(leaf, -18)).fillCircle(x, y, radius);
  g.fillStyle(leaf).fillCircle(x - radius * 0.2, y - radius * 0.25, radius * 0.75);
  g.fillStyle(shade(leaf, 18)).fillCircle(x - radius * 0.35, y - radius * 0.4, radius * 0.35);
}

export function palm(g: G, x: number, y: number, radius: number): void {
  g.fillStyle(0x000000, 0.14).fillEllipse(x + radius * 0.5, y + radius * 0.7, radius * 1.8, radius * 1.2);
  const leaf = 0x4f9a52;
  g.lineStyle(radius * 0.32, leaf);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    g.lineBetween(x, y, x + Math.cos(a) * radius, y + Math.sin(a) * radius);
  }
  g.fillStyle(0x8a6a44).fillCircle(x, y, radius * 0.18);
}

/** Parked car seen from above, the same size as the cars driving through town. */
export function parkedCar(g: G, x: number, y: number, colour: number, vertical = false): void {
  const [w, h] = vertical ? [4.6, 8.8] : [8.8, 4.6];
  g.fillStyle(0x000000, 0.18).fillRect(x - w / 2 + 1, y - h / 2 + 1.4, w, h);
  g.fillStyle(colour).fillRoundedRect(x - w / 2, y - h / 2, w, h, 1.6);
  g.fillStyle(DARK, 0.55);
  if (vertical) g.fillRect(x - w / 2 + 0.8, y - h / 2 + 1.8, w - 1.6, 2.2).fillRect(x - w / 2 + 0.8, y + h / 2 - 2.8, w - 1.6, 1.4);
  else g.fillRect(x + w / 2 - 4, y - h / 2 + 0.8, 2.2, h - 1.6).fillRect(x - w / 2 + 1.4, y - h / 2 + 0.8, 1.4, h - 1.6);
}

/** Parasol from above: coloured segments around a white centre. */
export function parasol(g: G, x: number, y: number, radius: number, a: number, b: number): void {
  g.fillStyle(0x000000, 0.14).fillCircle(x + radius * 0.35, y + radius * 0.45, radius);
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    g.fillStyle(i % 2 === 0 ? a : b).fillTriangle(
      x,
      y,
      x + Math.cos(a0) * radius,
      y + Math.sin(a0) * radius,
      x + Math.cos(a1) * radius,
      y + Math.sin(a1) * radius,
    );
  }
  g.fillStyle(WHITE).fillCircle(x, y, radius * 0.15);
}

/** French flag on a short pole (seen from above, flying east). */
export function flag(g: G, x: number, y: number, size: number): void {
  g.fillStyle(DARK).fillCircle(x, y, 0.8);
  const w = size / 3;
  g.fillStyle(0x2c4f9e).fillRect(x, y - size / 3, w, (size * 2) / 3);
  g.fillStyle(WHITE).fillRect(x + w, y - size / 3, w, (size * 2) / 3);
  g.fillStyle(0xd63c3c).fillRect(x + 2 * w, y - size / 3, w, (size * 2) / 3);
}

export const PALETTE_ART = {
  ...PALETTE,
  stoneWarm: 0xe8dcc2,
  slate: 0x56677a,
  zinc: 0x7d8b98,
  gold: 0xe0b33f,
  red: 0xd64b3c,
  green: 0x3f9b5a,
  blue: 0x3c6fb4,
  purple: 0x6d4a8c,
  yellow: 0xf2c94c,
} as const;
