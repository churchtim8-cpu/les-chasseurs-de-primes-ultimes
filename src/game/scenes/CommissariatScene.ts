import Phaser from 'phaser';
import { menuMusic } from '../audio/Jingles';
import { DIFFICULTY_SETTINGS } from '../../engine';
import { capturedCount, MISSION_COUNT } from '../../engine/campaign/campaign';
import { BADGES, BOSSES, bossInfo, bossUnlocked, EMPTY_FILE, SUSPECT_FILES, suspectPaceFor, type Badge, type BossInfo } from '../../engine/campaign/profile';
import { CHASE_TYPE_MODES } from '../../engine/chase/settings';
import { LOCATION_WORD_BY_ID, withPreposition } from '../../engine/language/locations';
import { VEHICLE_WORDS } from '../../engine/language/sightings';
import { loadProgress } from '../campaignStore';
import { PALETTE, toCss } from '../palette';
import { bossForced, loadProfile } from '../profileStore';
import { backdrop, medalBadge, Menu, paper, rankLine, SCREEN_PICTURES, suspectPictureKey, text } from '../ui/ui';

/**
 * The police station: the player's rank and points, the shelf of badges
 * earned (and how to earn the rest), and the wall of case files, one per
 * suspect, filled in as they are arrested. The bosses' files stay locked
 * until they are found: gold on every mission opens Le Boss, arresting Le Boss
 * opens La Patronne.
 */
export class CommissariatScene extends Phaser.Scene {
  static readonly KEY = 'Commissariat';

  constructor() {
    super(CommissariatScene.KEY);
  }

  create(): void {
    menuMusic.start();
    const { width } = this.scale;
    const profile = loadProfile();
    const progress = loadProgress();
    backdrop(this, SCREEN_PICTURES.briefing, 0.5);

    text(this, width / 2, 26, 'COMMISSARIAT DE BELLEVUE CITY', 28, { bold: true, color: toCss(PALETTE.cream) }).setOrigin(0.5, 0);

    // Rank and points, top left.
    paper(this, 40, 72, 560, 124);
    rankLine(this, 62, 88, profile.points, 516);
    const captured = capturedCount(progress);
    text(this, 62, 150, `${profile.arrests} arrestation${profile.arrests === 1 ? '' : 's'} en tout   ·   ${profile.nightArrests} de nuit   ·   campagne : ${captured} / ${MISSION_COUNT}`, 17);
    // Suspects move a little faster at each rank: say so under the counts.
    const pace = Math.round((suspectPaceFor(profile.points) - 1) * 100);
    text(this, 62, 174, pace > 0 ? `À votre grade, les suspects sont ${pace} % plus rapides.` : 'Les suspects seront plus rapides à chaque grade.', 14, { fontStyle: 'italic', color: toCss(PALETTE.terracotta) });

    // Badges, top right.
    paper(this, 620, 72, 620, 124);
    text(this, 636, 80, 'BADGES', 16, { bold: true, color: toCss(PALETTE.seaDeep) });
    BADGES.forEach((b, i) => this.badge(b, 658 + i * 58, 134, profile.badges[b.id]));

    // The wall of case files: the campaign's eight, then the two bosses.
    const open = (picture: string) => bossUnlocked(progress, profile, picture) || bossForced();
    SUSPECT_FILES.forEach((s, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const boss = bossInfo(s.picture);
      this.file(s.picture, s.nickname, s.difficulty, 40 + col * 244, 206 + row * 214, boss !== undefined && !open(boss.picture), boss);
    });

    // Bottom row: the campaign file, a button per boss that has been found, and the menu.
    const menu = new Menu(this);
    menu.add(190, 672, 300, 52, 'CAMPAGNE (C)', () => this.scene.start('Campaign'), { key: 'C', size: 20 });
    const bosses = BOSSES.filter((b) => open(b.picture));
    bosses.forEach((b, i) => {
      const bx = bosses.length === 1 ? 650 : 490 + i * 320;
      menu.add(bx, 672, 300, 52, `${b.nickname.toUpperCase()}  ▶`, () => this.scene.start('Briefing', { boss: b.picture }), { size: 20 });
    });
    menu.add(1150, 672, 180, 52, 'MENU', () => this.scene.start('Title'), { key: 'ESC', size: 20 });
    // Either side of the title: the garage and the wanted posters wall.
    menu.add(110, 42, 170, 40, '🔧 GARAGE (G)', () => this.scene.start('Garage', { back: 'Commissariat' }), { key: 'G', size: 16 });
    menu.add(1060, 42, 200, 40, '📜 POSTERS (W)', () => this.scene.start('Wanted', { back: 'Commissariat' }), { key: 'W', size: 16 });
  }

