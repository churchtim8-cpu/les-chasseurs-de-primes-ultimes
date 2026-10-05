import Phaser from 'phaser';
import { actionSounds } from '../audio/ActionSounds';
import { FONT_FAMILY } from '../palette';

/**
 * Escape mode's extra drama (Mr Henry, 2026-10-05; drawing and sound only,
 * the escape itself is unchanged): the screen edges throb red to a heartbeat
 * while the police are right behind, and the hideout ("la planque") shows
 * itself as the fugitive gets close, then lights up when they make it.
 */
export const ESCAPE_FX = {
  danger: {
    /** The red at the screen edges: how strong when the police first close in, and when an arrest is a moment away. */
    alpha: { near: 0.6, caught: 0.9 },
    /** Seconds between heartbeats: a steady thump when they close in, racing as the arrest nears. */
    beat: { calm: 1.0, frantic: 0.42 },
    /** Drawn under the HUD panels, over the map. */
    depth: 90,
  },
  hideout: {
    /** The hideout shows itself once the fugitive is this close (metres, as the crow flies) on the last stretch. */
    revealWithin: 180,
    /** The ring on the ground at the hideout's door (metres) and the drawing order (over the town, under the cars). */
    ring: 8,
    depth: 25.5,
    colour: 0x2ed3a0,
  },
} as const;

/** The red throb at the edges of the screen, on the interface camera, with a heartbeat to match. */
export class DangerPulse {
  private readonly veil: Phaser.GameObjects.Image;
  private strength = 0;
  private untilBeat = 0;
  private beat = 0;

  constructor(scene: Phaser.Scene) {
    makeVignette(scene);
    const { width, height } = scene.scale;
    this.veil = scene.add.image(width / 2, height / 2, 'danger-vignette').setDisplaySize(width, height).setScrollFactor(0).setDepth(ESCAPE_FX.danger.depth).setAlpha(0);
  }

  get objects(): Phaser.GameObjects.GameObject[] {
    return [this.veil];
  }

  /** `near`: the police are right behind; `progress`: how close to an arrest (0 to 1). */
  update(near: boolean, progress: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.strength += ((near ? 1 : 0) - this.strength) * Math.min(1, dt * 4);
    if (this.strength < 0.02) {
      this.veil.setAlpha(0);
      this.untilBeat = 0;
      return;
    }
    const { alpha, beat } = ESCAPE_FX.danger;
    const period = Phaser.Math.Linear(beat.calm, beat.frantic, progress);
    this.untilBeat -= dt;
    if (this.untilBeat <= 0) {
      this.untilBeat = period;
      this.beat = 1;
      actionSounds.heartbeat(0.22 + 0.3 * progress);
    }
    this.beat = Math.max(0, this.beat - dt / (period * 0.75));
    this.veil.setAlpha(Phaser.Math.Linear(alpha.near, alpha.caught, progress) * this.strength * (0.4 + 0.6 * this.beat));
  }
}

