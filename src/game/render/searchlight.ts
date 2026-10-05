import Phaser from 'phaser';
import { NIGHT } from './night';

/**
 * A police helicopter out at night (Mr Henry, 2026-10-05; drawing only): its
 * searchlight sweeps the streets around the player in slow loops, with the
 * helicopter itself, rotor turning, drawn high above the town and its shadow
 * sliding over the roofs below.
 */
export const SEARCHLIGHT = {
  /** The pool of light on the ground: radius (metres), colour and brightness. */
  beam: { radius: 30, colour: 0xfff1c0, alpha: 0.5 },
  /** How far the light wanders from the player (metres) and how fast (turns per second, two rhythms so the path loops rather than circles). */
  orbit: { x: 120, y: 80, a: 0.11, b: 0.07 },
  /** The helicopter: size (metres), rotor turns per second, drawn above everything; its shadow lags behind on the ground. */
  heli: { size: 9, rotorRps: 7, depth: 62, shadowOffset: { x: 16, y: 12 } },
} as const;

export class Searchlight {
  private readonly beam: Phaser.GameObjects.Image;
  private readonly heli: Phaser.GameObjects.Container;
  private readonly rotor: Phaser.GameObjects.Graphics;
  private readonly shadow: Phaser.GameObjects.Graphics;
  private spot: { x: number; y: number } | null = null;
  private clock = 0;

  constructor(scene: Phaser.Scene) {
    makeBeam(scene);
    const { beam, heli } = SEARCHLIGHT;
    this.beam = scene.add.image(0, 0, 'searchlight-beam').setDisplaySize(beam.radius * 2, beam.radius * 2).setBlendMode(Phaser.BlendModes.ADD).setDepth(NIGHT.depth.lights + 0.05).setAlpha(beam.alpha);
    const s = heli.size;
    const body = scene.add.graphics();
    body.fillStyle(0x1b2a44).fillEllipse(0, 0, s * 1.1, s * 0.6).fillRect(-s * 1.1, -s * 0.12, s * 0.8, s * 0.24).fillRect(-s * 1.25, -s * 0.3, s * 0.18, s * 0.6);
    body.fillStyle(0xd62828).fillRect(-s * 0.55, -s * 0.2, s * 0.2, s * 0.4);
    body.fillStyle(0x8fd3ff, 0.9).fillEllipse(s * 0.32, 0, s * 0.3, s * 0.36);
    body.fillStyle(0xffffff).fillCircle(s * 0.55, 0, s * 0.08);
    this.rotor = scene.add.graphics();
    this.rotor.fillStyle(0x0d1420, 0.85).fillRect(-s * 0.95, -s * 0.05, s * 1.9, s * 0.1).fillRect(-s * 0.05, -s * 0.95, s * 0.1, s * 1.9);
    this.rotor.fillStyle(0x3a4a66).fillCircle(0, 0, s * 0.1);
    this.heli = scene.add.container(0, 0, [body, this.rotor]).setDepth(heli.depth);
    this.shadow = scene.add.graphics().setDepth(NIGHT.depth.dark - 0.1);
    this.shadow.fillStyle(0x000000, 0.2).fillEllipse(0, 0, s * 1.3, s * 0.7).fillRect(-s * 1.2, -s * 0.12, s * 0.8, s * 0.24);
  }

  /** Everything this draws, to keep off the interface camera. */
  get objects(): Phaser.GameObjects.GameObject[] {
    return [this.beam, this.heli, this.shadow];
  }

  update(around: { x: number; y: number }, deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.clock += dt;
    const { orbit, heli } = SEARCHLIGHT;
    const aim = {
      x: around.x + Math.sin(this.clock * orbit.a * Math.PI * 2) * orbit.x,
      y: around.y + Math.cos(this.clock * orbit.b * Math.PI * 2) * orbit.y,
    };
    const was = this.spot ?? aim;
    // The light slides after its aim rather than jumping, so it looks swept.
    const spot = { x: was.x + (aim.x - was.x) * Math.min(1, dt * 1.5), y: was.y + (aim.y - was.y) * Math.min(1, dt * 1.5) };
    this.spot = spot;
    this.beam.setPosition(spot.x, spot.y);
    const heading = Math.atan2(spot.y - was.y, spot.x - was.x);
    if (Math.hypot(spot.x - was.x, spot.y - was.y) > 0.05) this.heli.setRotation(heading);
    // The helicopter flies a little behind its light; the shadow trails further, on the ground.
    this.heli.setPosition(spot.x - 10, spot.y - 14);
    this.shadow.setPosition(spot.x - 10 + heli.shadowOffset.x, spot.y - 14 + heli.shadowOffset.y).setRotation(this.heli.rotation);
    this.rotor.setRotation(this.rotor.rotation + dt * heli.rotorRps * Math.PI * 2);
  }
}

/** A soft round pool of light: bright in the middle, fading to nothing at the edge. */
function makeBeam(scene: Phaser.Scene): void {
  if (scene.textures.exists('searchlight-beam')) return;
  const size = 128;
  const tex = scene.textures.createCanvas('searchlight-beam', size, size);
  const ctx = tex?.getContext();
  if (!tex || !ctx) return;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 241, 192, 1)');
  gradient.addColorStop(0.5, 'rgba(255, 241, 192, 0.5)');
  gradient.addColorStop(1, 'rgba(255, 241, 192, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}
