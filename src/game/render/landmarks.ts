import type { Rect } from '../../engine/world/types';
import {
  awning,
  building,
  cross,
  DARK,
  flag,
  flatRoof,
  type G,
  GLASS,
  PALETTE_ART as C,
  palm,
  parasol,
  parkedCar,
  plaque,
  shade,
  tree,
  WHITE,
} from './art';

/**
 * One look per vocabulary place (blueprint sections 4 and 5: "buildings
 * should be visually distinct enough for learners to recognise locations").
 * Each drawer stays inside the place's footprint from the map data; the
 * French name is added on top by the town renderer.
 */

/** Adds a short sign text (in metres) above the town graphics. */
export type SignText = (x: number, y: number, text: string, size: number, colour: number, bold?: boolean) => void;

type Drawer = (g: G, r: Rect, sign: SignText) => void;

const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;
const inset = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });

const CAR_COLOURS = [0x3c6fb4, 0xd64b3c, 0xf2f2f2, 0x2e2e2e, 0x3f9b5a, 0xe0b33f, 0x9a9a9a];

function columns(g: G, x: number, y: number, w: number, count: number, height: number): void {
  const gap = w / count;
  for (let i = 0; i < count; i++) {
    g.fillStyle(WHITE).fillRect(x + gap * i + gap / 2 - 1.5, y, 3, height);
    g.fillStyle(0x000000, 0.12).fillRect(x + gap * i + gap / 2 + 1.5, y, 1, height);
  }
}

function openBook(g: G, x: number, y: number, s: number, colour: number): void {
  g.fillStyle(WHITE).fillTriangle(x, y - s * 0.3, x - s, y - s * 0.5, x - s, y + s * 0.4);
  g.fillStyle(WHITE).fillTriangle(x, y - s * 0.3, x - s, y + s * 0.4, x, y + s * 0.5);
  g.fillStyle(shade(WHITE, -8)).fillTriangle(x, y - s * 0.3, x + s, y - s * 0.5, x + s, y + s * 0.4);
  g.fillStyle(shade(WHITE, -8)).fillTriangle(x, y - s * 0.3, x + s, y + s * 0.4, x, y + s * 0.5);
  g.lineStyle(0.8, colour).lineBetween(x, y - s * 0.3, x, y + s * 0.5);
}

function parkingBays(g: G, r: Rect, rows: number, seed: number): void {
  g.fillStyle(C.road).fillRect(r.x, r.y, r.w, r.h);
  g.lineStyle(0.8, WHITE, 0.85);
  const rowH = r.h / rows;
  let k = seed;
  for (let row = 0; row < rows; row++) {
    const y0 = r.y + row * rowH;
    const bay = 7;
    for (let x = r.x + 4; x <= r.x + r.w - 4; x += bay) {
      g.lineBetween(x, y0 + 2, x, y0 + rowH * 0.4);
      g.lineBetween(x, y0 + rowH - 2, x, y0 + rowH * 0.6);
      if (x + bay > r.x + r.w - 4) break;
      k = (k * 9301 + 49297) % 233280;
      if (k % 3 !== 0) parkedCar(g, x + bay / 2, y0 + rowH * 0.22, CAR_COLOURS[k % CAR_COLOURS.length] as number, true);
      k = (k * 9301 + 49297) % 233280;
      if (k % 3 === 0) parkedCar(g, x + bay / 2, y0 + rowH * 0.78, CAR_COLOURS[k % CAR_COLOURS.length] as number, true);
    }
  }
}

function bag(g: G, x: number, y: number, colour: number): void {
  g.fillStyle(colour).fillRect(x - 5, y - 2, 10, 8);
  g.lineStyle(1.2, colour).beginPath().arc(x, y - 2, 3, Math.PI, 0).strokePath();
}

function cutlery(g: G, x: number, y: number, colour: number): void {
  g.lineStyle(1.3, colour).lineBetween(x - 3, y - 6, x - 3, y + 6).lineBetween(x + 3, y - 1, x + 3, y + 6);
  g.lineStyle(0.8, colour).lineBetween(x - 4.5, y - 6, x - 4.5, y - 2).lineBetween(x - 1.5, y - 6, x - 1.5, y - 2);
  g.fillStyle(colour).fillEllipse(x + 3, y - 3, 3, 7);
}