/** The hideout's door: a pulsing ring on the ground and a sign above it, shown as the fugitive gets close. */
export class HideoutMarker {
  private readonly glow: Phaser.GameObjects.Arc;
  private readonly ring: Phaser.GameObjects.Arc;
  private readonly sign: Phaser.GameObjects.Container;
  private shown = 0;
  private clock = 0;
  private safe = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly at: { x: number; y: number },
  ) {
    const { ring, depth, colour } = ESCAPE_FX.hideout;
    this.glow = scene.add.circle(at.x, at.y, ring * 1.8, colour, 0.16).setDepth(depth).setVisible(false);
    this.ring = scene.add.circle(at.x, at.y, ring).setStrokeStyle(1.4, colour, 0.95).setDepth(depth + 0.01).setVisible(false);
    const label = scene.add.text(0, 0, '🏠 LA PLANQUE', { fontFamily: FONT_FAMILY, fontSize: '18px', fontStyle: 'bold', color: '#10202a' }).setOrigin(0.5);
    const box = scene.add.rectangle(0, 0, label.width + 22, label.height + 10, 0xffffff, 0.94).setStrokeStyle(3, colour);
    const point = scene.add.triangle(0, label.height / 2 + 10, -8, 0, 8, 0, 0, 9, colour);
    this.sign = scene.add.container(at.x, at.y, [point, box, label]).setDepth(depth + 0.02).setVisible(false);
  }

  get objects(): Phaser.GameObjects.GameObject[] {
    return [this.glow, this.ring, this.sign];
  }

  /** The sign is read upright whichever way the map is turned. */
  setUpright(rotation: number): void {
    this.sign.setRotation(rotation);
  }

  /** `near`: the fugitive is close on the last stretch; `zoom` keeps the sign the same size on the screen. */
  update(near: boolean, zoom: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.clock += dt;
    this.shown += ((near || this.safe ? 1 : 0) - this.shown) * Math.min(1, dt * 3);
    const visible = this.shown > 0.02;
    this.glow.setVisible(visible);
    this.ring.setVisible(visible);
    this.sign.setVisible(visible);
    if (!visible) return;
    const pulse = this.safe ? 1 : 1 + 0.22 * Math.sin(this.clock * 3.2);
    this.ring.setScale(pulse).setAlpha(this.shown);
    this.glow.setScale(this.safe ? 1.4 : 1 + 0.12 * Math.sin(this.clock * 3.2 + 1)).setAlpha(this.shown);
    const scale = 1 / zoom;
    const lift = (26 + (this.safe ? 0 : 2 * Math.sin(this.clock * 2.4))) * scale;
    this.sign
      .setScale(scale)
      .setAlpha(this.shown)
      .setPosition(this.at.x - lift * Math.sin(this.sign.rotation), this.at.y - lift * Math.cos(this.sign.rotation));
  }

  /** Made it: the ring bursts outwards in green sparks and the sign stays lit. */
  celebrate(): void {
    this.safe = true;
    const { colour, ring } = ESCAPE_FX.hideout;
    const burst = this.scene.add.circle(this.at.x, this.at.y, ring).setStrokeStyle(1.6, colour, 1).setDepth(ESCAPE_FX.hideout.depth + 0.015);
    this.scene.cameras.cameras.filter((c) => c !== this.scene.cameras.main).forEach((c) => c.ignore(burst));
    this.scene.tweens.add({ targets: burst, scale: 5, alpha: 0, duration: 900, ease: 'Quad.easeOut', onComplete: () => burst.destroy() });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const spark = this.scene.add.circle(this.at.x, this.at.y, 0.9, i % 3 === 0 ? 0xffffff : colour).setDepth(41);
      this.scene.cameras.cameras.filter((c) => c !== this.scene.cameras.main).forEach((c) => c.ignore(spark));
      this.scene.tweens.add({
        targets: spark,
        x: this.at.x + Math.cos(a) * (14 + (i % 2) * 6),
        y: this.at.y + Math.sin(a) * (14 + (i % 2) * 6),
        scale: 0.2,
        alpha: 0,
        duration: 800,
        delay: i * 25,
        ease: 'Quad.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }
}

/** A picture the size of the screen: clear in the middle, red at the edges and corners. */
function makeVignette(scene: Phaser.Scene): void {
  if (scene.textures.exists('danger-vignette')) return;
  const w = 512;
  const h = 288;
  const tex = scene.textures.createCanvas('danger-vignette', w, h);
  const ctx = tex?.getContext();
  if (!tex || !ctx) return;
  const gradient = ctx.createRadialGradient(w / 2, h / 2, h * 0.42, w / 2, h / 2, h * 0.98);
  gradient.addColorStop(0, 'rgba(214, 40, 40, 0)');
  gradient.addColorStop(0.5, 'rgba(214, 40, 40, 0.5)');
  gradient.addColorStop(1, 'rgba(170, 16, 28, 1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  tex.refresh();
}
