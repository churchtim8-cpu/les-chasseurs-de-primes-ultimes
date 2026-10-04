import Phaser from 'phaser';
import { jingles, menuMusic } from '../audio/Jingles';
import { OFFICERS } from '../../engine/campaign/officers';
import { nextRank, rankFor } from '../../engine/campaign/profile';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';

/** Screen pictures made in Canva for M8 (public/images/m8). */
export const SCREEN_PICTURES = {
  briefing: 'm8-briefing',
  captured: 'm8-captured',
  escaped: 'm8-escaped',
  caseClosed: 'm8-caseclosed',
  /** Escape Mode, from the fugitive's side: got away, or caught. */
  escapeWon: 'm8-escape-won',
  escapeCaught: 'm8-escape-caught',
} as const;

const SCREEN_FILES: Record<string, string> = {
  'm8-briefing': 'briefing.jpg',
  'm8-captured': 'captured.jpg',
  'm8-escaped': 'escaped.jpg',
  'm8-caseclosed': 'caseclosed.jpg',
  'm8-escape-won': 'escape-won.jpg',
  'm8-escape-caught': 'escape-caught.jpg',
};

export const suspectPictureKey = (picture: string) => `m8-suspect-${picture}`;
export const officerPictureKey = (id: string) => `m8-officer-${id}`;

/** Queues every M8 picture that is not loaded yet (the loading screen calls this). */
export function preloadScreenPictures(scene: Phaser.Scene, suspects: readonly string[]): void {
  const base = `${import.meta.env.BASE_URL}images/m8/`;
  for (const [key, file] of Object.entries(SCREEN_FILES)) {
    if (!scene.textures.exists(key)) scene.load.image(key, base + file);
  }
  for (const picture of suspects) {
    const key = suspectPictureKey(picture);
    if (!scene.textures.exists(key)) scene.load.image(key, `${base}suspect-${picture}.jpg`);
  }
  for (const officer of OFFICERS) {
    const key = officerPictureKey(officer.id);
    if (!scene.textures.exists(key)) scene.load.image(key, `${base}officer-${officer.id}.jpg`);
  }
}

/** A full-screen picture (or the plain sea colour if it failed to load), optionally darkened. */
export function backdrop(scene: Phaser.Scene, key: string, dim = 0): void {
  const { width, height } = scene.scale;
  scene.add.rectangle(width / 2, height / 2, width, height, PALETTE.seaDeep);
  if (scene.textures.exists(key)) scene.add.image(width / 2, height / 2, key).setDisplaySize(width, height);
  if (dim > 0) scene.add.rectangle(width / 2, height / 2, width, height, 0x0b1a20, dim);
}

export function text(
  scene: Phaser.Scene,
  x: number,
  y: number,
  value: string,
  size: number,
  options: Partial<Phaser.Types.GameObjects.Text.TextStyle> & { bold?: boolean } = {},
): Phaser.GameObjects.Text {
  const { bold, ...style } = options;
  return scene.add.text(x, y, value, {
    fontFamily: FONT_FAMILY,
    fontSize: `${size}px`,
    color: toCss(PALETTE.ink),
    ...(bold ? { fontStyle: 'bold' } : {}),
    ...style,
  });
}

/** A cream paper card with a dark outline, like a file in the case folder. */
export function paper(scene: Phaser.Scene, x: number, y: number, w: number, h: number, alpha = 0.96): Phaser.GameObjects.Rectangle {
  scene.add.rectangle(x + 6, y + 8, w, h, 0x000000, 0.25).setOrigin(0);
  return scene.add.rectangle(x, y, w, h, PALETTE.cream, alpha).setOrigin(0).setStrokeStyle(3, PALETTE.ink, 0.85);
}

export interface Button {
  box: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  enabled: boolean;
  setSelected(on: boolean): void;
  activate(): void;
}

/** How long a pressed button shows it was pressed before its screen opens (ms). */
const PRESS_MS = 160;

/**
 * A row or column of buttons worked by mouse, touch or keyboard: arrow keys
 * move, ENTRÉE or ESPACE presses, and a key can be bound to each button.
 * Highlighting ticks; pressing blips and the button visibly presses in and
 * flashes before its action runs. B turns the menu music off or on.
 */
export class Menu {
  readonly buttons: Button[] = [];
  private selected = 0;
  private pressing = false;

  constructor(private readonly scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    keyboard?.on('keydown-B', () => menuMusic.toggleMute());
    keyboard?.on('keydown-LEFT', () => this.move(-1));
    keyboard?.on('keydown-UP', () => this.move(-1));
    keyboard?.on('keydown-RIGHT', () => this.move(1));
    keyboard?.on('keydown-DOWN', () => this.move(1));
    keyboard?.on('keydown-ENTER', () => this.buttons[this.selected]?.activate());
    keyboard?.on('keydown-SPACE', () => this.buttons[this.selected]?.activate());
  }

