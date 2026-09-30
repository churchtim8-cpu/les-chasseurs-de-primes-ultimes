import Phaser from 'phaser';
import { DIFFICULTY_SETTINGS, parseSeed, type ChaseSeed } from '../../engine';
import { debugState } from '../debug/debugState';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { newSeed } from '../seedSource';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/**
 * Title screen. Starting creates a chase seed (or uses `?seed=` from the
 * address, so a chase can be replayed exactly) and opens the chase; later
 * milestones go through difficulty selection and the mission briefing.
 */
export class TitleScene extends Phaser.Scene {
  static readonly KEY = 'Title';
  private seed?: ChaseSeed;

  constructor() {
    super(TitleScene.KEY);
  }

  private autostart = false;

  init(data?: { autostart?: boolean }): void {
    this.autostart = data?.autostart === true;
  }

  create(): void {
    if (this.autostart) {
      this.start();
      return;
    }
    this.drawBackdrop();

    this.add
      .text(GAME_WIDTH / 2, 190, 'Les Chasseurs de Primes Ultimes', {
        fontFamily: FONT_FAMILY,
        fontSize: '58px',
        fontStyle: 'bold',
        color: toCss(PALETTE.ink),
        stroke: toCss(PALETTE.cream),
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, 262, 'BELLEVUE CITY', {
        fontFamily: FONT_FAMILY,
        fontSize: '28px',
        color: toCss(PALETTE.terracotta),
        letterSpacing: 10,
      })
      .setOrigin(0.5);

    const prompt = this.add
      .text(GAME_WIDTH / 2, 380, 'Appuyez sur ENTRÉE ou touchez l’écran pour commencer', {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        color: toCss(PALETTE.ink),
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 900, yoyo: true, repeat: -1 });

    this.input.keyboard?.on('keydown-ENTER', () => this.start());
    this.input.keyboard?.on('keydown-SPACE', () => this.start());
    this.input.on('pointerdown', () => this.start());
  }

  private start(): void {
    this.seed = this.seedFromAddress() ?? newSeed('EASY');
    debugState.info.set('seed', this.seed.code);
    debugState.info.set('difficulty', DIFFICULTY_SETTINGS[this.seed.difficulty].label.en);
    this.scene.start('Chase', { seed: this.seed.code });
  }

  /** `?seed=BV-E-...` replays one chase; it is used once, then fresh seeds follow. */
  private seedFromAddress(): ChaseSeed | undefined {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('seed');
    if (!code) return undefined;
    params.delete('seed');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    const parsed = parseSeed(code);
    return parsed.ok ? parsed.seed : undefined;
  }

  /** A simple top-down coastline: town blocks, a promenade, sand and sea. */
  private drawBackdrop(): void {
    const g = this.add.graphics();
    g.fillStyle(PALETTE.cream).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Street grid with town blocks and roofs.
    g.fillStyle(PALETTE.road);
    for (let x = 0; x < GAME_WIDTH; x += 160) g.fillRect(x + 140, 0, 20, 540);
    g.fillRect(0, 100, GAME_WIDTH, 16);
    g.fillRect(0, 300, GAME_WIDTH, 16);
    g.fillRect(0, 500, GAME_WIDTH, 20);
    const roofs = [PALETTE.terracotta, PALETTE.roof, PALETTE.softRed, PALETTE.paleYellow];
    let i = 0;
    for (let x = 0; x < GAME_WIDTH; x += 160) {
      for (const y of [18, 124, 330]) {
        g.fillStyle(roofs[i++ % roofs.length] as number, 0.22);
        g.fillRoundedRect(x + 14, y, 112, y === 124 ? 164 : 66, 8);
      }
    }

    // Sand and sea along the bottom edge.
    g.fillStyle(PALETTE.stone).fillRect(0, 520, GAME_WIDTH, 24);
    g.fillStyle(PALETTE.sand).fillRect(0, 544, GAME_WIDTH, 64);
    g.fillStyle(PALETTE.sea).fillRect(0, 608, GAME_WIDTH, GAME_HEIGHT - 608);
    g.fillStyle(PALETTE.seaDeep).fillRect(0, 672, GAME_WIDTH, GAME_HEIGHT - 672);
    g.lineStyle(3, PALETTE.lightBlue, 0.8);
    for (let x = 0; x < GAME_WIDTH; x += 80) {
      g.beginPath();
      g.arc(x + 40, 640, 18, Math.PI * 1.15, Math.PI * 1.85);
      g.strokePath();
    }
  }
}