  /** A round badge: coloured and dated when earned, grey with how to earn it otherwise. */
  private badge(b: Badge, x: number, y: number, earnedOn: string | undefined): void {
    const earned = earnedOn !== undefined;
    const disc = this.add.circle(x, y, 26, earned ? PALETTE.paleYellow : PALETTE.stone).setStrokeStyle(3, earned ? 0x9c7a12 : 0x8a8a8a);
    const icon = text(this, x, y, earned ? b.icon : '🔒', 24).setOrigin(0.5).setAlpha(earned ? 1 : 0.55);
    const tip = this.add.container(0, 0).setVisible(false).setDepth(60);
    const lines = earned ? `${b.name}\nObtenu le ${earnedOn}` : `${b.name}\n${b.how}`;
    const label = text(this, 0, 0, lines, 16, { align: 'center', wordWrap: { width: 300 } }).setOrigin(0.5, 1);
    const back = this.add.rectangle(0, 0, label.width + 24, label.height + 16, PALETTE.cream).setOrigin(0.5, 1).setStrokeStyle(2, PALETTE.ink);
    label.setPosition(0, -8);
    tip.add([back, label]);
    tip.setPosition(Math.min(this.scale.width - 170, Math.max(170, x)), y + 70 + label.height);
    disc.setInteractive({ useHandCursor: true });
    disc.on('pointerover', () => tip.setVisible(true));
    disc.on('pointerout', () => tip.setVisible(false));
    icon.setInteractive().on('pointerover', () => tip.setVisible(true)).on('pointerout', () => tip.setVisible(false));
  }

  /** One case file: the suspect's picture and what the police know. */
  private file(picture: string, nickname: string, difficulty: string, x: number, y: number, locked: boolean, boss?: BossInfo): void {
    const profile = loadProfile();
    const f = profile.files[picture] ?? EMPTY_FILE;
    const known = f.arrests + f.escapes > 0;
    const w = 228;
    const h = 206;
    paper(this, x, y, w, h, locked ? 0.55 : 0.95);
    const key = suspectPictureKey(picture);
    if (!locked && this.textures.exists(key)) {
      this.add.image(x + 12, y + 12, key).setOrigin(0).setDisplaySize(76, 76);
      if (!known) this.add.rectangle(x + 12, y + 12, 76, 76, 0x16323d, 0.45).setOrigin(0);
    } else {
      this.add.rectangle(x + 12, y + 12, 76, 76, 0x9fb7c4).setOrigin(0);
      text(this, x + 50, y + 50, locked ? '🔒' : '?', locked ? 30 : 44, { bold: true, color: toCss(PALETTE.cream) }).setOrigin(0.5);
    }
    this.add.rectangle(x + 12, y + 12, 76, 76).setOrigin(0).setStrokeStyle(2, PALETTE.ink);
    const name = text(this, x + 96, y + 10, locked ? '« ??? »' : `« ${nickname} »`, 16, { bold: true, wordWrap: { width: 124 } });
    const level = DIFFICULTY_SETTINGS[difficulty as keyof typeof DIFFICULTY_SETTINGS]?.label.fr ?? difficulty;
    const levelY = y + 10 + name.height + 2;
    text(this, x + 96, levelY, level, 14, { color: toCss(PALETTE.seaDeep) });
    const status = f.arrests > 0 ? 'ARRÊTÉ' : known ? 'EN FUITE' : 'RECHERCHÉ';
    text(this, x + 96, levelY + 19, status, 14, { bold: true, color: toCss(f.arrests > 0 ? 0x2e8b57 : PALETTE.terracotta) });
    if (f.medal) medalBadge(this, x + 78, y + 78, f.medal, 11);

    const lines: string[] = [];
    if (locked) {
      lines.push(`Dossier secret.`, `Pour l’ouvrir : ${boss?.unlock.toLowerCase() ?? '?'}.`);
    } else if (!known) {
      lines.push('Aucune information.', boss ? 'Cliquez ici pour lancer la poursuite.' : 'Jouez la mission pour ouvrir le dossier.');
    } else {
      lines.push(`Arrestations : ${f.arrests}  ·  Fuites : ${f.escapes}`);
      if (f.quickest !== null) lines.push(`Plus rapide : ${f.quickest} s  ·  ${f.bestScore} pts`);
      const place = f.lastSeen ? LOCATION_WORD_BY_ID.get(f.lastSeen) : undefined;
      if (place) lines.push(`${f.arrests > 0 ? 'Arrêté' : 'Vu'} ${withPreposition('près de', place)}`);
      const how = f.vehicle ? VEHICLE_WORDS[f.vehicle].indefinite : 'à pied';
      const modes = f.chaseType ? CHASE_TYPE_MODES[f.chaseType].map((m) => (m === 'CAR' ? '🚗' : '🏃')).join('→') : '';
      lines.push(`Fuite : ${how} ${modes}`);
      if (f.firstArrest) lines.push(`Depuis le ${f.firstArrest}`);
    }
    let ly = y + 98;
    for (const line of lines) ly += text(this, x + 12, ly, line, 13.5, { wordWrap: { width: w - 24 } }).height + 1;
    // An open boss file launches its chase when clicked.
    if (boss && !locked) {
      const hit = this.add.rectangle(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => this.scene.start('Briefing', { boss: boss.picture }));
    }
  }
}
