import Phaser from 'phaser';
import { FESTIVAL, FESTIVALS, festivalOn, type Festival } from '../../engine/world/festival';
import { HALF_WIDTH, PAVEMENT } from '../../engine/world/geometry';
import type { TownGraph } from '../../engine/world/graph';
import type { MapEdge } from '../../engine/world/types';
import { hash } from './canvaArt';
import { today } from '../profileStore';
import { bakeLayer } from './townRenderer';

/** The title-screen choice: follow the calendar, one festival always, or none. */
export type FestivalChoice = 'AUTO' | Festival | 'OFF';
const CHOICES: readonly FestivalChoice[] = ['AUTO', 'CARNIVAL', 'CHRISTMAS', 'OFF'];
const KEY = 'chasseurs.festival';
export const FESTIVAL_NAMES: Record<Festival, string> = { CARNIVAL: 'Carnival', CHRISTMAS: 'Christmas' };

/** `?fete=carnival|christmas|off|auto` in the address, else the choice remembered on this device. */
export function festivalChoice(): FestivalChoice {
  const asked = new URLSearchParams(window.location.search).get('fete')?.toUpperCase();
  if (asked && (CHOICES as readonly string[]).includes(asked)) return asked as FestivalChoice;
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved && (CHOICES as readonly string[]).includes(saved) ? (saved as FestivalChoice) : 'AUTO';
  } catch {
    return 'AUTO';
  }
}

export function cycleFestival(): FestivalChoice {
  const next = CHOICES[(CHOICES.indexOf(festivalChoice()) + 1) % CHOICES.length] as FestivalChoice;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Private windows can refuse storage; the choice then lasts this visit only.
  }
  return next;
}

/** The festival the town is dressed for today, from the choice and the calendar. */
export function currentFestival(): Festival | null {
  const choice = festivalChoice();
  if (choice === 'OFF') return null;
  if ((FESTIVALS as readonly string[]).includes(choice)) return choice as Festival;
  return festivalOn(today());
}

/** The title-screen button's words, e.g. "🎉 FESTIVAL: AUTO (CHRISTMAS)". */
export function festivalLabel(): string {
  const choice = festivalChoice();
  const now = currentFestival();
  const icon = now === 'CHRISTMAS' ? '🎄' : now === 'CARNIVAL' ? '🎭' : '🎉';
  const name = choice === 'AUTO' ? `AUTO${now ? ` (${FESTIVAL_NAMES[now].toUpperCase()})` : ''}` : choice === 'OFF' ? 'OFF' : FESTIVAL_NAMES[choice].toUpperCase();
  return `${icon} FESTIVAL: ${name}`;
}

/** Above the buildings' pictures, under the labels; bunting hangs over the cars. */
const DEPTH = { ground: 2, overhead: 32, glow: 24.7 };

/**
 * Bellevue en fête (Mr Henry, 2026-10-04), all drawn in code. Carnival:
 * bunting strung across the streets, confetti on the ground, feather fans and
 * steel pans in the park and square. Christmas: fairy lights along every road
 * (glowing at night) and decorated trees in the park and square.
 */
export function drawFestival(scene: Phaser.Scene, graph: TownGraph, festival: Festival | null, night: boolean): void {
  if (!festival) return;
  const { width, height } = graph.map;
  const ground = scene.add.graphics();
  if (festival === 'CARNIVAL') {
    const overhead = scene.add.graphics();
    roads(graph).forEach((e, i) => bunting(overhead, ground, graph, e, i));
    openSpaces(graph).forEach((r, i) => carnivalSquare(ground, r, i));
    corners(graph).forEach(([x, y], i) => featherFan(ground, x, y, 1, i));
    bakeLayer(scene, overhead, width, height, 'fete-over', { depth: DEPTH.overhead });
    overhead.destroy();
  } else {
    const glow = night ? scene.add.graphics() : null;
    roads(graph).forEach((e, i) => fairyLights(ground, glow, graph, e, i));
    openSpaces(graph).forEach((r, i) => christmasTrees(ground, glow, r, i));
    corners(graph).forEach(([x, y], i) => christmasTree(ground, glow, x, y, 0.6, i));
    if (glow) {
      bakeLayer(scene, glow, width, height, 'fete-glow', { depth: DEPTH.glow, blendMode: Phaser.BlendModes.ADD });
      glow.destroy();
    }
  }
  bakeLayer(scene, ground, width, height, 'fete-ground', { depth: DEPTH.ground });
  ground.destroy();
}

