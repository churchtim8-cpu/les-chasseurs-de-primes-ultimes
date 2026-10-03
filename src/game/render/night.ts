import Phaser from 'phaser';
import type { TownGraph } from '../../engine/world/graph';
import { HALF_WIDTH, PAVEMENT } from '../../engine/world/geometry';
import type { Rect } from '../../engine/world/types';
import { hash, houseLayout } from './canvaArt';
import { bakeLayer, SURROUND } from './townRenderer';

/**
 * Night mode (drawing only: the chase is the same). The town is laid under a
 * deep blue dusk, street lamps throw small warm pools of light along every road
 * and at every junction, windows glow in the houses and the landmarks, and
 * every car drives with its headlights and tail lights on. The light is soft:
 * the lamps, windows and beams are added to what is beneath them, so they
 * look like a faint glow rather than painted shapes.
 */
export const NIGHT = {
  /** The dark blue of the night laid over the whole town. */
  sky: { colour: 0x0a1230, alpha: 0.6 },
  /**
   * Street lamps: metres between lamps along a road, and the small warm pool
   * of light each throws (radius in metres). Kept tight, about the size and
   * brightness of a lit window's glow, so the night stays dark and readable.
   */
  lamp: { spacing: 55, colour: 0xffc46a, radius: 6 },
  /** Lit windows: colour and size (metres); roughly this share of a house's windows are lit, fewer of a landmark's. */
  window: { colour: 0xffd98a, size: 2.4, litShare: 0.7, landmarkShare: 0.45, landmarkStep: 12 },
  /** Headlights: beam colour, how far it reaches ahead (metres) and how wide it spreads; short, soft beams. */
  headlight: { colour: 0xfff3c4, reach: 12, spread: 3.5 },
  tailLight: 0xff3b30,
  /** Above the town, its people and traffic shadows; below skid marks, smoke and the cars. */
  depth: { dark: 24.5, lights: 24.6 },
} as const;

const NIGHT_KEY = 'chasseurs.night';

