import Phaser from 'phaser';
import type { ChaseStatus } from '../../engine/chase/chase';
import type { TravelMode } from '../../engine/world/graph';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';

/**
 * Chase HUD (blueprint section 19): mission number, timer, signal strength,
 * transport mode and short messages. The map keeps most of the screen; the
 * correct route is never drawn and there is no "CORRECT!" feedback.
 */
export class Hud {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly timer: Phaser.GameObjects.Text;
  private readonly mode: Phaser.GameObjects.Text;
  private readonly signalBars: Phaser.GameObjects.Rectangle[] = [];
  private readonly signalLabel: Phaser.GameObjects.Text;
  private readonly toast: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    mission: { number: number; total: number },
  ) {
    const { width } = scene.scale;
    const panel = (x: number, y: number, text: string, origin: [number, number], size = 20) =>
      this.add(
        scene.add
          .text(x, y, text, {
            fontFamily: FONT_FAMILY,
            fontSize: `${size}px`,
            fontStyle: 'bold',
            color: toCss(PALETTE.cream),
            backgroundColor: 'rgba(22, 50, 61, 0.85)',
            padding: { x: 12, y: 6 },
          })
          .setOrigin(...origin),
      );

    panel(16, 16, `MISSION ${mission.number} / ${mission.total}`, [0, 0]);
    this.timer = panel(width / 2, 16, '0:00', [0.5, 0], 26);
    this.mode = panel(width - 16, 16, '', [1, 0]);

    this.signalLabel = this.add(
      scene.add.text(16, 62, 'SIGNAL', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: 'bold',
        color: toCss(PALETTE.cream),
        backgroundColor: 'rgba(22, 50, 61, 0.85)',
        padding: { x: 8, y: 5 },
      }),
    );
    for (let i = 0; i < 5; i++) {
      this.signalBars.push(this.add(scene.add.rectangle(92 + i * 14, 88, 10, 10 + i * 4, PALETTE.cream).setOrigin(0, 1)));
    }

    this.toast = this.add(
      scene.add
        .text(width / 2, 74, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '22px',
          color: toCss(PALETTE.ink),
          backgroundColor: 'rgba(246, 236, 210, 0.95)',
          padding: { x: 14, y: 8 },
        })
        .setOrigin(0.5, 0)
        .setVisible(false),
    );
    this.banner = this.add(
      scene.add
        .text(width / 2, scene.scale.height / 2, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '96px',
          fontStyle: 'bold',
          color: toCss(PALETTE.cream),
          stroke: toCss(PALETTE.ink),
          strokeThickness: 10,
        })
        .setOrigin(0.5)
        .setVisible(false),
    );
  }

  update(status: ChaseStatus, mode: TravelMode): void {
    const seconds = Math.ceil(status.timeLeft);
    this.timer.setText(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    this.timer.setColor(seconds <= 15 ? '#ffb4a2' : toCss(PALETTE.cream));
    this.mode.setText(mode === 'CAR' ? 'EN VOITURE' : 'À PIED');

    const lit = Math.ceil(status.signal * 5);
    const colour = status.signal > 0.6 ? 0x6fcf7c : status.signal > 0.3 ? 0xe8c547 : 0xe0463a;
    this.signalBars.forEach((bar, i) => bar.setFillStyle(i < lit ? colour : 0x55656b, 1));
    const blink = status.warning && Math.floor(this.scene.time.now / 300) % 2 === 0;
    this.signalLabel.setColor(blink ? '#ffb4a2' : toCss(PALETTE.cream));
  }

  showToast(message: string, ms = 1600): void {
    this.toast.setText(message).setVisible(true).setAlpha(1);
    this.scene.tweens.killTweensOf(this.toast);
    this.scene.tweens.add({ targets: this.toast, alpha: 0, delay: ms, duration: 400 });
  }

  /** Big centred text, e.g. the 3-2-1-GO countdown. Empty string hides it. */
  showBanner(text: string): void {
    this.banner.setText(text).setVisible(text !== '');
  }

  private add<T extends Phaser.GameObjects.GameObject>(object: T): T {
    (object as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(150);
    this.objects.push(object);
    return object;
  }
}
