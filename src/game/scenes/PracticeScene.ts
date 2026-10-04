import Phaser from 'phaser';
import { openCommands } from './CommandsScene';
import { jingles, menuMusic } from '../audio/Jingles';
import { DIFFICULTIES, DIFFICULTY_SETTINGS, type ChaseSeed, type Difficulty } from '../../engine';
import { debugState } from '../debug/debugState';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { newSeed } from '../seedSource';

import { GAME_HEIGHT, GAME_WIDTH, TITLE_PICTURE } from '../layout';

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
 * Practice: one chase at a level of the player's choice, outside the
 * campaign. Starting creates a chase seed at the chosen level and opens the
 * chase; `autostart` (from the results screen) starts the next one at once.
 * With `escape`, the same screen starts an escape instead (Escape Mode: the
 * player is the fugitive, guided to the hideout while the police follow).
 */
export class PracticeScene extends Phaser.Scene {
  static readonly KEY = 'Practice';
  private seed?: ChaseSeed;
  private static level: Difficulty | null = null;
  private levelButtons: { level: Difficulty; box: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];

  constructor() {
    super(PracticeScene.KEY);
  }

  private autostart = false;
  private escape = false;
  private starting = false;

  init(data?: { autostart?: boolean; escape?: boolean }): void {
    this.autostart = data?.autostart === true;
    this.escape = data?.escape === true;
    this.starting = false;
  }

  create(): void {
    menuMusic.start();
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
      .text(GAME_WIDTH / 2, 262, this.escape ? 'ESCAPE' : 'PRACTICE', {
        fontFamily: FONT_FAMILY,
        fontSize: '28px',
        color: toCss(PALETTE.terracotta),
        letterSpacing: 10,
      })
      .setOrigin(0.5);
    if (this.escape) {
      this.add
        .text(GAME_WIDTH / 2, 306, 'You are the fugitive: follow your partner’s directions to the hideout (la planque). The police are behind you!', {
          fontFamily: FONT_FAMILY,
          fontSize: '20px',
          color: toCss(PALETTE.ink),
          align: 'center',
          wordWrap: { width: 1000 },
        })
        .setOrigin(0.5);
    }

    this.add
      .text(GAME_WIDTH / 2, 352, 'Choose a level', {
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
        .text(x, 420, `${i + 1}  ${DIFFICULTY_SETTINGS[level].label.en}`, {
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
    this.select(PracticeScene.currentLevel);

    const prompt = this.add
      .text(GAME_WIDTH / 2, 482, 'Tap a level, or press 1 to 4 then ENTER', {
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
      const i = DIFFICULTIES.indexOf(PracticeScene.currentLevel);
      this.select(DIFFICULTIES[Math.max(0, Math.min(DIFFICULTIES.length - 1, i + by))] as Difficulty);
    };
    keyboard?.on('keydown-LEFT', () => step(-1));
    keyboard?.on('keydown-RIGHT', () => step(1));
    keyboard?.on('keydown-ENTER', () => this.start());
    keyboard?.on('keydown-SPACE', () => this.start());
    // ÉCHAP goes back a screen: to the officers' files for an escape, else the title.
    keyboard?.on('keydown-ESC', () => this.scene.start(this.escape ? 'Officers' : 'Title'));
    keyboard?.on('keydown-H', () => openCommands(this));
    const commands = this.add
      .text(GAME_WIDTH / 2, 548, '🎮  SEE THE CONTROLS (H)', {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        fontStyle: 'bold',
        color: toCss(PALETTE.cream),
        backgroundColor: toCss(PALETTE.ink),
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    commands.on('pointerdown', () => openCommands(this));
    this.add
      .text(GAME_WIDTH / 2, 600, 'ESC: back to the menu', { fontFamily: FONT_FAMILY, fontSize: '18px', color: toCss(PALETTE.ink) })
      .setOrigin(0.5);
  }

  private static get currentLevel(): Difficulty {
    PracticeScene.level ??= loadLevel();
    return PracticeScene.level;
  }

  private select(level: Difficulty): void {
    if (this.levelButtons.length > 0 && level !== PracticeScene.level) jingles.move();
    PracticeScene.level = level;
    for (const button of this.levelButtons) {
      const on = button.level === level;
      button.box.setFillStyle(on ? PALETTE.terracotta : PALETTE.cream);
      button.label.setColor(toCss(on ? PALETTE.cream : PALETTE.ink));
    }
  }

  private start(level?: Difficulty): void {
    if (level) this.select(level);
    this.seed = newSeed(PracticeScene.currentLevel);
    saveLevel(this.seed.difficulty);
    debugState.info.set('seed', this.seed.code);
    debugState.info.set('difficulty', DIFFICULTY_SETTINGS[this.seed.difficulty].label.en);
    const code = this.seed.code;
    const scene = this.escape ? 'Escape' : 'Chase';
    if (this.autostart) {
      this.scene.start(scene, { seed: code });
      return;
    }
    // The chosen level button presses in and flashes, with a blip, before the chase opens.
    if (this.starting) return;
    this.starting = true;
    jingles.select();
    const button = this.levelButtons.find((b) => b.level === PracticeScene.currentLevel);
    if (button) {
      button.box.setFillStyle(PALETTE.paleYellow);
      button.label.setColor(toCss(PALETTE.ink));
      this.tweens.add({ targets: [button.box, button.label], scale: 0.92, duration: 80, yoyo: true });
    }
    this.time.delayedCall(160, () => this.scene.start(scene, { seed: code }));
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
