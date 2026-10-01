import Phaser from 'phaser';
import { HALF_WIDTH, PAVEMENT } from '../../engine/world/geometry';
import type { TownGraph } from '../../engine/world/graph';
import type { MapEdge } from '../../engine/world/types';
import { PALETTE } from '../palette';

/**
 * Life in Bellevue City: traffic, people out walking, waves, boats, the
 * fountain and seagulls. Pure decoration drawn on top of the baked town;
 * nothing here takes part in the chase.
 *
 * Traffic only ever uses colours the scanner never names (no blue, black,
 * white or green car, taxi or van), so a passing car can't be mistaken for
 * the suspect's, and it is drawn smaller than the suspect's car.
 */

/** Texture pixels per metre, so the sprites stay sharp when the camera zooms in. */
const RES = 4;

const TRAFFIC_COLOURS = [0xd64b3c, 0xe0863c, 0x7a2e3a, 0x8e5bb0, 0xd8c49a, 0xe58fa8];
const WALKER_COLOURS = [0xf2c94c, 0x5bb6cc, 0xe86a8a, 0x8e5bb0, 0xf29a4b, 0x6fb24a, 0xf4f1e8];

const TRAFFIC_COUNT = 16;
const WALKER_COUNT = 44;
const TRAFFIC_SPEED: [number, number] = [32, 44];
const WALKER_SPEED: [number, number] = [4, 7];

interface Traveller {
  sprite: Phaser.GameObjects.Image;
  edge: MapEdge;
  from: string;
  to: string;
  /** Metres travelled along the edge from `from`. */
  along: number;
  speed: number;
  /** Sideways offset from the centre line: the right-hand lane, or a pavement. */
  offset: number;
  car: boolean;
}

export interface TownLifeOptions {
  /** Where the player is, so traffic slows down instead of driving through them. */
  player: () => { x: number; y: number };
}

