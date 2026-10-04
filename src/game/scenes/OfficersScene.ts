import Phaser from 'phaser';
import { menuMusic } from '../audio/Jingles';
import { DIFFICULTY_SETTINGS } from '../../engine';
import { cosmetic, liveryLook } from '../../engine/campaign/cosmetics';
import { escapedCount, nextOfficer, officerInfo, officerUnlocked, OFFICERS, REGULAR_OFFICERS, type OfficerInfo } from '../../engine/campaign/officers';
import { loadEscapeProgress, newEscapeSeed } from '../escapeStore';
import { bossForced } from '../profileStore';
import { everythingUnlocked } from '../lookStore';
import { createPoliceCar } from '../render/actors';
import { PALETTE, toCss } from '../palette';
import { backdrop, Menu, officerPictureKey, paper, SCREEN_PICTURES, text } from '../ui/ui';

export interface OfficersData {
  /** Open this officer's dossier straight away (from NEXT OFFICER on the results screen). */
  show?: string;
}

/** `?unlock=all` or `?boss=1` opens every officer, the hidden pair included (for testing and for showing the class). */
function allOpen(): boolean {
  return everythingUnlocked() || bossForced();
}

function isOpen(id: string): boolean {
  return allOpen() || officerUnlocked(loadEscapeProgress(), id);
}

/** Speed as one to five bars: Agent Escargot one, the motorcycle squad five. */
function speedBars(speed: number): number {
  return Phaser.Math.Clamp(Math.round((speed - 0.74) / 0.04), 1, 5);
}

const STAGE_WORDS = { CAR: 'car', FOOT: 'on foot' } as const;

/**
 * Escape Mode's police files (Mr Henry, 2026-10-04): the player is the
 * fugitive, so the wall holds the officers on their trail rather than the
 * suspects. Ten dossiers, two per level, then the hidden motorcycle squad
 * (TOP SECRET until all eight have been escaped). A dossier shows the
 * officer, their vehicle and speed, and the player's record against them.
 */
export class OfficersScene extends Phaser.Scene {
  static readonly KEY = 'Officers';
  private show: OfficerInfo | null = null;

  constructor() {
    super(OfficersScene.KEY);
  }

  init(data?: OfficersData): void {
    const officer = officerInfo(data?.show);
    this.show = officer && isOpen(officer.id) ? officer : null;
  }

  create(): void {
    menuMusic.start();
    backdrop(this, SCREEN_PICTURES.briefing, 0.5);
    if (this.show) this.dossier(this.show);
    else this.wall();
  }

  private wall(): void {
    const { width } = this.scale;
    const progress = loadEscapeProgress();
    text(this, width / 2, 18, 'POLICE FILES: THE OFFICERS ON YOUR TRAIL', 32, { bold: true, color: toCss(PALETTE.cream) }).setOrigin(0.5, 0);
    text(this, width / 2, 60, `Escaped: ${escapedCount(progress)} / ${OFFICERS.length}   ·   Escape all ${REGULAR_OFFICERS} to open the secret motorcycle squad`, 20, {
      color: toCss(PALETTE.paleYellow),
    }).setOrigin(0.5, 0);
    OFFICERS.forEach((o, i) => this.card(o, i, 28 + (i % 5) * 248, 98 + Math.floor(i / 5) * 268));

    const menu = new Menu(this);
    const next = nextOfficer(progress) ?? (allOpen() ? OFFICERS.find((o) => !progress.records[o.id]?.escaped) ?? null : null);
    if (next) menu.add(width / 2 - 340, 670, 400, 56, `▶ NEXT: ${next.nickname.toUpperCase()}`, () => this.scene.restart({ show: next.id }), { size: 20 });
    menu.add(width / 2 + 110, 670, 300, 56, '🏃 PRACTICE ESCAPE (P)', () => this.scene.start('Practice', { escape: true }), { key: 'P', size: 19 });
    menu.add(width / 2 + 410, 670, 200, 56, 'MENU', () => this.scene.start('Title'), { key: 'ESC', size: 20 });
  }

