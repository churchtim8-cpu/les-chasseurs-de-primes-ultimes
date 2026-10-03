import Phaser from 'phaser';
import type { TownGraph } from '../../engine/world/graph';
import type { MapLocation, Rect } from '../../engine/world/types';
import { SHADOW, type G } from './art';

/**
 * The town's buildings as straight-down pictures made in Canva. Each picture
 * sits flat inside its footprint from the map data (the map still defines
 * every road and path), and the French labels stay on top. `?look=drawn`
 * brings back the older code-drawn buildings.
 */

/** Which edge of a building faces the street, from the side nearest its entrance. */
type Side = 'bottom' | 'top' | 'left' | 'right';

/**
 * Location id → picture. Every picture was made with its front along the
 * bottom edge; buildings that face left or right were made in the swapped
 * shape and are turned a quarter turn to fit.
 */
const LANDMARK_PICTURES: Record<string, string> = {
  BAKERY: 'bakery.jpg',
  BANK: 'bank.jpg',
  BOOKSHOP: 'bookshop.jpg',
  BUS_STATION: 'bus-station.jpg',
  CAFE: 'cafe.jpg',
  CAR_PARK: 'car-park.jpg',
  CINEMA: 'cinema.jpg',
  GAS_STATION: 'gas-station.jpg',
  HOSPITAL: 'hospital.jpg',
  HOTEL: 'hotel.jpg',
  LIBRARY: 'library.jpg',
  MARKET: 'market.jpg',
  MUSEUM: 'museum.jpg',
  PARK: 'park.jpg',
  PHARMACY: 'pharmacy.jpg',
  POLICE_STATION: 'police-station.jpg',
  POST_OFFICE: 'post-office.jpg',
  RESTAURANT: 'restaurant.jpg',
  SCHOOL: 'school.jpg',
  SHOP: 'shop.jpg',
  SHOPPING_CENTRE: 'shopping-centre.jpg',
  SQUARE: 'square.jpg',
  STADIUM: 'stadium.jpg',
  SUPERMARKET: 'supermarket.jpg',
  SWIMMING_POOL: 'swimming-pool.jpg',
  THEATRE: 'theatre.jpg',
  TOWN_HALL: 'town-hall.jpg',
  TRAIN_STATION: 'train-station.jpg',
};

/** Pictures that look the same from every side, so they are never turned. */
const SYMMETRIC = new Set(['PARK', 'SQUARE', 'STADIUM', 'TOWN_HALL']);

/** Five roofs, reused in different arrangements so the streets feel varied but belong together. */
const HOUSE_PICTURES = ['house.jpg', 'house-red.jpg', 'house-slate.jpg', 'house-green.jpg', 'house-skylight.jpg'];

/** Gentle colour washes so two houses with the same roof still differ a little. */
const HOUSE_TINTS = [0xffffff, 0xfff1e6, 0xf2e6e0, 0xffe9d6, 0xe9e2dc];