function roads(graph: TownGraph): MapEdge[] {
  return graph.map.edges.filter((e) => e.car && e.kind !== 'ROUNDABOUT_RING');
}

/** A pavement corner at some junctions (every `cornerEvery`th), just off the road, for a tree or a fan. */
function corners(graph: TownGraph): [number, number][] {
  const out: [number, number][] = [];
  graph.map.nodes.forEach((node, i) => {
    const edges = graph.edgesAt(node.id).filter((e) => e.car && e.kind !== 'ROUNDABOUT_RING');
    if (edges.length < 3 || hash(i, 900) % FESTIVAL.cornerEvery !== 0) return;
    const half = Math.max(...edges.map((e) => HALF_WIDTH[e.kind]));
    const side = hash(i, 901) % 4;
    const sx = side % 2 === 0 ? 1 : -1;
    const sy = side < 2 ? 1 : -1;
    const reach = half + PAVEMENT + 5;
    out.push([node.x + sx * reach, node.y + sy * reach]);
  });
  return out;
}

function openSpaces(graph: TownGraph) {
  return graph.map.locations.filter((l) => l.open).map((l) => l.footprint);
}

/** An edge's ends, direction and length, for laying things along it. */
function along(graph: TownGraph, e: MapEdge) {
  const a = graph.node(e.from);
  const b = graph.node(e.to);
  const length = graph.edgeLength(e);
  return { a, dx: (b.x - a.x) / length, dy: (b.y - a.y) / length, length, half: HALF_WIDTH[e.kind] };
}

/** Lines of little triangle flags across the street, with confetti scattered below. */
function bunting(over: Phaser.GameObjects.Graphics, ground: Phaser.GameObjects.Graphics, graph: TownGraph, e: MapEdge, index: number): void {
  const { a, dx, dy, length, half } = along(graph, e);
  const count = Math.floor(length / FESTIVAL.buntingSpacing);
  const colours = FESTIVAL.carnivalColours;
  for (let k = 1; k <= count; k++) {
    const t = (length * k) / (count + 1);
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    const reach = half + PAVEMENT * 0.6;
    const x1 = cx - dy * reach;
    const y1 = cy + dx * reach;
    const x2 = cx + dy * reach;
    const y2 = cy - dx * reach;
    over.lineStyle(0.6, 0x3a2a1a, 0.9).lineBetween(x1, y1, x2, y2);
    const flags = Math.floor((reach * 2) / 3);
    for (let f = 0; f <= flags; f++) {
      const u = f / flags;
      const fx = x1 + (x2 - x1) * u;
      const fy = y1 + (y2 - y1) * u;
      const colour = colours[(f + index + k) % colours.length] as number;
      // Each flag hangs a little way along the road from the string.
      over.fillStyle(colour, 1).fillTriangle(fx - dy * 1.3, fy + dx * 1.3, fx + dy * 1.3, fy - dx * 1.3, fx + dx * 2.8, fy + dy * 2.8);
    }
    // Confetti on the road and pavements around the bunting.
    for (let c = 0; c < 40; c++) {
      const h1 = hash(index * 97 + k, c);
      const h2 = hash(index * 89 + k, c + 50);
      const sx = cx + dx * (((h1 % 1000) / 1000 - 0.5) * 30) - dy * (((h2 % 1000) / 1000 - 0.5) * 2 * (half + PAVEMENT));
      const sy = cy + dy * (((h1 % 1000) / 1000 - 0.5) * 30) + dx * (((h2 % 1000) / 1000 - 0.5) * 2 * (half + PAVEMENT));
      ground.fillStyle(colours[(h1 >> 4) % colours.length] as number, 0.95).fillRect(sx, sy, 1.2, 0.8);
    }
  }
}

