import Phaser from 'phaser';
import type { TravelMode } from '../../engine/world/graph';

/**
 * Camera behaviour by transport state (blueprint section 7):
 *   CAR:  wider view, more streets visible, looks further ahead.
 *   FOOT: closer view, larger player, landmarks and paths easier to read.
 * Switching modes zooms smoothly instead of cutting.
 */
export interface CameraProfile {
  /** World metres visible across the screen width. */
  viewWidth: number;
  /** How far ahead of the player (metres) the camera aims. */
  lookAhead: number;
  /** Follow smoothing per second (higher = snappier). */
  follow: number;
  /** Look-ahead when the map turns with the player: the player sits low on screen, the way ahead fills it. */
  turnedLookAhead: number;
}

export const CAMERA_PROFILES: Record<TravelMode, CameraProfile> = {
  CAR: { viewWidth: 880, lookAhead: 140, follow: 3.5, turnedLookAhead: 160 },
  FOOT: { viewWidth: 360, lookAhead: 30, follow: 6, turnedLookAhead: 55 },
};

const TRANSITION_MS = 900;
/** How quickly the turning map catches up with the player's heading (per second). */
const TURN_FOLLOW = 3;

/**
 * Which way the map faces. FOOT (the default): on foot the map turns so the
 * officer always runs up the screen, and "à gauche" is always the screen's
 * left; in the car north stays up. ALWAYS turns it in the car too; NORTH never.
 */
export type MapFacing = 'FOOT' | 'ALWAYS' | 'NORTH';
export const MAP_FACINGS: MapFacing[] = ['FOOT', 'ALWAYS', 'NORTH'];

export class CameraRig {
  private mode: TravelMode;
  private overview = false;
  private zoomTween?: Phaser.Tweens.Tween;
  private readonly aim = new Phaser.Math.Vector2();
  private initialised = false;
  private facing: MapFacing = 'FOOT';
  private turned = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    private readonly world: { width: number; height: number },
    mode: TravelMode,
  ) {
    this.mode = mode;
    camera.setBounds(0, 0, world.width, world.height);
    camera.setZoom(this.zoomFor(mode));
  }

  get isOverview(): boolean {
    return this.overview;
  }

  setMode(mode: TravelMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (!this.overview) this.tweenZoom(this.zoomFor(mode));
  }

  setFacing(facing: MapFacing): void {
    this.facing = facing;
  }

  /** How far the map is turned on screen (radians). */
  get rotation(): number {
    return this.turned;
  }

  /** True when the map turns with the player in the current mode. */
  get headingUp(): boolean {
    return !this.overview && (this.facing === 'ALWAYS' || (this.facing === 'FOOT' && this.mode === 'FOOT'));
  }

  toggleOverview(): void {
    this.overview = !this.overview;
    this.tweenZoom(this.overview ? this.fitZoom() : this.zoomFor(this.mode));
  }

  /** Call every frame with the player's position and heading. */
  update(target: { x: number; y: number; heading: number }, deltaMs: number): void {
    const profile = CAMERA_PROFILES[this.mode];
    const ahead = this.headingUp ? profile.turnedLookAhead : profile.lookAhead;
    const goalX = this.overview ? this.world.width / 2 : target.x + Math.cos(target.heading) * ahead;
    const goalY = this.overview ? this.world.height / 2 : target.y + Math.sin(target.heading) * ahead;
    if (!this.initialised) {
      this.aim.set(goalX, goalY);
      this.initialised = true;
    }
    const k = 1 - Math.exp((-profile.follow * deltaMs) / 1000);
    this.aim.x += (goalX - this.aim.x) * k;
    this.aim.y += (goalY - this.aim.y) * k;
    // Turn the map so the heading points up the screen (a screen angle of -90°).
    const goalRotation = this.headingUp ? Phaser.Math.Angle.Wrap(-Math.PI / 2 - target.heading) : 0;
    const turn = Phaser.Math.Angle.Wrap(goalRotation - this.turned);
    const kTurn = 1 - Math.exp((-TURN_FOLLOW * deltaMs) / 1000);
    this.turned = Math.abs(turn) < 0.001 ? goalRotation : Phaser.Math.Angle.Wrap(this.turned + turn * kTurn);
    this.camera.setRotation(this.turned);
    // Bounds keep the view inside the town, but they assume an upright view.
    this.camera.useBounds = this.turned === 0;
    this.camera.centerOn(this.aim.x, this.aim.y);
  }

  private zoomFor(mode: TravelMode): number {
    return this.camera.width / CAMERA_PROFILES[mode].viewWidth;
  }

  private fitZoom(): number {
    return Math.max(this.camera.width / this.world.width, this.camera.height / this.world.height);
  }

  private tweenZoom(zoom: number): void {
    this.zoomTween?.stop();
    this.zoomTween = this.scene.tweens.add({
      targets: this.camera,
      zoom,
      duration: TRANSITION_MS,
      ease: 'Sine.easeInOut',
    });
  }
}
