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
}

export const CAMERA_PROFILES: Record<TravelMode, CameraProfile> = {
  CAR: { viewWidth: 880, lookAhead: 140, follow: 3.5 },
  FOOT: { viewWidth: 480, lookAhead: 35, follow: 6 },
};

const TRANSITION_MS = 900;
/** On foot the view bobs with the officer's stride (metres of sway, strides per metre run). */
const BOB_METRES = 1.1;
const STRIDES_PER_METRE = 0.12;

export class CameraRig {
  private mode: TravelMode;
  private overview = false;
  private zoomTween?: Phaser.Tweens.Tween;
  private readonly aim = new Phaser.Math.Vector2();
  private initialised = false;
  /** Running bob on foot (the view jogs a little with each stride). */
  private stride = 0;

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

  toggleOverview(): void {
    this.overview = !this.overview;
    this.tweenZoom(this.overview ? this.fitZoom() : this.zoomFor(this.mode));
  }

  /** Call every frame with the player's position and heading. */
  update(target: { x: number; y: number; heading: number; speed?: number }, deltaMs: number): void {
    const profile = CAMERA_PROFILES[this.mode];
    const goalX = this.overview ? this.world.width / 2 : target.x + Math.cos(target.heading) * profile.lookAhead;
    const goalY = this.overview ? this.world.height / 2 : target.y + Math.sin(target.heading) * profile.lookAhead;
    if (!this.initialised) {
      this.aim.set(goalX, goalY);
      this.initialised = true;
    }
    const k = 1 - Math.exp((-profile.follow * deltaMs) / 1000);
    this.aim.x += (goalX - this.aim.x) * k;
    this.aim.y += (goalY - this.aim.y) * k;
    let bobX = 0;
    let bobY = 0;
    if (this.mode === 'FOOT' && !this.overview && (target.speed ?? 0) > 2) {
      this.stride += (deltaMs / 1000) * (target.speed ?? 0) * STRIDES_PER_METRE * Math.PI * 2;
      // Up-down with every step, side to side with every second step, across the running direction.
      const side = Math.sin(this.stride / 2) * BOB_METRES * 0.6;
      const up = Math.abs(Math.sin(this.stride)) * BOB_METRES;
      bobX = -Math.sin(target.heading) * side + Math.cos(target.heading) * up;
      bobY = Math.cos(target.heading) * side + Math.sin(target.heading) * up;
    }
    this.camera.centerOn(this.aim.x + bobX, this.aim.y + bobY);
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