/** In the park and square: big feather fans (Carnival costumes on stands) and a small steel band. */
function carnivalSquare(g: Phaser.GameObjects.Graphics, r: { x: number; y: number; w: number; h: number }, index: number): void {
  const colours = FESTIVAL.carnivalColours;
  // Away from the middle, where the paths cross under the place's name.
  const spots = [
    [0.25, 0.28],
    [0.74, 0.74],
    [0.26, 0.74],
  ];
  spots.forEach(([u, v], s) => {
    featherFan(g, r.x + r.w * (u as number), r.y + r.h * (v as number), 1.8, s + index);
  });
  // Steel pans: silver drums with their dented tops, in a little half circle.
  const px = r.x + r.w * 0.74;
  const py = r.y + r.h * 0.3;
  for (let p = 0; p < 5; p++) {
    const angle = Math.PI * (0.15 + 0.175 * p);
    const x = px + Math.cos(angle) * 7;
    const y = py - Math.sin(angle) * 7 + 3;
    g.fillStyle(0x000000, 0.2).fillCircle(x + 0.5, y + 0.7, 2.3);
    g.fillStyle(0xc9d1d6, 1).fillCircle(x, y, 2.2);
    g.lineStyle(0.35, 0x6b7780, 1).strokeCircle(x, y, 2.2).strokeCircle(x, y, 1.3);
    g.fillStyle(0xeef3f6, 1).fillCircle(x - 0.6, y - 0.5, 0.6);
  }
  // Confetti across the whole space.
  for (let c = 0; c < Math.floor((r.w * r.h) / 60); c++) {
    const h = hash(index * 131 + 7, c);
    const sx = r.x + ((h % 1000) / 1000) * r.w;
    const sy = r.y + (((h >> 10) % 1000) / 1000) * r.h;
    g.fillStyle(colours[(h >> 3) % colours.length] as number, 0.9).fillRect(sx, sy, 1.2, 0.8);
  }
}

/** A Carnival costume's feather fan, seen from above: a ring of bright feathers round a golden middle. */
function featherFan(g: Phaser.GameObjects.Graphics, x: number, y: number, scale: number, index: number): void {
  const colours = FESTIVAL.carnivalColours;
  const feathers = 16;
  g.fillStyle(0x000000, 0.2).fillCircle(x + 0.8 * scale, y + 1 * scale, 6 * scale);
  for (let f = 0; f < feathers; f++) {
    const angle = (f / feathers) * Math.PI * 2;
    const colour = colours[(f + index) % colours.length] as number;
    const fx = x + Math.cos(angle) * 3.6 * scale;
    const fy = y + Math.sin(angle) * 3.6 * scale;
    g.fillStyle(colour, 1).fillPoints(feather(fx, fy, angle, 5 * scale, 1.9 * scale), true);
  }
  g.fillStyle(0xffd60a, 1).fillCircle(x, y, 1.9 * scale);
  g.fillStyle(0xffffff, 0.9).fillCircle(x - 0.5 * scale, y - 0.5 * scale, 0.6 * scale);
}

/** One feather: a long leaf shape pointing outwards. */
function feather(x: number, y: number, angle: number, length: number, width: number): Phaser.Math.Vector2[] {
  const out: Phaser.Math.Vector2[] = [];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    const u = (Math.cos(t) * length) / 2;
    const v = (Math.sin(t) * width) / 2;
    out.push(new Phaser.Math.Vector2(x + u * cos - v * sin, y + u * sin + v * cos));
  }
  return out;
}

/** Coloured bulbs on a wire along both kerbs; at night each bulb glows. */
function fairyLights(g: Phaser.GameObjects.Graphics, glow: Phaser.GameObjects.Graphics | null, graph: TownGraph, e: MapEdge, index: number): void {
  const { a, dx, dy, length, half } = along(graph, e);
  const colours = FESTIVAL.christmasColours;
  const offset = half + PAVEMENT * 0.75;
  for (const side of [-1, 1]) {
    const ox = -dy * offset * side;
    const oy = dx * offset * side;
    const start = 6;
    const end = length - 6;
    if (end <= start) continue;
    g.lineStyle(0.4, 0x1d2a20, 0.8).lineBetween(a.x + dx * start + ox, a.y + dy * start + oy, a.x + dx * end + ox, a.y + dy * end + oy);
    let n = 0;
    for (let t = start; t <= end; t += FESTIVAL.bulbSpacing) {
      const x = a.x + dx * t + ox;
      const y = a.y + dy * t + oy;
      const colour = colours[(n + index + (side > 0 ? 2 : 0)) % colours.length] as number;
      g.fillStyle(colour, 1).fillCircle(x, y, 1);
      g.fillStyle(0xffffff, 0.7).fillCircle(x - 0.3, y - 0.3, 0.3);
      glow?.fillStyle(colour, 0.16).fillCircle(x, y, 2.6);
      glow?.fillStyle(colour, 0.5).fillCircle(x, y, 0.8);
      n++;
    }
  }
}