export class TownLife {
  /** Every object this creates, so the HUD camera can ignore them. */
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly travellers: Traveller[] = [];
  private readonly waves: Phaser.GameObjects.TileSprite[] = [];
  private readonly sails: Phaser.GameObjects.Image[] = [];
  private readonly gulls: { sprite: Phaser.GameObjects.Image; speed: number; baseY: number; phase: number }[] = [];
  private clock = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly graph: TownGraph,
    private readonly options: TownLifeOptions,
  ) {
    makeTextures(scene);
    this.addSea();
    this.addBoats();
    this.addFountain();
    this.addTravellers();
    this.addGulls();
  }

  update(deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000;
    this.clock += dt;
    const player = this.options.player();
    for (const t of this.travellers) this.move(t, dt, player);
    this.waves.forEach((w, i) => {
      w.tilePositionX += dt * (i === 0 ? 3 : -2) * RES;
      w.tilePositionY = Math.sin(this.clock * 0.8 + i) * 2 * RES;
    });
    const width = this.graph.map.width;
    for (const sail of this.sails) {
      sail.x += dt * 2.5;
      if (sail.x > width + 30) sail.x = -30;
    }
    for (const gull of this.gulls) {
      gull.sprite.x += dt * gull.speed;
      if (gull.sprite.x > width + 40) gull.sprite.x = -40;
      gull.sprite.y = gull.baseY + Math.sin(this.clock * 0.7 + gull.phase) * 14;
      gull.sprite.scaleY = (0.7 + 0.3 * Math.abs(Math.sin(this.clock * 5 + gull.phase))) / RES;
    }
  }

  private add<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.objects.push(object);
    return object;
  }

  private image(x: number, y: number, key: string, depth: number): Phaser.GameObjects.Image {
    return this.add(this.scene.add.image(x, y, key).setScale(1 / RES).setDepth(depth));
  }

  // ---- Sea ---------------------------------------------------------------

  private addSea(): void {
    const sea = this.graph.map.regions.find((r) => r.kind === 'SEA');
    if (!sea) return;
    const top = Math.min(...sea.points.map((p) => p[1]));
    const bottom = Math.max(...sea.points.map((p) => p[1]));
    const width = this.graph.map.width;
    for (const [i, alpha] of [0.75, 0.45].entries()) {
      const tile = this.scene.add
        .tileSprite(0, top + 6 + i * 14, width * RES, (bottom - top - 6 - i * 14) * RES, 'life-waves')
        .setOrigin(0)
        .setScale(1 / RES)
        .setAlpha(alpha)
        .setDepth(0.5);
      this.waves.push(this.add(tile));
    }
    // Foam where the waves meet the sand, gently washing in and out.
    const foam = this.add(this.scene.add.rectangle(0, top, width, 5, 0xffffff, 0.55).setOrigin(0, 0.5).setDepth(0.6));
    this.scene.tweens.add({ targets: foam, y: top - 4, alpha: 0.25, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private addBoats(): void {
    const moored = [
      [748, 432, 0],
      [776, 446, 1],
      [745, 600, 2],
      [775, 640, 3],
      [748, 860, 1],
      [774, 920, 0],
    ] as const;
    for (const [i, [x, y, kind]] of moored.entries()) {
      const boat = this.image(x, y, `life-boat-${kind}`, 0.7);
      this.scene.tweens.add({
        targets: boat,
        angle: { from: -4, to: 4 },
        y: { from: y - 0.8, to: y + 0.8 },
        duration: 1800 + i * 230,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    for (const [x, y] of [
      [380, 1245],
      [1300, 1270],
      [2050, 1240],
    ] as const) {
      const sail = this.image(x, y, 'life-sail', 0.8);
      this.scene.tweens.add({ targets: sail, angle: { from: -3, to: 3 }, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.sails.push(sail);
    }
  }

  private addFountain(): void {
    const square = this.graph.map.locations.find((l) => l.id === 'SQUARE');
    if (!square) return;
    const x = square.footprint.x + square.footprint.w / 2;
    const y = square.footprint.y + square.footprint.h / 2;
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const drop = this.add(this.scene.add.circle(x, y, 1.4, 0xffffff, 0.9).setDepth(0.9));
      this.scene.tweens.add({
        targets: drop,
        x: x + Math.cos(angle) * 13,
        y: y + Math.sin(angle) * 13,
        alpha: 0,
        scale: 0.5,
        duration: 1100,
        delay: i * 110,
        repeat: -1,
      });
    }
    const ring = this.add(this.scene.add.circle(x, y, 9, 0xffffff, 0).setStrokeStyle(1, 0xffffff, 0.7).setDepth(0.9));
    this.scene.tweens.add({ targets: ring, scale: 1.7, alpha: 0, duration: 1600, repeat: -1 });
  }

  private addGulls(): void {
    const width = this.graph.map.width;
    for (let i = 0; i < 6; i++) {
      const baseY = 1110 + (i % 3) * 45;
      const sprite = this.image(((i * 397) % width) + 20, baseY, 'life-gull', 35);
      this.gulls.push({ sprite, speed: 9 + (i % 3) * 3, baseY, phase: i * 1.3 });
    }
  }

  // ---- Traffic and people ----------------------------------------------

  private addTravellers(): void {
    const edges = this.graph.map.edges;
    const roads = edges.filter((e) => e.car && e.kind !== 'ROUNDABOUT_RING' && !e.oneWay);
    const walkways = edges.filter((e) => e.foot);
    for (let i = 0; i < TRAFFIC_COUNT; i++) {
      const edge = roads[Math.floor((i / TRAFFIC_COUNT) * roads.length)] as MapEdge;
      const forward = i % 2 === 0;
      this.travellers.push({
        sprite: this.image(0, 0, `life-car-${i % TRAFFIC_COLOURS.length}`, 26),
        edge,
        from: forward ? edge.from : edge.to,
        to: forward ? edge.to : edge.from,
        along: this.graph.edgeLength(edge) * Math.random(),
        speed: Phaser.Math.FloatBetween(...TRAFFIC_SPEED),
        offset: HALF_WIDTH[edge.kind] * 0.5,
        car: true,
      });
    }
    for (let i = 0; i < WALKER_COUNT; i++) {
      const edge = walkways[Math.floor(Math.random() * walkways.length)] as MapEdge;
      const side = Math.random() < 0.5 ? -1 : 1;
      this.travellers.push({
        sprite: this.image(0, 0, `life-walker-${i % WALKER_COLOURS.length}`, 25),
        edge,
        from: edge.from,
        to: edge.to,
        along: this.graph.edgeLength(edge) * Math.random(),
        speed: Phaser.Math.FloatBetween(...WALKER_SPEED),
        offset: side * this.walkOffset(edge),
        car: false,
      });
    }
    for (const t of this.travellers) this.place(t);
  }

  /** People walk on the pavement beside a road, or along the middle of a path. */
  private walkOffset(edge: MapEdge): number {
    return edge.car ? HALF_WIDTH[edge.kind] + PAVEMENT / 2 : Math.random() * HALF_WIDTH[edge.kind] * 0.6;
  }

  private move(t: Traveller, dt: number, player: { x: number; y: number }): void {
    let step = t.speed * dt;
    if (t.car && this.blocked(t, player)) step = 0;
    t.along += step;
    for (let guard = 0; guard < 4; guard++) {
      const length = this.graph.edgeLength(t.edge);
      if (t.along < length) break;
      t.along -= length;
      this.chooseNext(t);
    }
    this.place(t);
  }

  /** Cars wait behind the player, and behind each other, rather than driving through. */
  private blocked(t: Traveller, player: { x: number; y: number }): boolean {
    const heading = t.sprite.rotation;
    const ahead = (x: number, y: number, range: number) => {
      const dx = x - t.sprite.x;
      const dy = y - t.sprite.y;
      const forward = dx * Math.cos(heading) + dy * Math.sin(heading);
      const side = -dx * Math.sin(heading) + dy * Math.cos(heading);
      return forward > 0 && forward < range && Math.abs(side) < 7;
    };
    if (ahead(player.x, player.y, 26)) return true;
    return this.travellers.some((o) => o !== t && o.car && ahead(o.sprite.x, o.sprite.y, 17));
  }

  private chooseNext(t: Traveller): void {
    const at = t.to;
    const ways = this.graph
      .edgesAt(at)
      .filter((e) => (t.car ? e.car && (!e.oneWay || e.from === at) : e.foot))
      .filter((e) => e !== t.edge);
    const next = ways.length > 0 ? (ways[Math.floor(Math.random() * ways.length)] as MapEdge) : t.edge;
    t.from = at;
    t.to = this.graph.other(next, at);
    if (!t.car && next.car !== t.edge.car) t.offset = Math.sign(t.offset || 1) * this.walkOffset(next);
    if (t.car) t.offset = HALF_WIDTH[next.kind] * 0.5;
    t.edge = next;
  }

  private place(t: Traveller): void {
    const a = this.graph.node(t.from);
    const b = this.graph.node(t.to);
    const length = this.graph.edgeLength(t.edge);
    const k = length > 0 ? t.along / length : 0;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    // Drive on the right: the offset goes to the right of the direction of travel.
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    t.sprite.setPosition(a.x + (b.x - a.x) * k + nx * t.offset, a.y + (b.y - a.y) * k + ny * t.offset);
    t.sprite.setRotation(angle);
  }
}

// ---- Textures (drawn once, then shared by every sprite) -------------------

function makeTextures(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
    if (scene.textures.exists(key)) return;
    const g = scene.make.graphics({}, false);
    g.setScale(RES);
    draw(g);
    g.generateTexture(key, w * RES, h * RES);
    g.destroy();
  };

  // Traffic: 16 x 8 m cars facing east, smaller than the suspect's.
  TRAFFIC_COLOURS.forEach((colour, i) =>
    make(`life-car-${i}`, 18, 10, (g) => {
      g.fillStyle(0x000000, 0.22).fillRoundedRect(1.8, 1.8, 16, 8, 2.2);
      g.fillStyle(colour).fillRoundedRect(1, 1, 16, 8, 2.2);
      g.lineStyle(0.5, 0xffffff, 0.5).strokeRoundedRect(1, 1, 16, 8, 2.2);
      g.fillStyle(0x27323a).fillRoundedRect(10.5, 1.9, 3, 6.2, 0.9).fillRoundedRect(3.2, 2.2, 2, 5.6, 0.8);
      g.fillStyle(0xfff4b8).fillRect(16.2, 1.8, 0.8, 1.6).fillRect(16.2, 6.6, 0.8, 1.6);
    }),
  );
  // People: smaller than the officer and the suspect, in bright clothes.
  WALKER_COLOURS.forEach((colour, i) =>
    make(`life-walker-${i}`, 8, 8, (g) => {
      g.fillStyle(0x000000, 0.2).fillEllipse(4.6, 4.7, 5.6, 4.8);
      g.fillStyle(colour).fillEllipse(4, 4, 4.4, 5.8);
      g.fillStyle([0x2a1d17, 0x6b4a2f, 0xe0c27a][i % 3] as number).fillCircle(4.2, 4, 1.6);
    }),
  );
  [0x2f6e9e, 0xd64b3c, 0x3f9b5a, 0xf2c94c].forEach((deck, i) =>
    make(`life-boat-${i}`, 12, 27, (g) => {
      g.fillStyle(0x000000, 0.15).fillEllipse(7.5, 14.5, 9, 24);
      g.fillStyle(0xfbf7ee).fillEllipse(6, 13.5, 9, 24);
      g.fillStyle(deck).fillEllipse(6, 14.5, 6, 15);
      g.fillStyle(0xe4ddd0).fillRect(3.5, 10.5, 5, 5);
    }),
  );
  make('life-sail', 30, 28, (g) => {
    g.fillStyle(0x000000, 0.12).fillTriangle(4, 4, 4, 26, 18, 26);
    g.fillStyle(0xfbf7ee).fillEllipse(2 + 13, 24, 26, 8);
    g.fillStyle(0xf6f1e4).fillTriangle(15, 2, 15, 22, 28, 22);
  });
  make('life-gull', 14, 6, (g) => {
    g.lineStyle(1.3, 0x3a4a52);
    g.beginPath().moveTo(1, 4).lineTo(4, 1.5).lineTo(7, 3.5).lineTo(10, 1.5).lineTo(13, 4).strokePath();
  });
  make('life-waves', 80, 28, (g) => {
    g.lineStyle(2, PALETTE.lightBlue, 1);
    for (const [cx, cy] of [
      [20, 8],
      [60, 22],
    ] as const) {
      g.beginPath().arc(cx, cy, 12, Math.PI * 1.15, Math.PI * 1.85).strokePath();
    }
  });
}
