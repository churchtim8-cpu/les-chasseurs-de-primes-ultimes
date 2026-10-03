import Phaser from 'phaser';
import { actionSounds } from '../audio/ActionSounds';
import type { DriftEffects } from './drift';

/**
 * The suspect's last-second escapes, played out on the map (drawing and sound
 * only: the chase engine has already moved everyone).
 *
 * A crash: the suspect's car slides off into the kerb with a bang, steam hisses
 * from the bonnet, and the suspect is seen running off. A U-turn in a car: the
 * suspect's car spins round in tyre smoke. A U-turn on foot: the officer
 * tumbles over and gets back up.
 */
const ESCAPE = {
  /** Seconds the crashing car slides before it hits, how far forward (map units) and how askew it ends up (radians). */
  crashSlide: 0.45,
  crashForward: 16,
  askew: 0.75,
  /** A wisp of steam this often (s), for this long after the crash (s). */
  steamEvery: 0.2,
  steamSeconds: 30,
  /** The suspect stays in view this long after crashing or turning round (s): the player sees them run off. */
  revealSeconds: { crash: 5, dodge: 3 },
  /** The suspect's car spins round over this long (s), smoking its tyres. */
  spinSeconds: 0.8,
  /** The officer's tumble: how far they turn as they fall (radians), how long the fall and getting up take (s). */
  fallTurn: 1.45,
  fallIn: 0.22,
  getUp: 0.35,
};

export interface Pose {
  x: number;
  y: number;
  rotation: number;
}

export class EscapeEffects {
  private readonly wrecks: { car: Phaser.GameObjects.Container; age: number; clock: number }[] = [];
  private revealLeft = 0;
  private spinLeft = 0;
  private fall: { t: number; down: number } | null = null;
  /** Cartoon stars circling a fallen officer's head. */
  private readonly stars: Phaser.GameObjects.Star[];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly drift: DriftEffects,
  ) {
    this.stars = [0, 1, 2].map(() =>
      scene.add.star(0, 0, 5, 0.9, 2.1, 0xffd23f).setStrokeStyle(0.4, 0x8a5a00).setDepth(31).setVisible(false),
    );
  }

  /** The objects to keep off the interface camera. */
  get objects(): Phaser.GameObjects.GameObject[] {
    return this.stars;
  }

  /** Keep the suspect on the map for now, whatever the distance. */
  get revealing(): boolean {
    return this.revealLeft > 0;
  }

  /** The suspect's car is spinning round: its heading eases round more slowly. */
  get spinning(): boolean {
    return this.spinLeft > 0;
  }

  /** The suspect's car slides from where it is drawn towards `rest` (by the kerb, facing along the road) and crashes. */
  crash(car: Phaser.GameObjects.Container, rest: Pose): void {
    const turn = Phaser.Math.Angle.Wrap(rest.rotation - car.rotation);
    const end = { x: rest.x + Math.cos(rest.rotation) * ESCAPE.crashForward, y: rest.y + Math.sin(rest.rotation) * ESCAPE.crashForward };
    const askewed = car.rotation + turn + ESCAPE.askew;
    car.setAlpha(1).setVisible(true);
    actionSounds.screech(ESCAPE.crashSlide + 0.1, 0.2);
    this.scene.tweens.add({
      targets: car,
      x: end.x,
      y: end.y,
      rotation: askewed,
      duration: ESCAPE.crashSlide * 1000,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.drift.tyres('wreck', car.x, car.y, car.rotation, 1, this.scene.game.loop.delta / 1000);
      },
      onComplete: () => {
        this.drift.lift('wreck');
        const front = { x: car.x + Math.cos(car.rotation) * 8, y: car.y + Math.sin(car.rotation) * 8 };
        this.drift.smash(front.x, front.y, 12);
        actionSounds.crash();
        actionSounds.steam(3);
        this.wrecks.push({ car, age: 0, clock: 0 });
      },
    });
    this.revealLeft = ESCAPE.revealSeconds.crash;
  }

  /** The suspect turns round: a spin in tyre smoke (car), or the officer falls over (on foot). */
  dodge(mode: 'CAR' | 'FOOT', downSeconds: number, officer: Pose): void {
    this.revealLeft = ESCAPE.revealSeconds.dodge;
    actionSounds.whoosh();
    if (mode === 'CAR') {
      this.spinLeft = ESCAPE.spinSeconds;
      actionSounds.screech(1.1, 0.26);
      return;
    }
    this.fall = { t: 0, down: downSeconds };
    this.scene.time.delayedCall(ESCAPE.fallIn * 1000, () => {
      actionSounds.thud(0.45);
      actionSounds.oof();
      this.drift.dust(officer.x, officer.y, 8);
    });
  }

  /**
   * Call every frame. `suspectCar` is the suspect's car while it spins (null on foot).
   * Returns how far to turn the officer as they tumble (radians).
   */
  update(delta: number, suspectCar: Pose | null, officer: Pose): number {
    const dt = delta / 1000;
    this.revealLeft = Math.max(0, this.revealLeft - dt);
    if (this.spinLeft > 0) {
      this.spinLeft = Math.max(0, this.spinLeft - dt);
      if (suspectCar && this.spinLeft > 0) this.drift.tyres('spin', suspectCar.x, suspectCar.y, suspectCar.rotation, 1, dt);
      else this.drift.lift('spin');
    }
    for (const w of this.wrecks) {
      w.age += dt;
      w.clock += dt;
      if (w.age > ESCAPE.steamSeconds || w.clock < ESCAPE.steamEvery) continue;
      w.clock = 0;
      const c = w.car;
      this.drift.steam(c.x + Math.cos(c.rotation) * 6, c.y + Math.sin(c.rotation) * 6);
    }
    if (!this.fall) {
      for (const star of this.stars) star.setVisible(false);
      return 0;
    }
    const f = this.fall;
    f.t += dt;
    const up = f.t - f.down;
    const k = up > 0 ? Math.max(0, 1 - up / ESCAPE.getUp) : Math.min(1, f.t / ESCAPE.fallIn);
    if (up > ESCAPE.getUp) this.fall = null;
    // Dazed: stars spin round the officer's head while they are down.
    const dazed = f.t > ESCAPE.fallIn && up < 0;
    this.stars.forEach((star, i) => {
      const a = f.t * 5 + (i * Math.PI * 2) / this.stars.length;
      star
        .setVisible(dazed)
        .setPosition(officer.x + Math.cos(a) * 6, officer.y + Math.sin(a) * 4)
        .setRotation(f.t * 4);
    });
    return ESCAPE.fallTurn * k;
  }
}