/** Decorated Christmas trees (seen from above: a star of branches, baubles and a gold star on top). */
function christmasTrees(g: Phaser.GameObjects.Graphics, glow: Phaser.GameObjects.Graphics | null, r: { x: number; y: number; w: number; h: number }, index: number): void {
  // Away from the middle, where the paths cross under the place's name.
  const spots = [
    [0.27, 0.3, 1.5],
    [0.73, 0.3, 1.2],
    [0.27, 0.72, 1.2],
    [0.73, 0.72, 1.5],
  ];
  spots.forEach(([u, v, scale], s) => christmasTree(g, glow, r.x + r.w * (u as number), r.y + r.h * (v as number), scale as number, index * 3 + s));
  // Gift boxes under the big tree.
  const gx = r.x + r.w * 0.27;
  const gy = r.y + r.h * 0.3 + 9;
  [
    [-2.2, 0, 0xe63946],
    [0.4, 0.6, 0x4cc9f0],
    [2.6, -0.2, 0xffd166],
  ].forEach(([ox, oy, colour]) => {
    const x = gx + (ox as number);
    const y = gy + (oy as number);
    g.fillStyle(colour as number, 1).fillRect(x - 1, y - 1, 2, 2);
    g.fillStyle(0xffffff, 0.9).fillRect(x - 0.15, y - 1, 0.3, 2).fillRect(x - 1, y - 0.15, 2, 0.3);
  });
}

/** One decorated Christmas tree seen from above: tiers of branches, baubles and a gold star on top. */
function christmasTree(g: Phaser.GameObjects.Graphics, glow: Phaser.GameObjects.Graphics | null, x: number, y: number, scale: number, index: number): void {
  const size = 9 * scale;
  g.fillStyle(0x000000, 0.22).fillEllipse(x + size * 0.25, y + size * 0.3, size * 2.1, size * 1.7);
  [
    [1, 0x1f6b3a, 0],
    [0.72, 0x2a8a48, 0.3],
    [0.45, 0x3aa65a, 0.6],
  ].forEach(([k, colour, turn]) => {
    g.fillStyle(colour as number, 1).fillPoints(star(x, y, size * (k as number), size * (k as number) * 0.62, 9, turn as number), true);
  });
  // A gold tinsel garland round the tree, so it stands out from ordinary trees.
  g.lineStyle(0.5 * Math.max(1, scale), 0xffd166, 1).strokeCircle(x, y, size * 0.62);
  g.lineStyle(0.4 * Math.max(1, scale), 0xe63946, 1).strokeCircle(x, y, size * 0.36);
  const colours = FESTIVAL.christmasColours;
  for (let b = 0; b < 11; b++) {
    const angle = (b / 11) * Math.PI * 2 + index;
    const reach = size * (0.35 + ((hash(index * 17, b) % 100) / 100) * 0.5);
    const bx = x + Math.cos(angle) * reach;
    const by = y + Math.sin(angle) * reach;
    const colour = colours[(b + index) % colours.length] as number;
    g.fillStyle(colour, 1).fillCircle(bx, by, 0.85 * Math.max(1, scale));
    glow?.fillStyle(colour, 0.2).fillCircle(bx, by, 1.8);
  }
  g.fillStyle(0xffd166, 1).fillPoints(star(x, y, 2 * Math.max(1, scale), 0.85 * Math.max(1, scale), 5, -Math.PI / 2), true);
  glow?.fillStyle(0xffd166, 0.25).fillCircle(x, y, 4);
}

function star(x: number, y: number, outer: number, inner: number, points: number, turn: number): Phaser.Math.Vector2[] {
  const out: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = turn + (i * Math.PI) / points;
    out.push(new Phaser.Math.Vector2(x + Math.cos(angle) * r, y + Math.sin(angle) * r));
  }
  return out;
}
