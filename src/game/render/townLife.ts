import Phaser from 'phaser';
import { decorations } from './graphicsMode';
import { HALF_WIDTH, laneOffset, PAVEMENT } from '../../engine/world/geometry';
import type { TownGraph } from '../../engine/world/graph';
import type { MapEdge } from '../../engine/world/types';
import { PALETTE } from '../palette';
import { CAR_SCALE, carPicture } from './actors';
import { carLights } from './night';

/**
 * Life in Bellevue City: traffic, people out walking (and strolling on the
 * beach), swimmers in the pool and the sea, sunbathers, a beach ball, waves,
 * boats, the fountain, seagulls and butterflies in the park. Pure decoration
 * drawn on top of the baked town; nothing here takes part in the chase.
 *
 * Traffic only ever uses colours the scanner never names (no blue, black,
 * white or green car, taxi or van), so a passing car can't be mistaken for
 * the suspect's. Every car is the same size, each in its own lane.
 */

/** Texture pixels per metre, so the sprites stay sharp when the camera zooms in. */
const RES = 4;

const TRAFFIC_COLOURS = [0xd64b3c, 0xe0863c, 0x7a2e3a, 0x8e5bb0, 0xd8c49a, 0xe58fa8];
const WALKER_COLOURS = [0xf2c94c, 0x5bb6cc, 0xe86a8a, 0x8e5bb0, 0xf29a4b, 0x6fb24a, 0xf4f1e8, 0xd64b3c];
/** People (Mr Henry, 2026-10-05: better-drawn walkers): skin, hair and what they carry or wear. */
const SKINS = [0xe0ac7e, 0xc68e5e, 0x8d5a3b, 0x5c3a24];
const HAIRS = [0x2a1d17, 0x6b4a2f, 0xe0c27a, 0x1a1a1a, 0xb5532a];
type Accessory = 'NONE' | 'HAT' | 'CAP' | 'BAG' | 'GLASSES' | 'PHONE';
const ACCESSORIES: Accessory[] = ['NONE', 'HAT', 'CAP', 'BAG', 'GLASSES', 'PHONE', 'NONE', 'BAG'];
/** How many different-looking people there are, and the frames of their walk. */
const PERSON_KINDS = 12;
const WALK_FRAMES = [0, 1, 2, 1];
/** Metres of walking per frame of the stride. */
const STRIDE_METRES = 1.1;
/** Swimmers: lengths of the pool at this speed (m/s), and how far from the pool's ends they turn. */
const SWIM_SPEED: [number, number] = [2.2, 3.4];
const POOL_MARGIN = 7;
/** The lane pool's water, in metres from the pool's top-left corner (as the town picture draws it). */
const POOL_WATER = { x: 31, y: 32, w: 97, h: 60 };
const SEA_SWIMMERS = 9;
const BEACH_STROLLERS = 7;
const BUTTERFLIES = 9;

const TRAFFIC_COUNT = 16;
const WALKER_COUNT = 44;
const TRAFFIC_SPEED: [number, number] = [32, 44];
/** A car's size on the map (metres), the same as the police car and the suspect's. */
const CAR_LENGTH = 18 * CAR_SCALE;
const CAR_WIDTH = 9.6 * CAR_SCALE;
/**
 * Pulling over for the chase: within `range` metres along the road, cars move
 * over until their middle is `onKerb` metres past the kerb, at `crawl` times
 * their speed, easing across at `ease` per second.
 */
const PULL_OVER = { range: 80, onKerb: 0.5, crawl: 0.3, ease: 4 };
const WALKER_SPEED: [number, number] = [4, 7];
/**
 * People step aside for someone running at them (Mr Henry, 2026-10-05: the
 * suspect and the officers run round people, not through them): within
 * `range` metres they move `shift` metres out of the way, slowing to `slow`
 * of their pace, easing across at `ease` per second.
 */
const STEP_ASIDE = { range: 12, shift: 5, slow: 0.25, ease: 7 };

