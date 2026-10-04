import Phaser from 'phaser';
import { isLiveryUnlocked, LIVERIES, livery } from '../../engine/campaign/campaign';
import { scannerAudio } from '../audio/ScannerAudio';
import { loadProgress, saveProgress } from '../campaignStore';
import { GAME_HEIGHT, GAME_WIDTH } from '../layout';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { createPoliceCar } from '../render/actors';
import { Menu } from '../ui/ui';
import { openCommands } from './CommandsScene';

export interface PauseSceneData {
  /** The chase or escape underneath, frozen while the menu is open. */
  returnTo: string;
  /** Start the same chase again from the beginning. */
  retry: () => void;
  /** Leave the chase (to the title or the campaign folder). */
  quit: () => void;
  /** The police colours changed: the scene redraws its police car and officer. */
  liveryChanged?: () => void;
}

/**
 * The pause menu (ÉCHAP during a chase or an escape, Mr Henry 2026-10-03):
 * the chase and every sound freeze where they are. REPRENDRE (or ÉCHAP)
 * carries on, RECOMMENCER starts the same chase again, COMMANDES shows the
 * controls, VOITURE changes the police colours among those unlocked, and
 * QUITTER leaves.
 */
export class PauseScene extends Phaser.Scene {
  static readonly KEY = 'Pause';
  private opts!: PauseSceneData;
  private preview: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(PauseScene.KEY);
  }

  init(data: PauseSceneData): void {
    this.opts = data;
    this.preview = null;
  }

  create(): void {
    scannerAudio.pause(true);
    const cx = GAME_WIDTH / 2;
    const w = 560;
    const h = 470;
    const top = (GAME_HEIGHT - h) / 2;
    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05121a, 0.6).setInteractive();
    this.add.rectangle(cx + 8, GAME_HEIGHT / 2 + 10, w, h, 0x000000, 0.35);
    this.add.rectangle(cx, GAME_HEIGHT / 2, w, h, 0x10232d, 0.97).setStrokeStyle(3, PALETTE.lightBlue, 0.6);
    // The light bar flashing along the top, like the police car's.
    const red = this.add.rectangle(cx - w / 4, top + 3, w / 2, 6, 0xe0463a);
    const blue = this.add.rectangle(cx + w / 4, top + 3, w / 2, 6, 0x2f7de1).setAlpha(0.25);
    this.tweens.add({ targets: red, alpha: 0.25, duration: 420, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: blue, alpha: 1, duration: 420, yoyo: true, repeat: -1 });
    const title = this.add
      .text(cx, top + 52, 'PAUSE', { fontFamily: FONT_FAMILY, fontSize: '54px', fontStyle: 'bold', color: toCss(PALETTE.cream) })
      .setOrigin(0.5);
    this.tweens.add({ targets: title, scale: 1.05, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const menu = new Menu(this);
    const bw = 400;
    const bh = 54;
    let y = top + 132;
    const step = 68;
    menu.add(cx, y, bw, bh, 'REPRENDRE (ÉCHAP)', () => this.carryOn(), { size: 22 });
    menu.add(cx, (y += step), bw, bh, 'RECOMMENCER', () => this.leave(this.opts.retry), { size: 22 });
    menu.add(cx, (y += step), bw, bh, 'COMMANDES', () => openCommands(this), { size: 22 });
    const car = menu.add(cx, (y += step), bw, bh, this.carLabel(), () => {
      this.nextLivery();
      car.label.setText(this.carLabel());
    }, { size: 22 });
    menu.add(cx, (y += step), bw, bh, 'QUITTER LA POURSUITE', () => this.leave(this.opts.quit), { size: 22 });
    this.showPreview(cx + bw / 2 + 38, top + 132 + 3 * step);
    this.input.keyboard?.on('keydown-ESC', () => this.carryOn());
  }

  private carLabel(): string {
    return `VOITURE : ${livery(loadProgress().livery).name}  ▶`;
  }

  /** The next unlocked colours, saved for every chase from now on. */
  private nextLivery(): void {
    const progress = loadProgress();
    const unlocked = LIVERIES.filter((l) => isLiveryUnlocked(progress, l.id));
    const at = unlocked.findIndex((l) => l.id === progress.livery);
    const next = unlocked[(at + 1) % unlocked.length];
    if (!next || next.id === progress.livery) return;
    saveProgress({ ...progress, livery: next.id });
    this.showPreview(this.preview?.x ?? 0, this.preview?.y ?? 0);
    this.opts.liveryChanged?.();
  }

  /** The police car in the chosen colours, turning slowly beside its button. */
  private showPreview(x: number, y: number): void {
    const rotation = this.preview?.rotation ?? -Math.PI / 2;
    this.preview?.destroy();
    this.preview = createPoliceCar(this, livery(loadProgress().livery)).setPosition(x, y).setScale(2.8).setRotation(rotation);
    this.tweens.add({ targets: this.preview, rotation: rotation + Math.PI * 2, duration: 9000, repeat: -1 });
  }

  private carryOn(): void {
    scannerAudio.pause(false);
    this.scene.stop();
    this.scene.resume(this.opts.returnTo);
  }

  private leave(go: () => void): void {
    scannerAudio.stop();
    scannerAudio.pause(false);
    this.scene.stop();
    go();
  }
}
