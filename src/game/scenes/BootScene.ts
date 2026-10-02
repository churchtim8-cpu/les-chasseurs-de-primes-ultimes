import Phaser from 'phaser';
import { MISSIONS } from '../../engine/campaign/campaign';
import { scannerAudio } from '../audio/ScannerAudio';
import { preloadCanvaArt } from '../render/canvaArt';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { backdrop, preloadScreenPictures, SCREEN_PICTURES } from '../ui/ui';

/**
 * Loading screen: shows the Canva loading picture with a progress bar while
 * the town pictures, screen pictures and the list of French recordings load,
 * then opens the title screen. Anything that fails to load falls back to the
 * drawn look, so a slow or broken connection never stops the game.
 */
export class BootScene extends Phaser.Scene {
  static readonly KEY = 'Boot';

  constructor() {
    super(BootScene.KEY);
  }

  preload(): void {
    this.load.image(SCREEN_PICTURES.loading, `${import.meta.env.BASE_URL}images/m8/loading.jpg`);
  }

  create(): void {
    const { width, height } = this.scale;
    backdrop(this, SCREEN_PICTURES.loading);
    this.add.rectangle(width / 2, height - 92, 760, 104, PALETTE.cream, 0.9).setStrokeStyle(3, PALETTE.ink, 0.6);
    const title = this.add
      .text(width / 2, height - 122, 'Chargement…', {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        fontStyle: 'bold',
        color: toCss(PALETTE.ink),
      })
      .setOrigin(0.5);
    const barWidth = 640;
    this.add.rectangle(width / 2, height - 76, barWidth, 24, PALETTE.stone).setStrokeStyle(2, PALETTE.ink);
    const bar = this.add.rectangle(width / 2 - barWidth / 2 + 2, height - 76, 0, 18, PALETTE.terracotta).setOrigin(0, 0.5);
    this.load.on(Phaser.Loader.Events.PROGRESS, (share: number) => bar.setSize((barWidth - 4) * share, 18));

    // Which French recordings exist (public/audio/manifest.json). Missing is fine: text only.
    if (!this.cache.json.exists('audio-manifest')) this.load.json('audio-manifest', `${import.meta.env.BASE_URL}audio/manifest.json`);
    if (!this.textures.exists('title-picture')) this.load.image('title-picture', `${import.meta.env.BASE_URL}images/title.jpg`);
    preloadScreenPictures(this, MISSIONS.map((m) => m.picture));
    preloadCanvaArt(this);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      bar.setSize(barWidth - 4, 18);
      this.time.delayedCall(250, () => this.ready(title, bar));
    });
    this.load.start();
  }

  /**
   * Browsers only allow sound after a key press or tap, so the title music
   * can start with the title screen: "press a key" first, unless sound is
   * already allowed (or a test browser is driving the game).
   */
  private ready(title: Phaser.GameObjects.Text, bar: Phaser.GameObjects.Rectangle): void {
    if (scannerAudio.running || navigator.webdriver) {
      this.scene.start('Title');
      return;
    }
    bar.setFillStyle(0x2e8b57);
    title.setText('Prêt ! Appuyez sur une touche ou touchez l’écran');
    this.tweens.add({ targets: title, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
    const go = () => {
      scannerAudio.unlock();
      this.scene.start('Title');
    };
    this.input.keyboard?.once('keydown', go);
    this.input.once('pointerdown', go);
  }
}