  add(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onPress: () => void,
    options: { key?: string; size?: number; enabled?: boolean } = {},
  ): Button {
    const enabled = options.enabled ?? true;
    const box = this.scene.add
      .rectangle(x, y, w, h, PALETTE.cream)
      .setStrokeStyle(3, PALETTE.ink)
      .setAlpha(enabled ? 1 : 0.55);
    const text = this.scene.add
      .text(x, y, label, {
        fontFamily: FONT_FAMILY,
        fontSize: `${options.size ?? 24}px`,
        fontStyle: 'bold',
        color: toCss(PALETTE.ink),
        align: 'center',
      })
      .setOrigin(0.5)
      .setAlpha(enabled ? 1 : 0.55);
    const index = this.buttons.length;
    const button: Button = {
      box,
      label: text,
      enabled,
      setSelected: (on) => {
        box.setFillStyle(on ? PALETTE.terracotta : PALETTE.cream);
        text.setColor(toCss(on ? PALETTE.cream : PALETTE.ink));
      },
      activate: () => {
        if (!button.enabled || this.pressing) return;
        this.pressing = true;
        this.select(index, false);
        jingles.select();
        box.setFillStyle(PALETTE.paleYellow);
        text.setColor(toCss(PALETTE.ink));
        this.scene.tweens.add({ targets: [box, text], scale: 0.92, duration: PRESS_MS / 2, yoyo: true, ease: 'Quad.easeOut' });
        this.scene.time.delayedCall(PRESS_MS, () => {
          this.pressing = false;
          button.setSelected(this.buttons[this.selected] === button);
          onPress();
        });
      },
    };
    if (enabled) {
      box.setInteractive({ useHandCursor: true });
      box.on('pointerover', () => this.select(index));
      box.on('pointerdown', () => button.activate());
    }
    if (options.key) this.scene.input.keyboard?.on(`keydown-${options.key}`, () => button.activate());
    this.buttons.push(button);
    if (this.buttons.length === 1) this.select(0, false);
    else button.setSelected(false);
    return button;
  }

  select(index: number, sound = true): void {
    if (!this.buttons[index]?.enabled || this.pressing) return;
    if (sound && index !== this.selected) jingles.move();
    this.selected = index;
    this.buttons.forEach((b, i) => b.setSelected(i === index));
  }

  private move(by: number): void {
    const n = this.buttons.length;
    for (let step = 1; step <= n; step++) {
      const i = (((this.selected + by * step) % n) + n) % n;
      if (this.buttons[i]?.enabled) {
        this.select(i);
        return;
      }
    }
  }
}

/** Gold, silver or bronze medal drawn as a disc with a ribbon. */
export function medalBadge(scene: Phaser.Scene, x: number, y: number, medal: 'GOLD' | 'SILVER' | 'BRONZE', radius = 22): Phaser.GameObjects.Container {
  const colour = { GOLD: 0xf0c53c, SILVER: 0xc9d1d9, BRONZE: 0xc98a4b }[medal];
  const rim = { GOLD: 0x9c7a12, SILVER: 0x6b7885, BRONZE: 0x7a4a20 }[medal];
  const g = scene.add.graphics();
  g.fillStyle(0x2f5fa8).fillTriangle(-radius * 0.7, -radius * 1.9, -radius * 0.1, -radius * 1.9, -radius * 0.2, -radius * 0.4);
  g.fillStyle(0xc8443a).fillTriangle(radius * 0.7, -radius * 1.9, radius * 0.1, -radius * 1.9, radius * 0.2, -radius * 0.4);
  g.fillStyle(colour).fillCircle(0, 0, radius);
  g.lineStyle(3, rim).strokeCircle(0, 0, radius);
  g.fillStyle(rim, 0.6);
  // A small star in the middle.
  const star: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius * 0.55 : radius * 0.23;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    star.push(new Phaser.Math.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  g.fillPoints(star, true);
  return scene.add.container(x, y, [g]);
}

export const MEDAL_NAMES = { GOLD: 'Gold', SILVER: 'Silver', BRONZE: 'Bronze' } as const;

/** "Rank: Brigadier · 3,450 pts" with a bar towards the next rank, `width` wide. */
export function rankLine(scene: Phaser.Scene, x: number, y: number, points: number, width: number): void {
  const rank = rankFor(points);
  const next = nextRank(rank);
  const label = `Rank: ${rank.name}   ·   ${points.toLocaleString('en-GB')} pts`;
  text(scene, x, y, label, 20, { bold: true, color: toCss(PALETTE.seaDeep) });
  const barY = y + 30;
  scene.add.rectangle(x, barY, width, 10, PALETTE.stone).setOrigin(0, 0.5).setStrokeStyle(1.5, PALETTE.ink, 0.6);
  const share = next ? Math.min(1, (points - rank.points) / (next.points - rank.points)) : 1;
  scene.add.rectangle(x + 1, barY, Math.max(0, (width - 2) * share), 7, PALETTE.terracotta).setOrigin(0, 0.5);
  const hint = next ? `${(next.points - points).toLocaleString('en-GB')} pts to the rank of ${next.name}` : 'Highest rank!';
  text(scene, x + width, barY + 10, hint, 15, { color: toCss(PALETTE.ink) }).setOrigin(1, 0);
}