interface Traveller {
  sprite: Phaser.GameObjects.Image;
  /** A person's look (texture family), so their walk can be animated. */
  kind?: number;
  /** A car picture's shadow, which follows it. */
  shadow?: Phaser.GameObjects.Image;
  /** A car's headlights and tail lights at night, which follow it too. */
  lights?: Phaser.GameObjects.Container;
  edge: MapEdge;
  from: string;
  to: string;
  /** Metres travelled along the edge from `from`. */
  along: number;
  speed: number;
  /** Sideways offset from the centre line: the right-hand lane, or a pavement. */
  offset: number;
  /** A car pulled over to the kerb to let the chase by. */
  pulledOver: boolean;
  car: boolean;
  /** A person stepping aside for a runner: metres moved out of the way, and whether they are waiting for them to pass. */
  aside?: number;
  yielding?: boolean;
}

export interface TownLifeOptions {
  /** Where the player is drawn, so traffic waits behind them instead of driving through. */
  player: () => { x: number; y: number };
  /** The police car and the suspect's car (drawn), when driving: traffic pulls over to let them by. */
  chasers?: () => { x: number; y: number }[];
  /** Anyone running (the suspect or an officer on foot): people step out of their way. */
  runners?: () => { x: number; y: number }[];
  /** Something across the whole road (a police roadblock): traffic stops short of it. */
  obstacles?: () => { x: number; y: number }[];
}

