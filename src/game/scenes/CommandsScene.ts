import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../layout';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { jingles } from '../audio/Jingles';

export interface CommandsSceneData {
  /** The scene underneath, paused while the controls are shown; it carries on when they close. */
  returnTo: string;
}

/** One line of the controls sheet: the keys (each drawn as a key cap) and what they do. */
interface Row {
  keys: string[];
  what: string;
}

const DRIVING: Row[] = [
  { keys: ['◀', '▶'], what: 'Choisir le prochain virage (au rond-point : la sortie)' },
  { keys: ['▲'], what: 'Tout droit · maintenir pour accélérer' },
  { keys: ['▼'], what: 'Maintenir pour freiner' },
  { keys: ['▼', '▼'], what: 'Deux fois vite : faire demi-tour (ou U)' },
  { keys: ['ESPACE'], what: 'Descendre de la voiture / monter (ou E)' },
];

const RADIO: Row[] = [
  { keys: ['R'], what: 'Répéter le dernier appel' },
  { keys: ['1', '2', '3', '4'], what: '« Où est le suspect ? » : choisir la carte' },
  { keys: ['ÉCHAP'], what: 'Pause : reprendre, recommencer, voiture, quitter' },
  { keys: ['TAB'], what: 'Cacher / afficher l’écran de bord' },
  { keys: ['B'], what: 'Musique   ·   V : sens de la carte   ·   F : plein écran' },
];

/** The ZQSD/WASD letters work like the arrows. */
const LETTERS = 'Les lettres W A S D marchent comme les flèches.';
const TOUCH = 'Sur tablette : boutons ◀ ▶ ▲ ▼ en bas, ⟲ demi-tour, ⇄ voiture.';

/**
 * The controls sheet ("COMMANDES"), opened over the title, practice screen or
 * pause menu, which wait underneath. ÉCHAP, ENTRÉE, ESPACE or RETOUR closes it.
 */
export class CommandsScene extends Phaser.Scene {
  static readonly KEY = 'Commands';
  private returnTo = '';

  constructor() {
    super(CommandsScene.KEY);
  }

  init(data: CommandsSceneData): void {
    this.returnTo = data.returnTo;
  }

  create(): void {
    const w = 1040;
    const h = 600;
    const x = (GAME_WIDTH - w) / 2;
    const y = (GAME_HEIGHT - h) / 2;
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05121a, 0.72).setInteractive();
    // A police tablet: dark glass, a blue and red light strip along the top.
    this.add.rectangle(x + 8, y + 10, w, h, 0x000000, 0.35).setOrigin(0);
    this.add.rectangle(x, y, w, h, 0x10232d, 0.97).setOrigin(0).setStrokeStyle(3, PALETTE.lightBlue, 0.6);
    const red = this.add.rectangle(x, y, w / 2, 6, 0xe0463a).setOrigin(0);
    const blue = this.add.rectangle(x + w / 2, y, w / 2, 6, 0x2f7de1).setOrigin(0).setAlpha(0.25);
    this.tweens.add({ targets: red, alpha: 0.25, duration: 420, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: blue, alpha: 1, duration: 420, yoyo: true, repeat: -1 });
    this.label(GAME_WIDTH / 2, y + 26, 'COMMANDES', 40, PALETTE.cream).setOrigin(0.5, 0);

    this.column(x + 34, y + 160, 'AU VOLANT ET À PIED', DRIVING);
    this.column(x + w / 2 + 14, y + 160, 'RADIO ET ÉCRAN', RADIO);
    this.label(GAME_WIDTH / 2, y + h - 104, LETTERS, 17, PALETTE.lightBlue).setOrigin(0.5, 0);
    this.label(GAME_WIDTH / 2, y + h - 78, TOUCH, 17, PALETTE.lightBlue).setOrigin(0.5, 0);

    const back = this.add
      .rectangle(GAME_WIDTH / 2, y + h - 34, 260, 44, PALETTE.terracotta)
      .setStrokeStyle(3, PALETTE.cream, 0.9)
      .setInteractive({ useHandCursor: true });
    this.label(GAME_WIDTH / 2, y + h - 34, 'RETOUR (ÉCHAP)', 20, PALETTE.cream).setOrigin(0.5);
    back.on('pointerdown', () => this.close());
    for (const key of ['ESC', 'ENTER', 'SPACE']) this.input.keyboard?.on(`keydown-${key}`, () => this.close());
  }

  private close(): void {
    jingles.select();
    this.scene.stop();
    if (this.returnTo) this.scene.resume(this.returnTo);
  }

  private column(x: number, y: number, title: string, rows: Row[]): void {
    this.label(x, y - 46, title, 18, PALETTE.paleYellow);
    this.add.rectangle(x, y - 20, 470, 2, PALETTE.lightBlue, 0.35).setOrigin(0, 0.5);
    rows.forEach((row, i) => {
      const rowY = y + i * 62;
      let keyX = x;
      for (const key of row.keys) keyX += this.keyCap(keyX, rowY, key) + 6;
      const textX = Math.max(keyX + 10, x + 150);
      this.label(textX, rowY + 4, row.what, 18, PALETTE.cream).setWordWrapWidth(x + 480 - textX);
    });
  }

  /** A key cap with its label; returns its width. */
  private keyCap(x: number, y: number, key: string): number {
    const width = Math.max(40, key.length * 13 + 20);
    this.add.rectangle(x, y + 4, width, 40, 0x000000, 0.45).setOrigin(0);
    this.add.rectangle(x, y, width, 40, PALETTE.cream).setOrigin(0).setStrokeStyle(2, PALETTE.ink);
    this.label(x + width / 2, y + 20, key, key.length > 2 ? 15 : 20, PALETTE.ink).setOrigin(0.5);
    return width;
  }

  private label(x: number, y: number, value: string, size: number, colour: number): Phaser.GameObjects.Text {
    return this.add.text(x, y, value, {
      fontFamily: FONT_FAMILY,
      fontSize: `${size}px`,
      fontStyle: 'bold',
      color: toCss(colour),
    });
  }
}

/** Show the controls over `scene`, which waits paused until they close. */
export function openCommands(scene: Phaser.Scene): void {
  scene.scene.launch(CommandsScene.KEY, { returnTo: scene.scene.key } satisfies CommandsSceneData);
  scene.scene.pause();
}
