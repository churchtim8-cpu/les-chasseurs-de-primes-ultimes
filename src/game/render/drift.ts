import Phaser from 'phaser';

/**
 * Drifting round corners (drawing only: the chase's movement is unchanged).
 * When the police car turns a corner at speed, its body swings into the turn
 * and slides out a little, black skid marks are laid behind the rear tyres
 * and puffs of tyre smoke billow up and fade.
 */
const DRIFT = {
  /** A corner sharper than this (radians) at more than `minSpeed` starts a drift. */
  minTurn: 0.45,
  minSpeed: 35,
  /** How long a drift lasts (s), how far the body swings (radians) and slides out (m). */
  seconds: 0.8,
  slip: 0.55,
  slide: 3.2,
  /** Skid marks fade over this long (s); rear tyres sit this far behind the centre and apart (m). */
  markSeconds: 6,
  rear: 6,
  track: 3.4,
  /** A smoke puff every this many seconds while drifting. */
  puffEvery: 0.035,
};

interface Mark {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  age: number;
}

export class DriftEffects {
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly puffs: Phaser.GameObjects.Arc[] = [];
  private nextPuff = 0;
  private puffIndex = 0;
  private segments: Mark[] = [];
  private lastWheels = new Map<string, { x: number; y: number }[]>();
  private puffClocks = new Map<string, number>();
  private drift: { dir: number; t: number } | null = null;
  private lastHeading: number | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.marks = scene.add.graphics().setDepth(27);
    for (let i = 0; i < 40; i++) this.puffs.push(scene.add.circle(0, 0, 5, 0xd2d2d2).setAlpha(0).setDepth(29));
  }

  /** The objects to keep off the interface camera. */
  get objects(): Phaser.GameObjects.GameObject[] {
    return [this.marks, ...this.puffs];
  }

  get drifting(): boolean {
    return this.drift !== null;
  }

  /**
   * Call every frame with the car's travel heading (which turns sharply at a
   * corner) and the heading being drawn. Returns how far to swing the body
   * (radians) and slide it (map units, x and y) this frame.
   */
  update(
    car: { x: number; y: number; heading: number; speed: number; driving: boolean },
    shownHeading: number,
    deltaMs: number,
  ): { swing: number; dx: number; dy: number } {
    const dt = deltaMs / 1000;
    this.fadeMarks(dt);
    if (!car.driving) {
      this.lastHeading = null;
      this.drift = null;
      this.lift('player');
      return { swing: 0, dx: 0, dy: 0 };
    }
    if (this.lastHeading !== null) {
      const turn = Phaser.Math.Angle.Wrap(car.heading - this.lastHeading);
      if (Math.abs(turn) > DRIFT.minTurn && car.speed > DRIFT.minSpeed) this.drift = { dir: Math.sign(turn), t: 0 };
    }
    this.lastHeading = car.heading;
    if (!this.drift) {
      this.lift('player');
      return { swing: 0, dx: 0, dy: 0 };
    }

    this.drift.t += dt;
    const share = this.drift.t / DRIFT.seconds;
    if (share >= 1) {
      this.drift = null;
      this.lift('player');
      return { swing: 0, dx: 0, dy: 0 };
    }
    // Swings in fast, then straightens out slowly.
    const shape = share < 0.2 ? share / 0.2 : 1 - (share - 0.2) / 0.8;
    const swing = this.drift.dir * DRIFT.slip * shape;
    // The tail slides to the outside of the corner.
    const out = car.heading - this.drift.dir * (Math.PI / 2);
    const slide = DRIFT.slide * shape;
    const dx = Math.cos(out) * slide;
    const dy = Math.sin(out) * slide;

    this.tyres('player', car.x + dx, car.y + dy, shownHeading + swing, shape, dt);
    return { swing, dx, dy };
  }

  /**
   * Lays skid marks behind a car's rear tyres and puffs tyre smoke (any car:
   * the player's drift, or the suspect braking hard). Call every frame while
   * it skids; `id` keeps each car's marks joined up.
   */
  tyres(id: string, x: number, y: number, body: number, strength: number, dt: number): void {
    const wheels = [-1, 1].map((side) => ({
      x: x - Math.cos(body) * DRIFT.rear - Math.sin(body) * (side * DRIFT.track),
      y: y - Math.sin(body) * DRIFT.rear + Math.cos(body) * (side * DRIFT.track),
    }));
    const last = this.lastWheels.get(id);
    if (last) {
      wheels.forEach((w, i) => this.segments.push({ ax: last[i]!.x, ay: last[i]!.y, bx: w.x, by: w.y, age: 0 }));
      if (this.segments.length > 600) this.segments.splice(0, this.segments.length - 600);
    }
    this.lastWheels.set(id, wheels);
    const clock = (this.puffClocks.get(id) ?? 0) + dt;
    let left = clock;
    while (left >= DRIFT.puffEvery) {
      left -= DRIFT.puffEvery;
      const w = wheels[this.nextPuff++ % 2]!;
      this.puff(w.x, w.y, strength);
    }
    this.puffClocks.set(id, left);
  }

  /** The car has stopped skidding: its next marks start a new line. */
  lift(id: string): void {
    this.lastWheels.delete(id);
  }

  /** A burst of dust where someone hits the ground (a tackle, a fall). */
  dust(x: number, y: number, count = 8): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.puff(x + Math.cos(a) * 1.5, y + Math.sin(a) * 1.5, 0.4, 0xc9b08a, 0.35);
    }
  }

  /** A wisp of steam from a crashed car's bonnet. */
  steam(x: number, y: number): void {
    this.puff(x, y, 0.1, 0xf2f2f2, 0.55);
  }

  /** Dark smoke and debris where a car hits something. */
  smash(x: number, y: number, count = 10): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.puff(x + Math.cos(a) * 2, y + Math.sin(a) * 2, 0.6, i % 3 === 0 ? 0x3a3a3a : 0x8a8a8a, 0.7);
    }
  }

  private puff(x: number, y: number, strength: number, colour = 0xd2d2d2, size = 1): void {
    const p = this.puffs[this.puffIndex++ % this.puffs.length]!;
    this.scene.tweens.killTweensOf(p);
    p.setFillStyle(colour);
    p.setPosition(x + Phaser.Math.FloatBetween(-1, 1), y + Phaser.Math.FloatBetween(-1, 1))
      .setScale(0.7 * size)
      .setAlpha(0.6 + 0.3 * strength);
    this.scene.tweens.add({
      targets: p,
      scale: Phaser.Math.FloatBetween(2.6, 3.8) * size,
      alpha: 0,
      x: p.x + Phaser.Math.FloatBetween(-4, 4) * size,
      y: p.y + Phaser.Math.FloatBetween(-4, 4) * size,
      duration: Phaser.Math.Between(900, 1300),
      ease: 'Quad.easeOut',
    });
  }

  private fadeMarks(dt: number): void {
    this.marks.clear();
    if (this.segments.length === 0) return;
    for (const m of this.segments) m.age += dt;
    this.segments = this.segments.filter((m) => m.age < DRIFT.markSeconds);
    for (const m of this.segments) {
      this.marks.lineStyle(2.2, 0x161616, 0.6 * (1 - m.age / DRIFT.markSeconds)).lineBetween(m.ax, m.ay, m.bx, m.by);
    }
  }
}