export class TownLife {
  /** Every object this creates, so the HUD camera can ignore them. */
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly travellers: Traveller[] = [];
  private readonly waves: Phaser.GameObjects.TileSprite[] = [];
  private readonly sails: Phaser.GameObjects.Image[] = [];
  private readonly gulls: { sprite: Phaser.GameObjects.Image; speed: number; baseY: number; phase: number }[] = [];
  private readonly swimmers: Swimmer[] = [];
  private readonly bathers: Bather[] = [];
  private readonly strollers: Stroller[] = [];
  private readonly butterflies: Butterfly[] = [];
  private ball: { sprite: Phaser.GameObjects.Image; from: Point; to: Point; t: number; seconds: number } | null = null;
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
    this.addPool();
    this.addSeaBathers();
    this.addBeach();
    this.addButterflies();
  }

  /** Where the traffic is drawn, so the police and the suspect can pull out round it. */
  cars(): { x: number; y: number }[] {
    return this.travellers.filter((t) => t.car).map((t) => t.sprite);
  }

  update(deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000;
    this.clock += dt;
    const player = this.options.player();
    const chasers = this.options.chasers?.() ?? [];
    const runners = this.options.runners?.() ?? [];
    for (const t of this.travellers) {
      if (t.car) this.giveWay(t, chasers, dt);
      else this.stepAside(t, runners, dt);
      this.move(t, dt, player);
    }
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
    this.swim(dt);
    this.bathe();
    this.stroll(dt);
    this.flutter(dt);
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
      // The same cartoon car as the police and the suspect drive, in a traffic colour.
      const [shadow, picture] = carPicture(this.scene, 'CAR', TRAFFIC_COLOURS[i % TRAFFIC_COLOURS.length] as number, 18 * CAR_SCALE);
      if (shadow) this.add(shadow.setDepth(25.9));
      const lights = carLights(this.scene, 18);
      this.travellers.push({
        ...(lights.length > 0 ? { lights: this.add(this.scene.add.container(0, 0, lights).setDepth(26.1).setScale(CAR_SCALE)) } : {}),
        sprite: picture
          ? this.add(picture.setDepth(26))
          : this.image(0, 0, `life-car-${i % TRAFFIC_COLOURS.length}`, 26).setScale(CAR_SCALE / RES),
        ...(shadow ? { shadow } : {}),
        edge,
        from: forward ? edge.from : edge.to,
        to: forward ? edge.to : edge.from,
        along: this.graph.edgeLength(edge) * Math.random(),
        speed: Phaser.Math.FloatBetween(...TRAFFIC_SPEED),
        offset: laneOffset(edge.kind),
        pulledOver: false,
        car: true,
      });
    }
    for (let i = 0; i < decorations(WALKER_COUNT); i++) {
      const edge = walkways[Math.floor(Math.random() * walkways.length)] as MapEdge;
      const side = Math.random() < 0.5 ? -1 : 1;
      const kind = i % PERSON_KINDS;
      this.travellers.push({
        sprite: this.image(0, 0, `life-person-${kind}-0`, 25),
        kind,
        edge,
        from: edge.from,
        to: edge.to,
        along: this.graph.edgeLength(edge) * Math.random(),
        speed: Phaser.Math.FloatBetween(...WALKER_SPEED),
        offset: side * this.walkOffset(edge),
        pulledOver: false,
        car: false,
      });
    }
    for (const t of this.travellers) this.place(t);
  }

  /** People walk on the pavement beside a road, or along the middle of a path. */
  private walkOffset(edge: MapEdge): number {
    return edge.car ? HALF_WIDTH[edge.kind] + PAVEMENT / 2 : Math.random() * HALF_WIDTH[edge.kind] * 0.6;
  }

  /**
   * With the chase coming along its road, a car pulls over to the kerb and
   * crawls until it has gone by (as drivers do for a siren).
   */
  private giveWay(t: Traveller, chasers: readonly { x: number; y: number }[], dt: number): void {
    const half = HALF_WIDTH[t.edge.kind];
    const heading = t.sprite.rotation;
    t.pulledOver = chasers.some((c) => {
      const dx = c.x - t.sprite.x;
      const dy = c.y - t.sprite.y;
      const along = dx * Math.cos(heading) + dy * Math.sin(heading);
      const across = -dx * Math.sin(heading) + dy * Math.cos(heading);
      return Math.abs(along) < PULL_OVER.range && Math.abs(across) < half * 2;
    });
    const target = t.pulledOver ? half + PULL_OVER.onKerb : laneOffset(t.edge.kind);
    t.offset += (target - t.offset) * Math.min(1, dt * PULL_OVER.ease);
  }

  /** Someone running this way: move out of their path, to the side away from them, and let them by. */
  private stepAside(t: Traveller, runners: readonly { x: number; y: number }[], dt: number): void {
    let target = 0;
    t.yielding = false;
    const heading = t.sprite.rotation;
    for (const r of runners) {
      const dx = r.x - t.sprite.x;
      const dy = r.y - t.sprite.y;
      if (dx * dx + dy * dy > STEP_ASIDE.range * STEP_ASIDE.range) continue;
      // Which side of the person the runner is on (to their right is positive).
      const across = -dx * Math.sin(heading) + dy * Math.cos(heading);
      target = across >= 0 ? -STEP_ASIDE.shift : STEP_ASIDE.shift;
      t.yielding = true;
      break;
    }
    t.aside = (t.aside ?? 0) + (target - (t.aside ?? 0)) * Math.min(1, dt * STEP_ASIDE.ease);
  }

  private move(t: Traveller, dt: number, player: { x: number; y: number }): void {
    let step = t.speed * dt * (t.pulledOver ? PULL_OVER.crawl : 1) * (t.yielding ? STEP_ASIDE.slow : 1);
    if (t.car && this.blocked(t, player)) step = 0;
    t.along += step;
    // A person's legs and arms swing with the distance walked.
    if (t.kind !== undefined) t.sprite.setTexture(`life-person-${t.kind}-${WALK_FRAMES[Math.floor(t.along / STRIDE_METRES) % WALK_FRAMES.length]}`);
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
    const ahead = (x: number, y: number, range: number, width = CAR_WIDTH) => {
      const dx = x - t.sprite.x;
      const dy = y - t.sprite.y;
      const forward = dx * Math.cos(heading) + dy * Math.sin(heading);
      const side = -dx * Math.sin(heading) + dy * Math.cos(heading);
      return forward > 0 && forward < range && Math.abs(side) < width;
    };
    if (ahead(player.x, player.y, CAR_LENGTH * 1.5)) return true;
    if ((this.options.obstacles?.() ?? []).some((o) => ahead(o.x, o.y, CAR_LENGTH * 1.5, HALF_WIDTH[t.edge.kind] * 1.5))) return true;
    return this.travellers.some((o) => o !== t && o.car && ahead(o.sprite.x, o.sprite.y, CAR_LENGTH * 1.2));
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
    if (t.car) t.offset = t.pulledOver ? HALF_WIDTH[next.kind] + PULL_OVER.onKerb : laneOffset(next.kind);
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
    const offset = t.offset + (t.aside ?? 0);
    t.sprite.setPosition(a.x + (b.x - a.x) * k + nx * offset, a.y + (b.y - a.y) * k + ny * offset);
    t.sprite.setRotation(angle);
    t.shadow?.setPosition(t.sprite.x + 1.5, t.sprite.y + 2).setRotation(angle);
    t.lights?.setPosition(t.sprite.x, t.sprite.y).setRotation(angle);
  }

  // ---- Swimmers, sunbathers, strollers and butterflies --------------------

  /** Swimmers doing lengths of the pool, one per lane, turning at each end. */
  private addPool(): void {
    const pool = this.graph.map.locations.find((l) => l.id === 'SWIMMING_POOL');
    if (!pool) return;
    const r = pool.footprint;
    // The pool's water as the town picture draws it: six lanes left of the paddling pool.
    const water = { x: r.x + POOL_WATER.x, y: r.y + POOL_WATER.y, w: POOL_WATER.w, h: POOL_WATER.h };
    const lanes = 6;
    for (let lane = 0; lane < lanes; lane++) {
      if (lane % 3 === 1) continue; // an empty lane here and there
      const y = water.y + (lane + 0.5) * (water.h / lanes);
      const dir = lane % 2 === 0 ? 1 : -1;
      const from = water.x + POOL_MARGIN;
      const to = water.x + water.w - POOL_MARGIN;
      const x = from + Math.random() * (to - from);
      const kind = lane % PERSON_KINDS;
      const sprite = this.image(x, y, `life-swimmer-${kind}-0`, 1.2).setRotation(dir === 1 ? 0 : Math.PI);
      this.swimmers.push({ sprite, kind, y, from, to, x, dir: dir as 1 | -1, speed: Phaser.Math.FloatBetween(...SWIM_SPEED), swum: 0 });
    }
  }

  private swim(dt: number): void {
    for (const s of this.swimmers) {
      s.x += s.dir * s.speed * dt;
      s.swum += s.speed * dt;
      if (s.x > s.to) {
        s.x = s.to;
        s.dir = -1;
      } else if (s.x < s.from) {
        s.x = s.from;
        s.dir = 1;
      }
      s.sprite.setPosition(s.x, s.y + Math.sin(s.swum * 1.6) * 0.25).setRotation(s.dir === 1 ? 0 : Math.PI);
      s.sprite.setTexture(`life-swimmer-${s.kind}-${Math.floor(s.swum / 1.4) % 2}`);
    }
  }

  /** Bathers bobbing in the sea off the beach, some on rubber rings, drifting slowly along. */
  private addSeaBathers(): void {
    const sea = this.graph.map.regions.find((r) => r.kind === 'SEA');
    const beach = this.graph.map.locations.find((l) => l.id === 'BEACH');
    if (!sea || !beach) return;
    const top = Math.min(...sea.points.map((p) => p[1]));
    const swimmers = decorations(SEA_SWIMMERS);
    for (let i = 0; i < swimmers; i++) {
      const x = beach.footprint.x + 40 + ((i + 0.5) / swimmers) * (beach.footprint.w - 80) + Phaser.Math.FloatBetween(-30, 30);
      const y = top + 8 + (i % 3) * 9 + Phaser.Math.FloatBetween(0, 4);
      const kind = (i * 5) % PERSON_KINDS;
      const ring = i % 3 === 0;
      const sprite = this.image(x, y, ring ? `life-ring-${kind % 4}` : `life-bather-${kind}`, 1.3).setRotation(Phaser.Math.FloatBetween(-0.6, 0.6));
      this.bathers.push({ sprite, x, y, phase: i * 1.7, drift: Phaser.Math.FloatBetween(-0.6, 0.6) });
    }
  }

  private bathe(): void {
    for (const b of this.bathers) {
      // Up and down with the swell, and a slow drift with the current that turns back.
      b.sprite.setPosition(b.x + Math.sin(this.clock * 0.15 + b.phase) * 12 * b.drift, b.y + Math.sin(this.clock * 1.1 + b.phase) * 1.4);
      b.sprite.setRotation(Math.sin(this.clock * 0.5 + b.phase) * 0.25);
    }
  }

  /** People wandering the sand, sunbathers on the towels, and a beach ball going back and forth. */
  private addBeach(): void {
    const beach = this.graph.map.locations.find((l) => l.id === 'BEACH');
    if (!beach) return;
    const r = beach.footprint;
    for (let i = 0; i < decorations(BEACH_STROLLERS); i++) {
      const at = within(r, 10);
      const kind = (i * 7 + 3) % PERSON_KINDS;
      const sprite = this.image(at.x, at.y, `life-person-${kind}-0`, 25);
      this.strollers.push({ sprite, kind, x: at.x, y: at.y, target: within(r, 10), speed: Phaser.Math.FloatBetween(2.5, 4), walked: 0, pauseFor: 0 });
    }
    // Sunbathers lie on the towels landmarks.ts draws (same walk along the sand, same colours).
    let k = 3;
    let n = 0;
    for (let x = r.x + 30; x < r.x + r.w - 20; x += 46) {
      k = (k * 37 + 11) % 97;
      const y = r.y + 34 + (k % 5) * 9;
      if (n++ % 2 === 0) this.image(x + 10, y + 2.5, `life-sunbather-${n % 4}`, 24.9).setRotation(Math.PI / 2);
    }
    // A beach ball tossed between two spots near the water.
    const from = { x: r.x + r.w * 0.3, y: r.y + r.h - 24 };
    const to = { x: from.x + 22, y: from.y + 6 };
    this.ball = { sprite: this.image(from.x, from.y, 'life-ball', 26), from, to, t: 0, seconds: 1.6 };
  }

  private stroll(dt: number): void {
    for (const p of this.strollers) {
      if (p.pauseFor > 0) {
        p.pauseFor -= dt;
        continue;
      }
      const dx = p.target.x - p.x;
      const dy = p.target.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5) {
        const beach = this.graph.map.locations.find((l) => l.id === 'BEACH');
        if (beach) p.target = within(beach.footprint, 10);
        p.pauseFor = Phaser.Math.FloatBetween(1, 5);
        p.sprite.setTexture(`life-person-${p.kind}-1`);
        continue;
      }
      const step = Math.min(d, p.speed * dt);
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      p.walked += step;
      p.sprite.setPosition(p.x, p.y).setRotation(Math.atan2(dy, dx));
      p.sprite.setTexture(`life-person-${p.kind}-${WALK_FRAMES[Math.floor(p.walked / STRIDE_METRES) % WALK_FRAMES.length]}`);
    }
    const ball = this.ball;
    if (ball) {
      ball.t += dt / ball.seconds;
      if (ball.t >= 1) {
        ball.t = 0;
        [ball.from, ball.to] = [ball.to, ball.from];
      }
      // An arc through the air: higher (bigger) in the middle of the throw.
      const k = ball.t;
      const lift = Math.sin(k * Math.PI);
      ball.sprite.setPosition(ball.from.x + (ball.to.x - ball.from.x) * k, ball.from.y + (ball.to.y - ball.from.y) * k - lift * 6);
      ball.sprite.setScale((1 + lift * 0.5) / RES).setRotation(this.clock * 4);
    }
  }

  /** Butterflies fluttering about the park, each wandering its own way. */
  private addButterflies(): void {
    const park = this.graph.map.regions.find((r) => r.kind === 'PARK');
    if (!park) return;
    const xs = park.points.map((p) => p[0]);
    const ys = park.points.map((p) => p[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    for (let i = 0; i < decorations(BUTTERFLIES); i++) {
      const at = within(box, 8);
      const sprite = this.image(at.x, at.y, `life-butterfly-${i % 4}`, 36);
      this.butterflies.push({ sprite, x: at.x, y: at.y, heading: Math.random() * Math.PI * 2, phase: i * 0.9 });
    }
    this.butterflyBox = box;
  }

  private butterflyBox: { x: number; y: number; w: number; h: number } | null = null;

  private flutter(dt: number): void {
    const box = this.butterflyBox;
    if (!box) return;
    for (const b of this.butterflies) {
      // A wobbly path that turns back at the park's edge; wings beating fast.
      b.heading += Math.sin(this.clock * 2.3 + b.phase) * dt * 2.5;
      b.x += Math.cos(b.heading) * dt * 4;
      b.y += Math.sin(b.heading) * dt * 4;
      if (b.x < box.x + 4 || b.x > box.x + box.w - 4 || b.y < box.y + 4 || b.y > box.y + box.h - 4) {
        b.heading = Math.atan2(box.y + box.h / 2 - b.y, box.x + box.w / 2 - b.x) + Phaser.Math.FloatBetween(-0.5, 0.5);
      }
      b.sprite.setPosition(b.x, b.y + Math.sin(this.clock * 3 + b.phase) * 0.8).setRotation(b.heading);
      b.sprite.scaleY = (0.35 + 0.65 * Math.abs(Math.sin(this.clock * 14 + b.phase))) / RES;
    }
  }
}

// ---- Water and sand -------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

interface Swimmer {
  sprite: Phaser.GameObjects.Image;
  kind: number;
  /** Lane (y) and the ends of a length (x). */
  y: number;
  from: number;
  to: number;
  x: number;
  dir: 1 | -1;
  speed: number;
  /** Metres swum, for the stroke frames. */
  swum: number;
}

interface Bather {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  phase: number;
  drift: number;
}

interface Stroller {
  sprite: Phaser.GameObjects.Image;
  kind: number;
  x: number;
  y: number;
  target: Point;
  speed: number;
  walked: number;
  /** Standing still for a moment, looking at the sea. */
  pauseFor: number;
}

interface Butterfly {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  heading: number;
  phase: number;
}

/** A point at random inside a rectangle, `inset` metres from its edges. */
function within(r: { x: number; y: number; w: number; h: number }, inset: number): Point {
  return { x: r.x + inset + Math.random() * (r.w - 2 * inset), y: r.y + inset + Math.random() * (r.h - 2 * inset) };
}

// (The swimmers, bathers, strollers and butterflies are methods of TownLife; see below.)

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

  // Traffic: cars facing east, built like the suspect's (18 x 9.6 m, before CAR_SCALE).
  TRAFFIC_COLOURS.forEach((colour, i) =>
    make(`life-car-${i}`, 21, 12.6, (g) => {
      g.fillStyle(0x000000, 0.22).fillRoundedRect(2.5, 3, 18, 9.6, 2.5);
      g.fillStyle(colour).fillRoundedRect(1, 1, 18, 9.6, 2.5);
      g.lineStyle(0.6, 0xffffff, 0.55).strokeRoundedRect(1, 1, 18, 9.6, 2.5);
      g.fillStyle(0x27323a).fillRoundedRect(11.5, 2, 3.5, 7.6, 1).fillRoundedRect(3.5, 2.2, 2.5, 7.2, 1);
      g.fillStyle(0xfff4b8).fillRect(18.1, 2.2, 0.9, 1.8).fillRect(18.1, 7.6, 0.9, 1.8);
    }),
  );
  // People: smaller than the officer and the suspect, each with their own clothes, skin, hair and
  // something carried or worn, in three frames of a walk (legs and arms swinging).
  for (let kind = 0; kind < PERSON_KINDS; kind++) {
    const look = personLook(kind);
    for (const frame of [0, 1, 2]) make(`life-person-${kind}-${frame}`, 10, 10, (g) => drawPerson(g, 5, 5, look, frame === 1 ? 0 : frame === 0 ? 1 : -1));
    for (const frame of [0, 1]) make(`life-swimmer-${kind}-${frame}`, 10, 8, (g) => drawSwimmer(g, 5, 4, look, frame));
    make(`life-bather-${kind}`, 8, 8, (g) => drawBather(g, 4, 4, look));
  }
  [0xd64b3c, 0xf2c94c, 0x5bb6cc, 0xe86a8a].forEach((colour, i) =>
    make(`life-ring-${i}`, 10, 10, (g) => {
      const look = personLook(i * 3);
      g.fillStyle(colour).fillCircle(5, 5, 4.2);
      g.fillStyle(0xffffff, 0.9).fillCircle(5, 5, 4.2).fillStyle(colour).fillCircle(5, 5, 4.2);
      g.lineStyle(0.6, 0xffffff, 0.9).strokeCircle(5, 5, 3.4);
      g.fillStyle(0x2f8fb3).fillCircle(5, 5, 2.4); // the water in the ring
      g.fillStyle(look.skin).fillCircle(5, 5, 1.5).fillCircle(5, 2.4, 0.6).fillCircle(5, 7.6, 0.6); // head, hands
      g.fillStyle(look.hair).fillCircle(4.6, 5, 1.2);
    }),
  );
  [0xe86a8a, 0x5bb6cc, 0xf2c94c, 0x6fb24a].forEach((towel, i) =>
    make(`life-sunbather-${i}`, 10, 6, (g) => {
      const look = personLook(i * 2 + 1);
      g.fillStyle(look.skin).fillEllipse(5, 3, 7, 2.6); // lying on the towel, head to the right
      g.fillStyle(towel === 0xf2c94c ? 0xd64b3c : 0xf2c94c).fillRect(3.6, 1.9, 2.4, 2.2); // swimsuit
      g.fillStyle(look.skin).fillCircle(8, 3, 1.2);
      g.fillStyle(look.hair).fillCircle(8.4, 3, 1);
      if (i % 2 === 0) g.fillStyle(0x111111).fillRect(7.6, 2.3, 0.9, 1.4); // sunglasses
    }),
  );
  make('life-ball', 5, 5, (g) => {
    g.fillStyle(0xffffff).fillCircle(2.5, 2.5, 2);
    g.fillStyle(0xd64b3c).fillEllipse(1.6, 2.5, 1.2, 4).fillStyle(0x2f6fd6).fillEllipse(3.4, 2.5, 1.2, 4);
    g.lineStyle(0.3, 0x3a4a52, 0.8).strokeCircle(2.5, 2.5, 2);
  });
  [0xf2a53a, 0x5bb6cc, 0xe86a8a, 0xf4f1e8].forEach((wing, i) =>
    make(`life-butterfly-${i}`, 5, 5, (g) => {
      g.fillStyle(wing).fillEllipse(1.8, 1.6, 2.4, 2).fillEllipse(1.8, 3.4, 2.4, 2).fillEllipse(3.4, 1.9, 1.6, 1.4).fillEllipse(3.4, 3.1, 1.6, 1.4);
      g.fillStyle(0x3a2a1a).fillEllipse(2.5, 2.5, 3.2, 0.7);
      g.fillStyle(0x111111, 0.6).fillCircle(1.4, 1.6, 0.3).fillCircle(1.4, 3.4, 0.3);
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

/** The look of the `kind`-th person in town: clothes, skin, hair and an accessory, always the same for that kind. */
function personLook(kind: number): PersonLook {
  return {
    shirt: WALKER_COLOURS[kind % WALKER_COLOURS.length]!,
    skin: SKINS[(kind * 5 + 1) % SKINS.length]!,
    hair: HAIRS[(kind * 3 + 2) % HAIRS.length]!,
    accessory: ACCESSORIES[kind % ACCESSORIES.length]!,
  };
}

interface PersonLook {
  shirt: number;
  skin: number;
  hair: number;
  accessory: Accessory;
}

const PERSON_OUTLINE = 0x1b2230;

/**
 * A person seen from above, facing east, at (cx, cy) in metres: feet, a body
 * in their shirt, swinging arms with hands, a head with hair, and a hat, cap,
 * sunglasses, bag or phone. `swing` (-1, 0, 1) is the stride: which leg and
 * arm are forward.
 */
function drawPerson(g: Phaser.GameObjects.Graphics, cx: number, cy: number, look: PersonLook, swing: number): void {
  const s = swing * 1.1;
  g.fillStyle(0x000000, 0.2).fillEllipse(cx + 0.6, cy + 0.7, 5.4, 4.6);
  // Feet (dark shoes), one forward one back.
  g.fillStyle(0x2b2b2b).fillEllipse(cx + s, cy - 1.2, 1.8, 1).fillEllipse(cx - s, cy + 1.2, 1.8, 1);
  // Arms and hands swing the other way to the legs.
  g.fillStyle(look.shirt).fillEllipse(cx - s * 0.7, cy - 2.5, 1.8, 1.1).fillEllipse(cx + s * 0.7, cy + 2.5, 1.8, 1.1);
  g.fillStyle(look.skin).fillCircle(cx - s * 0.7 + 0.8, cy - 2.5, 0.55).fillCircle(cx + s * 0.7 + 0.8, cy + 2.5, 0.55);
  // Shoulders and body.
  g.fillStyle(look.shirt).fillEllipse(cx, cy, 4, 4.8);
  g.lineStyle(0.35, PERSON_OUTLINE, 0.85).strokeEllipse(cx, cy, 4, 4.8);
  if (look.accessory === 'BAG') g.fillStyle(0x8a5a2b).fillRoundedRect(cx - 2.2, cy + 1.2, 1.6, 2, 0.4);
  // Head: skin with hair over the back and sides.
  g.fillStyle(look.skin).fillCircle(cx + 0.2, cy, 1.5);
  g.fillStyle(look.hair).fillEllipse(cx - 0.3, cy, 2.4, 3);
  g.lineStyle(0.3, PERSON_OUTLINE, 0.85).strokeCircle(cx + 0.2, cy, 1.5);
  switch (look.accessory) {
    case 'HAT':
      g.fillStyle(0xe9d28a).fillCircle(cx + 0.1, cy, 2.2);
      g.lineStyle(0.3, 0xb8964a, 0.9).strokeCircle(cx + 0.1, cy, 2.2);
      g.fillStyle(0xd23b30).fillCircle(cx + 0.1, cy, 1.1);
      break;
    case 'CAP':
      g.fillStyle(0x2f6fd6).fillCircle(cx, cy, 1.5).fillEllipse(cx + 1.8, cy, 1.2, 2.2);
      break;
    case 'GLASSES':
      g.fillStyle(0x111111).fillRect(cx + 1.2, cy - 1.1, 0.6, 0.9).fillRect(cx + 1.2, cy + 0.2, 0.6, 0.9);
      break;
    case 'PHONE':
      g.fillStyle(0x222222).fillRect(cx + 1.6, cy - 2.9, 0.9, 1.4);
      break;
    default:
      break;
  }
}

/** A swimmer doing lengths, facing east: head and cap, shoulders, arms reaching in turn, a splash behind. */
function drawSwimmer(g: Phaser.GameObjects.Graphics, cx: number, cy: number, look: PersonLook, frame: number): void {
  const reach = frame === 0 ? 1 : -1;
  g.fillStyle(0xffffff, 0.55).fillEllipse(cx - 3.2, cy, 3, 2.2).fillEllipse(cx - 4.4, cy + 1, 1.4, 1); // splash and wake
  g.fillStyle(look.skin, 0.9).fillEllipse(cx - 0.6, cy, 3.6, 2); // shoulders and back, just under the water
  g.fillStyle(look.skin).fillEllipse(cx + 1.2 * reach + 0.2, cy - 1.7, 2.6, 0.9).fillEllipse(cx - 1.2 * reach + 0.2, cy + 1.7, 2.6, 0.9); // arms
  g.fillStyle(look.shirt).fillCircle(cx + 1.4, cy, 1.3); // swim cap in their colour
  g.fillStyle(0xffffff, 0.7).fillCircle(cx + 1.4, cy, 0.5);
  g.fillStyle(0xffffff, 0.5).fillCircle(cx + 1.2 * reach + 1.4, cy - 1.7, 0.7); // the splash of the hand
}

/** Someone bobbing in the sea: head out of the water, arms paddling. */
function drawBather(g: Phaser.GameObjects.Graphics, cx: number, cy: number, look: PersonLook): void {
  g.fillStyle(0xffffff, 0.35).fillEllipse(cx, cy, 6.5, 5);
  g.fillStyle(look.skin, 0.8).fillEllipse(cx, cy, 3.4, 2.4);
  g.fillStyle(look.skin).fillCircle(cx + 2.4, cy - 1.2, 0.6).fillCircle(cx + 2.4, cy + 1.2, 0.6); // hands
  g.fillStyle(look.skin).fillCircle(cx + 0.3, cy, 1.4);
  g.fillStyle(look.hair).fillEllipse(cx - 0.2, cy, 2, 2.8);
}