function trolley(g: G, x: number, y: number, colour: number): void {
  g.lineStyle(1.3, colour).lineBetween(x - 7, y - 5, x - 5, y - 5).lineBetween(x - 5, y - 5, x - 3, y + 2).lineBetween(x - 3, y + 2, x + 5, y + 2);
  g.fillStyle(colour).fillTriangle(x - 4.4, y - 3, x + 6, y - 3, x + 4.6, y + 0.8).fillTriangle(x - 4.4, y - 3, x + 4.6, y + 0.8, x - 3.4, y + 0.8);
  g.fillCircle(x - 2, y + 4.5, 1.3).fillCircle(x + 4, y + 4.5, 1.3);
}

function trainFront(g: G, x: number, y: number, colour: number): void {
  g.fillStyle(colour).fillRoundedRect(x - 5, y - 6, 10, 11, 2.5);
  g.fillStyle(C.blue).fillRect(x - 3.5, y - 4.5, 7, 3.5);
  g.fillStyle(C.blue).fillCircle(x - 2.5, y + 2.2, 0.9).fillCircle(x + 2.5, y + 2.2, 0.9);
  g.lineStyle(1, colour).lineBetween(x - 3, y + 5, x - 5, y + 7.5).lineBetween(x + 3, y + 5, x + 5, y + 7.5);
}

function pump(g: G, x: number, y: number, colour: number): void {
  g.fillStyle(colour).fillRoundedRect(x - 4.5, y - 5.5, 7, 11, 1);
  g.fillStyle(C.red).fillRect(x - 3, y - 4, 4, 3);
  g.lineStyle(1.1, colour).lineBetween(x + 2.5, y - 3, x + 5, y - 1).lineBetween(x + 5, y - 1, x + 5, y + 4);
}