/** Night mode: `?night=1` (or 0) in the address, else the choice remembered on this device. */
export function nightOn(): boolean {
  const asked = new URLSearchParams(window.location.search).get('night');
  if (asked === '1') return true;
  if (asked === '0') return false;
  try {
    return window.localStorage.getItem(NIGHT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNight(on: boolean): void {
  try {
    window.localStorage.setItem(NIGHT_KEY, on ? '1' : '0');
  } catch {
    // Private windows can refuse storage; night then lasts this visit only.
  }
}

/** Lays the night over a drawn town: the dark, the street lamps and the lit windows. */
export function drawNight(scene: Phaser.Scene, graph: TownGraph): void {
  const { width, height } = graph.map;
  scene.add
    .rectangle(-SURROUND, -SURROUND, width + 2 * SURROUND, height + 2 * SURROUND, NIGHT.sky.colour, NIGHT.sky.alpha)
    .setOrigin(0)
    .setDepth(NIGHT.depth.dark);
  const g = scene.add.graphics();
  streetLamps(g, graph);
  litWindows(g, graph);
  bakeLayer(scene, g, width, height, 'night', { depth: NIGHT.depth.lights, blendMode: Phaser.BlendModes.ADD });
}

/** A lamp at every junction and every `spacing` metres along a road, on alternate sides. */
function streetLamps(g: Phaser.GameObjects.Graphics, graph: TownGraph): void {
  const { spacing } = NIGHT.lamp;
  for (const node of graph.map.nodes) {
    if (graph.edgesAt(node.id).some((e) => e.car)) pool(g, node.x, node.y);
  }
  graph.map.edges.forEach((e, i) => {
    if (!e.car || e.kind === 'ROUNDABOUT_RING') return;
    const a = graph.node(e.from);
    const b = graph.node(e.to);
    const length = graph.edgeLength(e);
    const count = Math.floor(length / spacing);
    if (count === 0) return;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    const offset = HALF_WIDTH[e.kind] + PAVEMENT / 2;
    for (let k = 1; k <= count; k++) {
      const along = (length * k) / (count + 1);
      const side = (k + i) % 2 === 0 ? 1 : -1;
      pool(g, a.x + dx * along - dy * offset * side, a.y + dy * along + dx * offset * side);
    }
  });
}

/** One lamp: a warm pool of light fading outwards, with the bright bulb at its centre. */
function pool(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const { colour, radius } = NIGHT.lamp;
  g.fillStyle(colour, 0.08).fillCircle(x, y, radius);
  g.fillStyle(colour, 0.12).fillCircle(x, y, radius * 0.55);
  g.fillStyle(0xfff6dc, 0.9).fillCircle(x, y, 0.9);
}

/** Windows glowing in the houses (a few each) and along the sides of the landmarks. */
function litWindows(g: Phaser.GameObjects.Graphics, graph: TownGraph): void {
  const { size, litShare, landmarkShare, landmarkStep } = NIGHT.window;
  const lit = (i: number, salt: number, share: number = litShare) => hash(i, salt) % 100 < share * 100;
  graph.map.fillers.forEach((f, i) => {
    houseLayout(i, f.footprint).forEach((piece, j) => {
      const r = piece.rect;
      const inner = { x: r.x + 2, y: r.y + 2, w: Math.max(1, r.w - 4 - size), h: Math.max(1, r.h - 4 - size) };
      const windows = 2 + (hash(i, 60 + j) % 2);
      for (let k = 0; k < windows; k++) {
        if (!lit(i, 70 + j * 10 + k)) continue;
        const x = inner.x + (hash(i, 80 + j * 10 + k) % 1000) / 1000 * inner.w;
        const y = inner.y + (hash(i, 90 + j * 10 + k) % 1000) / 1000 * inner.h;
        litWindow(g, x, y);
      }
    });
  });
  graph.map.locations.forEach((loc, i) => {
    if (loc.open) return;
    perimeter(loc.footprint, landmarkStep, 2.6).forEach(([x, y], k) => {
      if (lit(i, 200 + k, landmarkShare)) litWindow(g, x, y);
    });
  });
}

function litWindow(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  const { colour, size } = NIGHT.window;
  g.fillStyle(colour, 0.08).fillCircle(x + size / 2, y + size / 2, size * 2.2);
  g.fillStyle(colour, 0.14).fillCircle(x + size / 2, y + size / 2, size * 1.3);
  g.fillStyle(colour, 0.85).fillRect(x, y, size, size);
}

/** Points every `step` metres just inside a rectangle's sides. */
function perimeter(r: Rect, step: number, inset: number): [number, number][] {
  const points: [number, number][] = [];
  const left = r.x + inset;
  const right = r.x + r.w - inset;
  const top = r.y + inset;
  const bottom = r.y + r.h - inset;
  for (let x = left + step / 2; x < right - 1; x += step) points.push([x, top], [x, bottom - NIGHT.window.size]);
  for (let y = top + step; y < bottom - step; y += step) points.push([left, y], [right - NIGHT.window.size, y]);
  return points;
}

/**
 * A car's lights at night: headlight beams ahead of it and red tail lights,
 * drawn for a car facing east that is `length` metres long, as children for
 * its container. Nothing by day.
 */
export function carLights(scene: Phaser.Scene, length: number): Phaser.GameObjects.GameObject[] {
  if (!nightOn()) return [];
  const g = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
  const nose = length / 2;
  const { colour, reach, spread } = NIGHT.headlight;
  for (const side of [-1, 1]) {
    const y = side * 3;
    // The beam fans out from each headlight, brighter close to the car.
    g.fillStyle(colour, 0.07).fillTriangle(nose, y, nose + reach, y - spread, nose + reach, y + spread);
    g.fillStyle(colour, 0.1).fillTriangle(nose, y, nose + reach * 0.5, y - spread * 0.55, nose + reach * 0.5, y + spread * 0.55);
    g.fillStyle(0xffffff, 0.9).fillCircle(nose - 0.6, y, 1);
    g.fillStyle(NIGHT.tailLight, 0.2).fillCircle(-nose + 0.4, y, 1.8);
    g.fillStyle(NIGHT.tailLight, 0.95).fillCircle(-nose + 0.8, y, 0.9);
  }
  return [g];
}
