import Phaser from 'phaser';
import type { Rect } from '../../engine/world/types';
import { SHADOW, type G } from './art';

/**
 * TEST ONLY: top-down building pictures made in Canva, to compare with the
 * code-drawn town. Turned on with `?look=canva` in the address; without it the
 * town looks exactly as before. The pictures sit flat inside each building's
 * footprint, and the French labels stay on top of them.
 */

/** Location id → picture file, for the landmarks that have a Canva picture. */
const LANDMARK_PICTURES: Record<string, string> = {
  CAFE: 'cafe.jpg',
  TOWN_HALL: 'town-hall.jpg',
};
/** Five different roofs, mixed along the streets so neighbours rarely match. */
const HOUSE_PICTURES = ['house.jpg', 'house-red.jpg', 'house-slate.jpg', 'house-green.jpg', 'house-skylight.jpg'];

/** A few gentle colour washes so two houses with the same roof still differ a little. */
const HOUSE_TINTS = [0xffffff, 0xfff1e6, 0xf2e6e0, 0xffe9d6, 0xe9e2dc];

const key = (file: string): string => `canva-${file}`;

export function canvaLookOn(): boolean {
  return new URLSearchParams(window.location.search).get('look') === 'canva';
}

export function preloadCanvaArt(scene: Phaser.Scene): void {
  if (!canvaLookOn()) return;
  for (const file of [...Object.values(LANDMARK_PICTURES), ...HOUSE_PICTURES]) {
    if (!scene.textures.exists(key(file))) scene.load.image(key(file), `${import.meta.env.BASE_URL}images/canva/${file}`);
  }
}

export function hasLandmarkPicture(locationId: string): boolean {
  return canvaLookOn() && locationId in LANDMARK_PICTURES;
}

/** The same soft late-afternoon shadow the drawn buildings cast. */
export function pictureShadow(g: G, r: Rect): void {
  const cast = 8;
  g.fillStyle(SHADOW, 0.08).fillRect(r.x + cast * 1.15, r.y + cast * 0.65, r.w, r.h);
  g.fillStyle(SHADOW, 0.13).fillRect(r.x + cast, r.y + cast * 0.55, r.w, r.h);
}

/** Lays the pictures on the town, just above the drawn ground and below people, cars and labels. */
export function placeCanvaArt(
  scene: Phaser.Scene,
  landmarks: { id: string; footprint: Rect }[],
  houses: Rect[],
): void {
  const place = (file: string, r: Rect) =>
    scene.add
      .image(r.x + r.w / 2, r.y + r.h / 2, key(file))
      .setDisplaySize(r.w, r.h)
      .setDepth(0.3);
  for (const loc of landmarks) {
    const file = LANDMARK_PICTURES[loc.id];
    if (file) place(file, loc.footprint);
  }
  houses.forEach((r, i) => {
    // Stepping by 3 through five roofs keeps side-by-side houses different.
    place(HOUSE_PICTURES[(i * 3) % HOUSE_PICTURES.length] as string, r)
      .setFlip(i % 2 === 1, i % 3 === 1)
      .setTint(HOUSE_TINTS[(i * 2) % HOUSE_TINTS.length] as number);
  });
}