const ROTATION: Record<Side, number> = { bottom: 0, top: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

const key = (file: string): string => `canva-${file}`;

export function canvaLookOn(): boolean {
  return new URLSearchParams(window.location.search).get('look') !== 'drawn';
}

/**
 * Top-down cartoon car and van, drawn white so code can colour them: the
 * suspect's colour, the police livery, or traffic.
 */
export const CAR_PICTURES = { CAR: 'canva-car', VAN: 'canva-van' } as const;

export function preloadCanvaArt(scene: Phaser.Scene): void {
  if (!canvaLookOn()) return;
  for (const file of [...Object.values(LANDMARK_PICTURES), ...HOUSE_PICTURES]) {
    if (!scene.textures.exists(key(file))) scene.load.image(key(file), `${import.meta.env.BASE_URL}images/canva/${file}`);
  }
  for (const [file, texture] of [['car.png', CAR_PICTURES.CAR], ['van.png', CAR_PICTURES.VAN]] as const) {
    if (!scene.textures.exists(texture)) scene.load.image(texture, `${import.meta.env.BASE_URL}images/cars/${file}`);
  }
}

export function hasLandmarkPicture(locationId: string): boolean {
  return canvaLookOn() && locationId in LANDMARK_PICTURES;
}

/** The same soft late-afternoon shadow the drawn buildings cast. */
export function pictureShadow(g: G, r: Rect): void {
  const cast = Math.min(8, Math.max(r.w, r.h) * 0.12);
  g.fillStyle(SHADOW, 0.08).fillRect(r.x + cast * 1.15, r.y + cast * 0.65, r.w, r.h);
  g.fillStyle(SHADOW, 0.13).fillRect(r.x + cast, r.y + cast * 0.55, r.w, r.h);
}

/** A small whole-number hash, so each house's arrangement is fixed but looks random. */
export function hash(i: number, salt: number): number {
  let h = (i + 1) * 374761393 + salt * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return Math.abs(h ^ (h >>> 16));
}

export interface RoofPiece {
  rect: Rect;
  file: string;
  /** Quarter turns. */
  turns: number;
  flipX: boolean;
  tint: number;
}

/**
 * How one house plot is filled: a single roof (most plots), a pair of
 * semi-detached roofs, or a smaller roof set back in its garden.
 */
export function houseLayout(i: number, r: Rect): RoofPiece[] {
  const roof = (n: number) => HOUSE_PICTURES[n % HOUSE_PICTURES.length] as string;
  const piece = (rect: Rect, n: number, salt: number): RoofPiece => ({
    rect,
    file: roof(n),
    turns: hash(i, salt) % 4,
    flipX: hash(i, salt + 1) % 2 === 1,
    tint: HOUSE_TINTS[hash(i, salt + 2) % HOUSE_TINTS.length] as number,
  });
  // Stepping by 3 through five roofs keeps side-by-side plots different.
  const base = i * 3 + (hash(i, 1) % 2);
  const pick = hash(i, 2) % 10;
  if (pick < 2) {
    // Semi-detached pair along the plot's longer side, with a thin gap between.
    const gap = 1.5;
    if (r.w >= r.h) {
      const w = (r.w - gap) / 2;
      return [
        piece({ x: r.x, y: r.y, w, h: r.h }, base, 10),
        piece({ x: r.x + w + gap, y: r.y, w, h: r.h }, base + 2, 20),
      ];
    }
    const h = (r.h - gap) / 2;
    return [
      piece({ x: r.x, y: r.y, w: r.w, h }, base, 10),
      piece({ x: r.x, y: r.y + h + gap, w: r.w, h }, base + 2, 20),
    ];
  }
  if (pick < 4) {
    // A smaller house in one corner of its plot, leaving a garden.
    const s = 0.74;
    const w = r.w * s;
    const h = r.h * s;
    const corner = hash(i, 3) % 4;
    const x = corner % 2 === 0 ? r.x : r.x + r.w - w;
    const y = corner < 2 ? r.y : r.y + r.h - h;
    return [piece({ x, y, w, h }, base, 30)];
  }
  return [piece(r, base, 40)];
}

/** Which side of a building faces its street, worked out from its first entrance. */
function frontSide(graph: TownGraph, loc: MapLocation): Side {
  const entrance = loc.entrances[0];
  if (!entrance) return 'bottom';
  const edge = graph.map.edges.find((e) => e.id === entrance.edgeId);
  const from = edge && graph.map.nodes.find((n) => n.id === edge.from);
  const to = edge && graph.map.nodes.find((n) => n.id === edge.to);
  if (!from || !to) return 'bottom';
  const px = from.x + (to.x - from.x) * entrance.t;
  const py = from.y + (to.y - from.y) * entrance.t;
  const r = loc.footprint;
  const gaps: [Side, number][] = [
    ['bottom', Math.abs(py - (r.y + r.h))],
    ['top', Math.abs(py - r.y)],
    ['left', Math.abs(px - r.x)],
    ['right', Math.abs(px - (r.x + r.w))],
  ];
  return gaps.sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'bottom';
}

function placePicture(scene: Phaser.Scene, file: string, r: Rect, rotation: number): Phaser.GameObjects.Image {
  // A quarter turn swaps the picture's width and height.
  const sideways = Math.abs(Math.sin(rotation)) > 0.5;
  return scene.add
    .image(r.x + r.w / 2, r.y + r.h / 2, key(file))
    .setDisplaySize(sideways ? r.h : r.w, sideways ? r.w : r.h)
    .setRotation(rotation)
    .setDepth(0.3);
}

/** Lays the pictures on the town, above the drawn ground and below people, cars and labels. */
export function placeCanvaArt(scene: Phaser.Scene, graph: TownGraph): void {
  for (const loc of graph.map.locations) {
    const file = LANDMARK_PICTURES[loc.id];
    if (!file) continue;
    placePicture(scene, file, loc.footprint, SYMMETRIC.has(loc.id) ? 0 : ROTATION[frontSide(graph, loc)]);
  }
  graph.map.fillers.forEach((f, i) => {
    for (const p of houseLayout(i, f.footprint)) {
      placePicture(scene, p.file, p.rect, (p.turns * Math.PI) / 2)
        .setFlipX(p.flipX)
        .setTint(p.tint);
    }
  });
}
