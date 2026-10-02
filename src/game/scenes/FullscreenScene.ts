import Phaser from 'phaser';
import { FULLSCREEN_BUTTON } from '../layout';
import { PALETTE } from '../palette';

/**
 * Always-running scene with the full-screen button in the top right corner,
 * on every screen. A click or tap (or F) switches full screen on and off;
 * the icon shows which way it will go.
 */
export class FullscreenScene extends Phaser.Scene {
  static readonly KEY = 'Fullscreen';

  constructor() {
    super(FullscreenScene.KEY);
  }

  create(): void {
    const { x, y, size } = FULLSCREEN_BUTTON;
    const bg = this.add
      .rectangle(x, y, size, size, PALETTE.ink, 0.6)
      .setStrokeStyle(2, PALETTE.cream, 0.8)
      .setInteractive({ useHandCursor: true });
    const icon = this.add.graphics();
    const draw = () => {
      icon.clear().lineStyle(3, PALETTE.cream);
      const r = size * 0.28;
      const k = size * 0.14;
      const inward = this.scale.isFullscreen;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const cx = x + sx * r;
        const cy = y + sy * r;
        // Corners pointing out (go full screen) or in (leave full screen).
        const d = inward ? -1 : 1;
        icon.lineBetween(cx, cy, cx - sx * k * d * 1.6, cy);
        icon.lineBetween(cx, cy, cx, cy - sy * k * d * 1.6);
      }
    };
    draw();
    const toggle = () => this.scale.toggleFullscreen();
    bg.on('pointerover', () => bg.setFillStyle(PALETTE.terracotta, 0.8));
    bg.on('pointerout', () => bg.setFillStyle(PALETTE.ink, 0.6));
    // Browsers only allow full screen from a click or key press, which pointerup is.
    bg.on('pointerup', toggle);
    this.input.keyboard?.on('keydown-F', toggle);
    this.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, draw);
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, draw);
    // Hidden where the browser has no full screen (some phones).
    if (!this.sys.game.device.fullscreen.available) {
      bg.setVisible(false);
      icon.setVisible(false);
    }
  }
}