export const LANDMARKS: Record<string, Drawer> = {
  // ---- Town Centre ---------------------------------------------------
  TOWN_HALL: (g, r) => {
    const roof = building(g, r, { roof: C.slate, wall: C.stoneWarm, wallHeight: 10 });
    // Clock tower in the middle of the roof, and the French flag.
    const tx = cx(roof);
    const ty = cy(roof);
    g.fillStyle(C.stoneWarm).fillRect(tx - 11, ty - 11, 22, 22);
    g.fillStyle(shade(C.slate, -10)).fillTriangle(tx - 11, ty - 11, tx + 11, ty - 11, tx, ty);
    g.fillStyle(WHITE).fillCircle(tx, ty + 2, 6.5);
    g.lineStyle(1.2, DARK).strokeCircle(tx, ty + 2, 6.5).lineBetween(tx, ty + 2, tx, ty - 2.5).lineBetween(tx, ty + 2, tx + 3, ty + 2);
    flag(g, roof.x + 10, roof.y + 10, 10);
    columns(g, r.x + 20, r.y + r.h - 10, r.w - 40, 6, 9);
  },

  SQUARE: (g, r) => {
    // Paving pattern, a fountain in the middle, benches and corner trees.
    g.lineStyle(0.6, shade(C.stone, -12), 0.8);
    for (let x = r.x + 10; x < r.x + r.w; x += 10) g.lineBetween(x, r.y, x, r.y + r.h);
    for (let y = r.y + 10; y < r.y + r.h; y += 10) g.lineBetween(r.x, y, r.x + r.w, y);
    const fx = cx(r);
    const fy = cy(r);
    g.fillStyle(shade(C.stone, -20)).fillCircle(fx, fy, 19);
    g.fillStyle(0x5bb6cc).fillCircle(fx, fy, 16);
    g.fillStyle(0x9fd8e8).fillCircle(fx, fy, 9);
    g.fillStyle(C.stoneWarm).fillCircle(fx, fy, 4);
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      tree(g, fx + dx * (r.w / 2 - 18), fy + dy * (r.h / 2 - 18), 11);
      g.fillStyle(0x8a6a44).fillRect(fx + dx * 34 - 6, fy + dy * 34 - 1.5, 12, 3);
    }
  },

  BANK: (g, r, sign) => {
    const roof = building(g, r, { roof: 0x6a6f78, wall: C.stoneWarm, wallHeight: 9, roofKind: 'flat', windows: false });
    columns(g, r.x + 6, r.y + r.h - 9, r.w - 12, 6, 9);
    plaque(g, cx(roof), cy(roof), 10, C.gold);
    sign(cx(roof), cy(roof), '€', 13, DARK, true);
  },

  POST_OFFICE: (g, r) => {
    const roof = building(g, r, { roof: C.yellow, wallHeight: 8, roofKind: 'flat' });
    plaque(g, cx(roof), cy(roof), 11, C.blue);
    // Envelope.
    const x = cx(roof);
    const y = cy(roof);
    g.fillStyle(WHITE).fillRect(x - 6.5, y - 4.5, 13, 9);
    g.lineStyle(1.1, C.blue).lineBetween(x - 6.5, y - 4.5, x, y + 0.5).lineBetween(x, y + 0.5, x + 6.5, y - 4.5);
  },

  CAFE: (g, r) => {
    // Building at the back, café terrace with little tables at the front.
    const body: Rect = { x: r.x, y: r.y, w: r.w, h: r.h * 0.6 };
    building(g, body, { roof: C.terracotta, wallHeight: 6 });
    awning(g, body.x + 4, body.y + body.h - 1, body.w - 8, 5, 0x2f6e5a, WHITE);
    for (const [fx, fy] of [
      [0.2, 0.8],
      [0.5, 0.86],
      [0.8, 0.8],
    ] as const) {
      parasol(g, r.x + r.w * fx, r.y + r.h * fy, 6, 0x2f6e5a, WHITE);
    }
  },

  RESTAURANT: (g, r, sign) => {
    const body: Rect = { x: r.x, y: r.y, w: r.w, h: r.h * 0.68 };
    const roof = building(g, body, { roof: 0xa8473a, wallHeight: 7 });
    awning(g, body.x + 4, body.y + body.h - 1, body.w - 8, 5, C.red, WHITE);
    for (let i = 0; i < 4; i++) {
      const x = r.x + 14 + i * ((r.w - 28) / 3);
      const y = r.y + r.h - 9;
      g.fillStyle(WHITE).fillCircle(x, y, 3.2);
      g.fillStyle(C.red).fillCircle(x, y, 1.2);
    }
    plaque(g, cx(roof), cy(roof), 9, DARK);
    cutlery(g, cx(roof), cy(roof), WHITE);
  },

  // ---- Commercial ------------------------------------------------------
  SHOP: (g, r) => {
    const roof = building(g, r, { roof: 0xd9895b, wallHeight: 7 });
    awning(g, r.x + 5, r.y + r.h - 8, r.w - 10, 5, C.blue, WHITE);
    plaque(g, cx(roof), cy(roof), 10, C.blue);
    bag(g, cx(roof), cy(roof), WHITE);
  },

  SHOPPING_CENTRE: (g, r, sign) => {
    const roof = building(g, r, { roof: 0xe7d9c5, wall: 0x7ea9c0, wallHeight: 10, roofKind: 'flat' });
    // Glass atrium with skylight panes.
    const a: Rect = { x: roof.x + roof.w * 0.3, y: roof.y + 12, w: roof.w * 0.4, h: roof.h - 24 };
    g.fillStyle(GLASS).fillRect(a.x, a.y, a.w, a.h);
    g.lineStyle(0.8, WHITE, 0.9);
    for (let x = a.x + 6; x < a.x + a.w; x += 6) g.lineBetween(x, a.y, x, a.y + a.h);
    g.lineBetween(a.x, a.y + a.h / 2, a.x + a.w, a.y + a.h / 2);
    for (const [px, py] of [
      [0.12, 0.25],
      [0.12, 0.7],
      [0.88, 0.25],
      [0.88, 0.7],
    ] as const) {
      g.fillStyle(shade(0xe7d9c5, -20)).fillRect(roof.x + roof.w * px - 5, roof.y + roof.h * py - 4, 10, 8);
    }
    plaque(g, roof.x + roof.w * 0.15, cy(roof), 9, C.purple);
    bag(g, roof.x + roof.w * 0.15, cy(roof), WHITE);
  },

  MARKET: (g, r) => {
    // Rows of stalls under striped awnings, with crates of fruit and vegetables.
    g.fillStyle(C.stoneWarm).fillRect(r.x, r.y, r.w, r.h);
    const colours = [
      [C.red, WHITE],
      [C.green, WHITE],
      [C.yellow, 0xe08a3c],
      [C.blue, WHITE],
    ] as const;
    const rows = 3;
    const rowH = r.h / rows;
    let k = 0;
    for (let row = 0; row < rows; row++) {
      for (let x = r.x + 6; x + 26 <= r.x + r.w - 4; x += 32) {
        const [a, b] = colours[k++ % colours.length] as readonly [number, number];
        const y = r.y + row * rowH + 8;
        g.fillStyle(0x000000, 0.15).fillRect(x + 2, y + 3, 26, rowH - 18);
        awning(g, x, y, 26, rowH - 22, a, b);
        for (let i = 0; i < 4; i++) {
          const fruit = [0xe0463a, 0xf2a93b, 0x6fb24a, 0x8e4f9e][(i + k) % 4] as number;
          g.fillStyle(0x8a6a44).fillRect(x + 1 + i * 6.5, y + rowH - 19, 5.5, 4);
          g.fillStyle(fruit).fillCircle(x + 3.7 + i * 6.5, y + rowH - 17, 1.8);
        }
      }
    }
  },

  BAKERY: (g, r) => {
    const roof = building(g, r, { roof: 0xc98a4b, wallHeight: 7 });
    awning(g, r.x + 4, r.y + r.h - 8, r.w - 8, 5, 0x8a5a3c, 0xf3e2a9);
    plaque(g, cx(roof), cy(roof), 10, 0x8a5a3c);
    // Baguette.
    const x = cx(roof);
    const y = cy(roof);
    g.fillStyle(0xe9b46a).fillEllipse(x, y, 15, 4.6);
    g.lineStyle(0.9, 0xa8702f);
    for (const dx of [-4, 0, 4]) g.lineBetween(x + dx - 1.4, y + 1.4, x + dx + 1.4, y - 1.4);
  },

  BOOKSHOP: (g, r) => {
    const roof = building(g, r, { roof: 0x7a8f5c, wallHeight: 7 });
    awning(g, r.x + 4, r.y + r.h - 8, r.w - 8, 5, 0x2f5e3a, 0xf3e2a9);
    plaque(g, cx(roof), cy(roof), 10, 0x2f5e3a);
    openBook(g, cx(roof), cy(roof), 6, 0x2f5e3a);
  },

  PHARMACY: (g, r) => {
    const roof = building(g, r, { roof: 0xeae6dc, wallHeight: 7, roofKind: 'flat' });
    plaque(g, cx(roof), cy(roof), 12, C.green);
    cross(g, cx(roof), cy(roof), 14, WHITE);
  },

  SUPERMARKET: (g, r, sign) => {
    const body: Rect = { x: r.x, y: r.y, w: r.w, h: r.h - 4 };
    const roof = building(g, body, { roof: 0xdedad2, wall: C.red, wallHeight: 8, roofKind: 'flat' });
    g.fillStyle(C.red).fillRect(roof.x, roof.y + roof.h - 5, roof.w, 5);
    plaque(g, cx(roof), cy(roof) - 3, 10, C.red);
    trolley(g, cx(roof), cy(roof) - 3, WHITE);
  },

  // ---- Civic / Education -----------------------------------------------
  SCHOOL: (g, r) => {
    // Building along the north, playground with a court at the south.
    const body: Rect = { x: r.x, y: r.y, w: r.w, h: r.h * 0.55 };
    const roof = building(g, body, { roof: 0xd98c75, wallHeight: 7 });
    const yard: Rect = { x: r.x + 4, y: r.y + body.h + 3, w: r.w - 8, h: r.h - body.h - 6 };
    g.fillStyle(0xd7c7a6).fillRect(yard.x, yard.y, yard.w, yard.h);
    const court = inset(yard, 6);
    g.fillStyle(0x6fa4c9).fillRect(court.x, court.y, court.w * 0.55, court.h);
    g.lineStyle(1, WHITE).strokeRect(court.x + 2, court.y + 2, court.w * 0.55 - 4, court.h - 4);
    g.lineBetween(court.x + court.w * 0.275, court.y + 2, court.x + court.w * 0.275, court.y + court.h - 2);
    tree(g, yard.x + yard.w * 0.78, yard.y + yard.h * 0.5, 9);
    flag(g, roof.x + 8, roof.y + 8, 9);
    plaque(g, cx(roof), cy(roof), 9, C.blue);
    openBook(g, cx(roof), cy(roof), 5, C.blue);
  },

  LIBRARY: (g, r) => {
    const roof = building(g, r, { roof: 0x8f6b52, wall: C.stoneWarm, wallHeight: 10 });
    columns(g, r.x + 12, r.y + r.h - 10, r.w - 24, 7, 10);
    plaque(g, cx(roof), cy(roof), 11, 0x8f3f3a);
    openBook(g, cx(roof), cy(roof), 6.5, 0x8f3f3a);
  },

  MUSEUM: (g, r) => {
    const roof = building(g, r, { roof: 0xb7b0a2, wall: C.stoneWarm, wallHeight: 12, roofKind: 'flat', windows: false });
    // A dome over the main hall, and a columned portico at the front.
    const x = cx(roof);
    const y = cy(roof);
    g.fillStyle(0x000000, 0.15).fillCircle(x + 3, y + 4, 34);
    g.fillStyle(0x6c9a93).fillCircle(x, y, 34);
    g.fillStyle(0x86b5ad).fillCircle(x - 6, y - 7, 22);
    g.lineStyle(1, shade(0x6c9a93, -25), 0.7);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.lineBetween(x, y, x + Math.cos(a) * 34, y + Math.sin(a) * 34);
    }
    g.fillStyle(C.gold).fillCircle(x, y, 4);
    g.fillStyle(C.stoneWarm).fillTriangle(r.x + 30, r.y + r.h - 12, r.x + r.w - 30, r.y + r.h - 12, x, r.y + r.h - 24);
    columns(g, r.x + 30, r.y + r.h - 12, r.w - 60, 8, 12);
  },

  THEATRE: (g, r) => {
    const roof = building(g, r, { roof: 0x9c3b3b, wall: 0xe8d3a8, wallHeight: 10 });
    // Golden trim, marquee lights and the comedy and tragedy masks.
    g.lineStyle(2, C.gold).strokeRect(roof.x + 4, roof.y + 4, roof.w - 8, roof.h - 8);
    g.fillStyle(C.gold);
    for (let x = r.x + 8; x < r.x + r.w - 6; x += 7) g.fillCircle(x, r.y + r.h - 1, 1.3);
    const x = cx(roof);
    const y = cy(roof);
    plaque(g, x, y, 13, DARK);
    g.fillStyle(C.gold).fillCircle(x - 4, y - 1, 5.2);
    g.fillStyle(WHITE).fillCircle(x + 4, y + 1, 5.2);
    g.fillStyle(DARK).fillCircle(x - 5.8, y - 2.2, 0.9).fillCircle(x - 2.2, y - 2.2, 0.9);
    g.fillStyle(DARK).fillCircle(x + 2.2, y - 0.2, 0.9).fillCircle(x + 5.8, y - 0.2, 0.9);
  },

  HOSPITAL: (g, r, sign) => {
    const roof = building(g, r, { roof: 0xf0ede6, wall: 0xc9d6dc, wallHeight: 12, roofKind: 'flat' });
    // Big red cross, and the helipad.
    cross(g, roof.x + roof.w * 0.32, cy(roof), 34, C.red);
    const hx = roof.x + roof.w * 0.74;
    const hy = cy(roof);
    g.fillStyle(0x4f5b61).fillCircle(hx, hy, 22);
    g.lineStyle(1.6, C.yellow).strokeCircle(hx, hy, 18);
    sign(hx, hy, 'H', 22, WHITE, true);
  },

  POLICE_STATION: (g, r, sign) => {
    const body: Rect = { x: r.x, y: r.y, w: r.w, h: r.h * 0.72 };
    const roof = building(g, body, { roof: 0x2f4d7a, wall: 0xdad7cf, wallHeight: 9, roofKind: 'flat' });
    g.fillStyle(WHITE).fillRoundedRect(cx(roof) - 26, cy(roof) - 7, 52, 14, 3);
    sign(cx(roof), cy(roof), 'POLICE', 10, 0x2f4d7a, true);
    g.fillStyle(0x4aa3ff).fillCircle(roof.x + 9, roof.y + 9, 3);
    // Police cars parked in front.
    const lot: Rect = { x: r.x, y: r.y + body.h + 2, w: r.w, h: r.h - body.h - 2 };
    g.fillStyle(C.road).fillRect(lot.x, lot.y, lot.w, lot.h);
    for (let i = 0; i < 4; i++) {
      const x = lot.x + 18 + i * ((lot.w - 36) / 3);
      parkedCar(g, x, lot.y + lot.h / 2, WHITE, true);
      g.fillStyle(0x2f4d7a).fillRect(x - 1.2, lot.y + lot.h / 2 - 0.4, 2.4, 0.8);
    }
  },

  // ---- Transport -------------------------------------------------------
  TRAIN_STATION: (g, r, sign) => {
    // Platforms under a long glass canopy at the north, the station hall at the south.
    const hall: Rect = { x: r.x + r.w * 0.2, y: r.y + r.h * 0.5, w: r.w * 0.6, h: r.h * 0.5 };
    const shed: Rect = { x: r.x, y: r.y, w: r.w, h: r.h * 0.48 };
    g.fillStyle(C.stone).fillRect(shed.x, shed.y, shed.w, shed.h);
    g.fillStyle(0x000000, 0.12).fillRect(shed.x + 3, shed.y + 4, shed.w, shed.h);
    g.fillStyle(0xbfdbe6, 0.95).fillRect(shed.x, shed.y, shed.w, shed.h);
    g.lineStyle(1, WHITE, 0.95);
    for (let x = shed.x + 10; x < shed.x + shed.w; x += 10) g.lineBetween(x, shed.y, x, shed.y + shed.h);
    g.lineStyle(2.4, 0x6f8fa6).lineBetween(shed.x, shed.y + shed.h / 3, shed.x + shed.w, shed.y + shed.h / 3);
    g.lineBetween(shed.x, shed.y + (shed.h * 2) / 3, shed.x + shed.w, shed.y + (shed.h * 2) / 3);
    g.lineStyle(1.2, 0x6f8fa6).strokeRect(shed.x, shed.y, shed.w, shed.h);
    const roof = building(g, hall, { roof: 0x9b6b55, wall: C.stoneWarm, wallHeight: 12 });
    g.fillStyle(WHITE).fillCircle(cx(roof), cy(roof), 8);
    g.lineStyle(1.3, DARK).strokeCircle(cx(roof), cy(roof), 8);
    g.lineBetween(cx(roof), cy(roof), cx(roof), cy(roof) - 5).lineBetween(cx(roof), cy(roof), cx(roof) + 3.5, cy(roof));
    plaque(g, hall.x - 18, hall.y + hall.h / 2, 10, C.blue);
    trainFront(g, hall.x - 18, hall.y + hall.h / 2, WHITE);
  },

  BUS_STATION: (g, r) => {
    // Bus bays under a canopy, with buses parked at an angle.
    g.fillStyle(C.road).fillRect(r.x, r.y, r.w, r.h);
    const canopy: Rect = { x: r.x + 6, y: r.y + 6, w: r.w - 12, h: 18 };
    g.fillStyle(0x000000, 0.14).fillRect(canopy.x + 2, canopy.y + 3, canopy.w, canopy.h);
    flatRoof(g, canopy, 0x6f8fa6, false);
    g.lineStyle(1, WHITE, 0.9);
    for (let i = 0; i < 5; i++) {
      const x = r.x + 18 + i * 30;
      if (x + 10 > r.x + r.w) break;
      g.lineBetween(x - 8, r.y + 28, x + 8, r.y + r.h - 8);
      const bx = x + 8;
      const by = r.y + 62;
      g.fillStyle(0x000000, 0.18).fillRoundedRect(bx - 3.5 + 1, by - 13 + 1.5, 7, 26, 1.5);
      g.fillStyle(i % 2 === 0 ? C.yellow : 0x3fa37a).fillRoundedRect(bx - 3.5, by - 13, 7, 26, 1.5);
      g.fillStyle(WHITE, 0.85).fillRect(bx - 2.5, by - 11, 5, 3);
    }
  },

  GAS_STATION: (g, r, sign) => {
    g.fillStyle(C.road).fillRect(r.x, r.y, r.w, r.h);
    // Shop at the back, canopy over two pump islands, and the price pole.
    building(g, { x: r.x + 6, y: r.y + 6, w: r.w * 0.45, h: 36 }, { roof: 0xe8e2d6, wall: C.red, wallHeight: 6, roofKind: 'flat' });
    const canopy: Rect = { x: r.x + 18, y: r.y + 56, w: r.w - 36, h: 46 };
    g.fillStyle(0x000000, 0.16).fillRect(canopy.x + 4, canopy.y + 5, canopy.w, canopy.h);
    g.fillStyle(WHITE).fillRect(canopy.x, canopy.y, canopy.w, canopy.h);
    g.fillStyle(C.red).fillRect(canopy.x, canopy.y, canopy.w, 4).fillRect(canopy.x, canopy.y + canopy.h - 4, canopy.w, 4);
    for (const fx of [0.3, 0.7]) {
      g.fillStyle(shade(WHITE, -15)).fillRect(canopy.x + canopy.w * fx - 4, canopy.y + 10, 8, canopy.h - 20);
    }
    plaque(g, r.x + r.w - 14, r.y + 18, 9, C.red);
    pump(g, r.x + r.w - 14, r.y + 18, WHITE);
  },

  CAR_PARK: (g, r, sign) => {
    parkingBays(g, inset(r, 3), 2, 7);
    plaque(g, r.x + r.w - 14, r.y + 14, 10, C.blue);
    sign(r.x + r.w - 14, r.y + 14, 'P', 13, WHITE, true);
  },

  BUS_STOP: (g, r, sign) => {
    // A glass shelter and the bus stop sign.
    g.fillStyle(0x000000, 0.16).fillRect(r.x + 2, r.y + 2, r.w * 0.6, r.h);
    g.fillStyle(0x6f8fa6).fillRect(r.x, r.y, r.w * 0.6, r.h);
    g.fillStyle(GLASS, 0.9).fillRect(r.x + 1.5, r.y + 1.5, r.w * 0.6 - 3, r.h - 3);
    plaque(g, r.x + r.w - 8, r.y + r.h / 2, 6, C.blue);
    sign(r.x + r.w - 8, r.y + r.h / 2, 'BUS', 4, WHITE, true);
  },

  // ---- Recreation / Coastal ---------------------------------------------
  PARK: (g, r) => {
    // Flower beds and trees between the footpaths (the pond is a map region).
    const beds = [
      [0.22, 0.2, 0xe86a8a],
      [0.78, 0.36, 0xf2c94c],
      [0.25, 0.62, 0xb07ad6],
      [0.75, 0.8, 0xe86a8a],
    ] as const;
    for (const [fx, fy, colour] of beds) {
      const x = r.x + r.w * fx;
      const y = r.y + r.h * fy;
      g.fillStyle(0x5a8f3e).fillEllipse(x, y, 30, 16);
      g.fillStyle(colour);
      for (let i = 0; i < 7; i++) g.fillCircle(x - 10 + i * 3.4, y + ((i % 2) * 2 - 1) * 2.5, 1.6);
    }
    const trees = [
      [0.12, 0.06],
      [0.45, 0.1],
      [0.88, 0.1],
      [0.1, 0.35],
      [0.9, 0.55],
      [0.12, 0.85],
      [0.45, 0.94],
      [0.88, 0.94],
      [0.62, 0.45],
      [0.38, 0.75],
    ] as const;
    for (const [fx, fy] of trees) tree(g, r.x + r.w * fx, r.y + r.h * fy, 10);
  },

  STADIUM: (g, r) => {
    // Stands round a pitch, with floodlights at the corners.
    g.fillStyle(0x000000, 0.16).fillRoundedRect(r.x + 6, r.y + 8, r.w, r.h, 40);
    g.fillStyle(0xbfc4c8).fillRoundedRect(r.x, r.y, r.w, r.h, 40);
    g.fillStyle(0x9aa1a8).fillRoundedRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16, 34);
    g.lineStyle(1, 0xd64b3c, 0.5);
    for (let d = 12; d < 26; d += 4) g.strokeRoundedRect(r.x + d, r.y + d, r.w - 2 * d, r.h - 2 * d, 34 - d / 2);
    const pitch = inset(r, 28);
    for (let i = 0, y = pitch.y; y < pitch.y + pitch.h; i++, y += 16) {
      g.fillStyle(i % 2 === 0 ? 0x4f9a46 : 0x5aa651).fillRect(pitch.x, y, pitch.w, Math.min(16, pitch.y + pitch.h - y));
    }
    g.lineStyle(1.3, WHITE, 0.95).strokeRect(pitch.x + 4, pitch.y + 4, pitch.w - 8, pitch.h - 8);
    g.lineBetween(pitch.x + 4, cy(pitch), pitch.x + pitch.w - 4, cy(pitch));
    g.strokeCircle(cx(pitch), cy(pitch), 14);
    g.strokeRect(cx(pitch) - 22, pitch.y + 4, 44, 22).strokeRect(cx(pitch) - 22, pitch.y + pitch.h - 26, 44, 22);
    for (const [fx, fy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const x = r.x + 10 + fx * (r.w - 20);
      const y = r.y + 10 + fy * (r.h - 20);
      g.fillStyle(DARK).fillRect(x - 4, y - 2.5, 8, 5);
      g.fillStyle(0xfff4b8).fillRect(x - 3, y - 1.5, 6, 3);
    }
  },

  SWIMMING_POOL: (g, r) => {
    // Pool deck, a pool with lanes, and sun loungers.
    g.fillStyle(0xe9e1cf).fillRect(r.x, r.y, r.w, r.h);
    const pool: Rect = { x: r.x + 14, y: r.y + 14, w: r.w - 50, h: r.h - 28 };
    g.fillStyle(0x7fb4c2).fillRect(pool.x - 2, pool.y - 2, pool.w + 4, pool.h + 4);
    g.fillStyle(0x4fb7d6).fillRect(pool.x, pool.y, pool.w, pool.h);
    g.fillStyle(0x8fd6ea, 0.8).fillRect(pool.x, pool.y, pool.w, pool.h * 0.35);
    g.lineStyle(1, WHITE, 0.9);
    for (let y = pool.y + pool.h / 6; y < pool.y + pool.h - 2; y += pool.h / 6) g.lineBetween(pool.x + 2, y, pool.x + pool.w - 2, y);
    for (let i = 0; i < 5; i++) {
      const y = r.y + 16 + i * 15;
      g.fillStyle(WHITE).fillRect(r.x + r.w - 30, y, 14, 5);
      if (i % 2 === 0) parasol(g, r.x + r.w - 10, y + 2.5, 5, C.blue, WHITE);
    }
  },

  CINEMA: (g, r, sign) => {
    const roof = building(g, r, { roof: 0x4a3a5c, wall: 0x2e2438, wallHeight: 10, roofKind: 'flat' });
    // Film strip along the roof and marquee lights along the front.
    const strip: Rect = { x: roof.x + 16, y: cy(roof) - 9, w: roof.w - 32, h: 18 };
    g.fillStyle(DARK).fillRect(strip.x, strip.y, strip.w, strip.h);
    g.fillStyle(WHITE);
    for (let x = strip.x + 2; x < strip.x + strip.w - 2; x += 6) {
      g.fillRect(x, strip.y + 1.5, 3, 2.5).fillRect(x, strip.y + strip.h - 4, 3, 2.5);
    }
    for (let x = strip.x + 4; x < strip.x + strip.w - 12; x += 22) g.fillStyle(0xf2c94c, 0.85).fillRect(x, strip.y + 5.5, 16, 7);
    g.fillStyle(C.gold);
    for (let x = r.x + 8; x < r.x + r.w - 6; x += 7) g.fillCircle(x, r.y + r.h - 1, 1.3);
    sign(cx(roof), roof.y + 9, 'CINÉMA', 8, C.gold, true);
  },

  HOTEL: (g, r, sign) => {
    const roof = building(g, r, { roof: 0xe8d5b0, wall: 0xf0e4c8, wallHeight: 16, roofKind: 'flat' });
    // Balconies on the tall front, a rooftop terrace and the sign.
    g.fillStyle(shade(0xf0e4c8, -18));
    for (let x = r.x + 8; x < r.x + r.w - 10; x += 14) g.fillRect(x, r.y + r.h - 9, 10, 2);
    g.fillStyle(0x4fb7d6).fillRect(roof.x + roof.w - 46, roof.y + 10, 34, 18);
    g.lineStyle(1.2, WHITE).strokeRect(roof.x + roof.w - 46, roof.y + 10, 34, 18);
    parasol(g, roof.x + roof.w - 56, roof.y + 18, 5, C.red, WHITE);
    g.fillStyle(0x2f4d7a).fillRoundedRect(roof.x + 12, cy(roof) - 7, 50, 14, 3);
    sign(roof.x + 37, cy(roof), 'HÔTEL', 9, C.gold, true);
    for (let i = 0; i < 5; i++) g.fillStyle(C.gold).fillCircle(roof.x + 21 + i * 8, cy(roof) - 11, 1.6);
  },

  BEACH: (g, r) => {
    // Parasols and towels along the sand, a lifeguard tower and palms.
    const colours = [
      [C.red, WHITE],
      [C.blue, WHITE],
      [C.yellow, 0xe08a3c],
      [C.green, WHITE],
    ] as const;
    let k = 3;
    for (let x = r.x + 30; x < r.x + r.w - 20; x += 46) {
      k = (k * 37 + 11) % 97;
      const y = r.y + 34 + (k % 5) * 9;
      const [a, b] = colours[k % colours.length] as readonly [number, number];
      parasol(g, x, y, 7, a, b);
      g.fillStyle([0xe86a8a, 0x5bb6cc, 0xf2c94c, 0xffffff][k % 4] as number).fillRect(x + 8, y - 2, 4, 9);
    }
    const lx = r.x + r.w * 0.45;
    g.fillStyle(0x000000, 0.15).fillRect(lx + 2, r.y + 24, 10, 12);
    g.fillStyle(WHITE).fillRect(lx, r.y + 20, 10, 12);
    g.fillStyle(C.red).fillRect(lx, r.y + 20, 10, 4);
    for (let x = r.x + 60; x < r.x + r.w; x += 210) palm(g, x, r.y + 12, 9);
  },
};
