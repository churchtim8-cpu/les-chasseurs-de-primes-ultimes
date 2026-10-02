import Phaser from 'phaser';
import { DIFFICULTIES, DIFFICULTY_SETTINGS, parseSeed, type ChaseSeed, type Difficulty } from '../../engine';
import type { AudioManifest } from '../../engine/audio/manifest';
import { scannerAudio } from '../audio/ScannerAudio';
import { debugState } from '../debug/debugState';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { newSeed } from '../seedSource';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
const TITLE_PICTURE = 'title-picture';

const LEVEL_KEY = 'chasseurs.level';

/** The level last played, so "next chase" and the next visit start there. */
function loadLevel(): Difficulty {
  try {
    const saved = window.localStorage.getItem(LEVEL_KEY);
    return (DIFFICULTIES as readonly string[]).includes(saved ?? '') ? (saved as Difficulty) : 'EASY';
  } catch {
    return 'EASY';
  }
}

function saveLevel(level: Difficulty): void {
  try {
    window.localStorage.setItem(LEVEL_KEY, level);
  } catch {
    // Private windows can refuse storage; the level is then remembered for this visit only.
  }
}

/**
 * Title screen with the level picker. Starting creates a chase seed at the
 * chosen level (or uses `?seed=` from the address, so a chase can be replayed
 * exactly) and opens the chase; the campaign and mission briefing come later.
 */
export class TitleScene extends Phaser.Scene {
  static readonly KEY = 'Title';
  private seed?: ChaseSeed;
  private static level: Difficulty | null = null;
  private levelButtons: { level: Difficulty; box: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];

  constructor() {
    super(TitleScene.KEY);
  }

  private autostart = false;

  init(data?: { autostart?: boolean }): void {
    this.autostart = data?.autostart === true;
  }

  preload(): void {
    // Which French recordings exist (public/audio/manifest.json). Missing is fine: text only.
    if (!this.cache.json.exists('audio-manifest')) this.load.json('audio-manifest', `${import.meta.env.BASE_URL}audio/manifest.json`);
    // The title picture (AI-generated, 155 KB). If it fails to load the drawn backdrop shows instead.
    if (!this.textures.exists(TITLE_PICTURE)) this.load.image(TITLE_PICTURE, `${import.meta.env.BASE_URL}images/title.jpg`);
  }

  create(): void {
    scannerAudio.setManifest(this.cache.json.get('audio-manifest') as AudioManifest | undefined);
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

    this.add
      .text(GAME_WIDTH / 2, 352, 'Choisissez un niveau', {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        color: toCss(PALETTE.ink),
      })
      .setOrigin(0.5);

    const width = 262;
    const gap = 16;
    const left = GAME_WIDTH / 2 - (DIFFICULTIES.length * width + (DIFFICULTIES.length - 1) * gap) / 2;
    this.levelButtons = DIFFICULTIES.map((level, i) => {
      const x = left + i * (width + gap) + width / 2;
      const box = this.add
        .rectangle(x, 420, width, 64, PALETTE.cream)
        .setStrokeStyle(3, PALETTE.ink)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(x, 420, `${i + 1}  ${DIFFICULTY_SETTINGS[level].label.fr}`, {
          fontFamily: FONT_FAMILY,
          fontSize: '26px',
          fontStyle: 'bold',
          color: toCss(PALETTE.ink),
        })
        .setOrigin(0.5);
      box.on('pointerover', () => this.select(level));
      box.on('pointerdown', () => this.start(level));
      return { level, box, label };
    });
    this.select(TitleScene.currentLevel);

    const prompt = this.add
      .text(GAME_WIDTH / 2, 482, 'Touchez un niveau, ou appuyez sur 1 à 4 puis ENTRÉE', {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        color: toCss(PALETTE.ink),
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 900, yoyo: true, repeat: -1 });

    const keyboard = this.input.keyboard;
    DIFFICULTIES.forEach((level, i) => {
      const names = ['ONE', 'TWO', 'THREE', 'FOUR'];
      keyboard?.on(`keydown-${names[i]}`, () => this.select(level));
      keyboard?.on(`keydown-NUMPAD_${names[i]}`, () => this.select(level));
    });
    const step = (by: number) => {
      const i = DIFFICULTIES.indexOf(TitleScene.currentLevel);
      this.select(DIFFICULTIES[Math.max(0, Math.min(DIFFICULTIES.length - 1, i + by))] as Difficulty);
    };
    keyboard?.on('keydown-LEFT', () => step(-1));
    keyboard?.on('keydown-RIGHT', () => step(1));
    keyboard?.on('keydown-ENTER', () => this.start());
    keyboard?.on('keydown-SPACE', () => this.start());
  }

  private static get currentLevel(): Difficulty {
    TitleScene.level ??= loadLevel();
    return TitleScene.level;
  }

  private select(level: Difficulty): void {
    TitleScene.level = level;
    for (const button of this.levelButtons) {
      const on = button.level === level;
      button.box.setFillStyle(on ? PALETTE.terracotta : PALETTE.cream);
      button.label.setColor(toCss(on ? PALETTE.cream : PALETTE.ink));
    }
  }

  private start(level?: Difficulty): void {
    if (level) this.select(level);
    this.seed = this.seedFromAddress() ?? newSeed(TitleScene.currentLevel);
    // Replaying a shared seed sets the level for the chases that follow.
    TitleScene.level = this.seed.difficulty;
    saveLevel(this.seed.difficulty);
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

  /** The title picture behind a soft panel that keeps the words easy to read. */
  private drawBackdrop(): void {
    if (!this.textures.exists(TITLE_PICTURE)) {
      this.drawPlainBackdrop();
      return;
    }
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, TITLE_PICTURE).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.add.rectangle(GAME_WIDTH / 2, 336, 1180, 360, PALETTE.cream, 0.75).setStrokeStyle(3, PALETTE.ink, 0.5);
  }

  /** A simple top-down coastline: town blocks, a promenade, sand and sea. */
  private drawPlainBackdrop(): void {
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