  private card(o: OfficerInfo, index: number, x: number, y: number): void {
    const record = loadEscapeProgress().records[o.id];
    const open = isOpen(o.id);
    const w = 232;
    const h = 252;
    const sheet = paper(this, x, y, w, h, open ? 0.96 : 0.62);
    const photo = officerPictureKey(o.id);
    if (open && this.textures.exists(photo)) this.add.image(x + 12, y + 12, photo).setOrigin(0).setDisplaySize(112, 112);
    else {
      this.add.rectangle(x + 12, y + 12, 112, 112, o.hidden ? 0x2b2f3a : 0x9fb7c4).setOrigin(0);
      text(this, x + 68, y + 68, o.hidden ? '🏍️' : '?', o.hidden ? 44 : 60, { bold: true, color: toCss(PALETTE.cream) }).setOrigin(0.5);
    }
    this.add.rectangle(x + 12, y + 12, 112, 112).setOrigin(0).setStrokeStyle(2, PALETTE.ink);
    text(this, x + 134, y + 14, o.hidden ? 'SECRET' : `N° ${index + 1}`, 18, { bold: true, color: toCss(PALETTE.terracotta) });
    text(this, x + 134, y + 40, DIFFICULTY_SETTINGS[o.difficulty].label.en, 14);
    text(this, x + 134, y + 64, 'Speed', 14, { color: toCss(PALETTE.seaDeep) });
    this.bars(x + 134, y + 84, speedBars(o.speed), 15, 10);
    const name = text(this, x + 12, y + 134, open ? o.nickname : o.hidden ? 'TOP SECRET' : 'Unknown officer', 19, { bold: true });
    // Long nicknames ("Brigadière Chouette") shrink to fit the card rather than wrap.
    if (name.width > w - 22) name.setScale((w - 22) / name.width);
    text(this, x + 12, y + 162, open ? cosmetic('VEHICLE', o.vehicle)?.name ?? '' : o.hidden ? `Escape all ${REGULAR_OFFICERS} officers` : '', 15, { color: toCss(PALETTE.seaDeep) });
    const status = record?.escaped ? 'ESCAPED' : record ? 'CAUGHT YOU' : open ? 'ON YOUR TRAIL' : '';
    if (status) text(this, x + 12, y + 190, status, 18, { bold: true, color: toCss(record?.escaped ? 0x2e8b57 : record ? PALETTE.terracotta : PALETTE.seaDeep) });
    if (record) {
      text(this, x + 12, y + 218, `${record.bestScore} pts`, 16);
      for (let i = 0; i < 3; i++) {
        const on = i < record.stars;
        this.add.star(x + 150 + i * 26, y + 228, 5, 5, 11, on ? 0xf2c230 : 0xcfc6ae).setStrokeStyle(1.5, on ? 0x9c7a12 : 0x9a917c);
      }
    }
    if (open) sheet.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.restart({ show: o.id }));
  }

  /** One officer's dossier: picture, vehicle, speed, what to expect, and the player's record; ESCAPE starts. */
  private dossier(o: OfficerInfo): void {
    const { width } = this.scale;
    const record = loadEscapeProgress().records[o.id];
    const index = OFFICERS.indexOf(o);
    text(this, width / 2, 22, o.hidden ? 'TOP SECRET POLICE FILE' : 'POLICE FILE', 32, { bold: true, color: toCss(PALETTE.cream) }).setOrigin(0.5, 0);

    // The officer.
    paper(this, 60, 80, 560, 540);
    const photo = officerPictureKey(o.id);
    if (this.textures.exists(photo)) this.add.image(84, 104, photo).setOrigin(0).setDisplaySize(240, 240);
    else this.add.rectangle(84, 104, 240, 240, 0x9fb7c4).setOrigin(0);
    this.add.rectangle(84, 104, 240, 240).setOrigin(0).setStrokeStyle(3, PALETTE.ink);
    text(this, 344, 110, o.hidden ? 'SECRET SQUAD' : `N° ${index + 1}`, 24, { bold: true, color: toCss(PALETTE.terracotta) });
    text(this, 344, 146, o.nickname, 28, { bold: true, wordWrap: { width: 260 } });
    text(this, 344, 226, `Level: ${DIFFICULTY_SETTINGS[o.difficulty].label.en}`, 21, { color: toCss(PALETTE.seaDeep), bold: true });
    text(this, 84, 366, o.note, 22, { wordWrap: { width: 510 }, lineSpacing: 6 });
    const stamp = text(this, 470, 520, o.hidden ? 'TOP SECRET' : 'DANGER', 34, { bold: true, color: toCss(0xc0392b) }).setOrigin(0.5).setRotation(-0.18);
    stamp.setAlpha(0.75);

    // The vehicle and what to expect.
    paper(this, 660, 80, 560, 540);
    text(this, 686, 100, 'VEHICLE', 18, { bold: true, color: toCss(PALETTE.seaDeep) });
    text(this, 686, 124, cosmetic('VEHICLE', o.vehicle)?.name ?? o.vehicle, 26, { bold: true });
    createPoliceCar(this, liveryLook(o.livery), o.vehicle).setScale(o.vehicle === 'MOTO' ? 15 : 11).setPosition(940, 232);
    text(this, 686, 322, 'Speed', 20, { bold: true, color: toCss(PALETTE.seaDeep) });
    this.bars(800, 326, speedBars(o.speed), 30, 20);
    const stages = o.chaseType
      ? o.chaseType.split('_').map((m) => STAGE_WORDS[m as keyof typeof STAGE_WORDS]).join(', then ')
      : o.difficulty === 'EASY'
        ? 'mostly by car'
        : 'by car or on foot';
    text(this, 686, 366, `Your escape: ${stages}.`, 20, { wordWrap: { width: 510 } });
    text(this, 686, 400, 'Follow your partner’s directions to the hideout. Every wrong turn lets them catch up!', 18, {
      wordWrap: { width: 510 },
      color: toCss(PALETTE.seaDeep),
    });
    this.add.rectangle(686, 470, 508, 2, PALETTE.ink, 0.4).setOrigin(0);
    text(this, 686, 484, 'YOUR RECORD', 18, { bold: true, color: toCss(PALETTE.seaDeep) });
    text(
      this,
      686,
      510,
      record ? `${record.escaped ? 'Escaped ✓' : 'Not escaped yet'}   ·   best ${record.bestScore} pts   ·   ${record.attempts} ${record.attempts === 1 ? 'try' : 'tries'}` : 'Not faced yet.',
      19,
    );
    if (record) {
      for (let i = 0; i < 3; i++) {
        const on = i < record.stars;
        this.add.star(700 + i * 34, 570, 5, 7, 15, on ? 0xf2c230 : 0xcfc6ae).setStrokeStyle(2, on ? 0x9c7a12 : 0x9a917c);
      }
    }

    const menu = new Menu(this);
    menu.add(width / 2 + 200, 668, 360, 60, 'ESCAPE  ▶', () => this.scene.start('Escape', { seed: newEscapeSeed(o), officer: o.id }), { size: 24 });
    menu.add(width / 2 - 200, 668, 300, 56, 'ALL OFFICERS', () => this.scene.restart({}), { key: 'ESC', size: 20 });
  }

  private bars(x: number, y: number, filled: number, w: number, h: number): void {
    for (let i = 0; i < 5; i++) {
      this.add.rectangle(x + i * (w + 4), y, w, h, i < filled ? 0xc0392b : 0xcfc6ae).setOrigin(0).setStrokeStyle(1.5, PALETTE.ink, 0.7);
    }
  }
}
