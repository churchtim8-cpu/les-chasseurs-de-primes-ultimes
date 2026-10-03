import Phaser from 'phaser';
import { menuMusic } from '../audio/Jingles';
import { DIFFICULTY_SETTINGS } from '../../engine';
import {
  capturedCount,
  isComplete,
  isLiveryUnlocked,
  isUnlocked,
  LIVERIES,
  livery,
  MISSION_COUNT,
  MISSIONS,
  newCampaign,
  totalScore,
} from '../../engine/campaign/campaign';
import { loadProgress, saveProgress } from '../campaignStore';
import { createPoliceCar } from '../render/actors';
import { PALETTE, toCss } from '../palette';
import { backdrop, medalBadge, Menu, paper, SCREEN_PICTURES, suspectPictureKey, text } from '../ui/ui';

/**
 * The case folder: the eight suspects of the campaign, which are arrested,
 * which got away and which is next, the total score, and the police car
 * colours earned so far. Any mission already reached can be played again to
 * improve its score or medal.
 */
export class CampaignScene extends Phaser.Scene {
  static readonly KEY = 'Campaign';
  private resetArmed = false;

  constructor() {
    super(CampaignScene.KEY);
  }

  create(): void {
    this.resetArmed = false;
    const progress = loadProgress();
    menuMusic.start();
    const { width } = this.scale;
    backdrop(this, SCREEN_PICTURES.briefing, 0.45);

    text(this, width / 2, 24, 'DOSSIER : LES 8 SUSPECTS', 34, { bold: true, color: toCss(PALETTE.cream) }).setOrigin(0.5, 0);
    text(
      this,
      width / 2,
      68,
      `${capturedCount(progress)} / ${MISSION_COUNT} arrêtés   ·   Score total : ${totalScore(progress)}`,
      22,
      { color: toCss(PALETTE.paleYellow) },
    ).setOrigin(0.5, 0);

    MISSIONS.forEach((mission, i) => this.card(mission.index, 40 + (i % 4) * 305, 104 + Math.floor(i / 4) * 240));

    const menu = new Menu(this);
    const done = isComplete(progress);
    menu.add(width / 2 - 360, 660, 300, 56, done ? 'AFFAIRE CLASSÉE' : `MISSION ${progress.current + 1}  ▶`, () =>
      done ? this.scene.start('CaseClosed') : this.scene.start('Briefing', { mission: progress.current }),
    );
    const car = menu.add(width / 2, 660, 340, 56, `VOITURE : ${livery(progress.livery).name}`, () => this.nextLivery(car.label), {
      key: 'V',
      size: 22,
    });
    const reset = menu.add(width / 2 + 300, 660, 200, 56, 'RECOMMENCER', () => this.reset(reset.label), { size: 20 });
    menu.add(width / 2 + 500, 660, 160, 56, 'MENU', () => this.scene.start('Title'), { key: 'ESC', size: 20 });
    menu.add(width / 2 - 360, 600, 300, 44, '🏅 COMMISSARIAT (O)', () => this.scene.start('Commissariat'), { key: 'O', size: 18 });
    this.drawCar();
  }

  private card(index: number, x: number, y: number): void {
    const progress = loadProgress();
    const mission = MISSIONS[index]!;
    const record = progress.missions[index] ?? null;
    const open = isUnlocked(progress, index);
    const w = 285;
    const h = 225;
    const sheet = paper(this, x, y, w, h, open ? 0.96 : 0.6);
    const photo = suspectPictureKey(mission.picture);
    if (open && this.textures.exists(photo)) {
      this.add.image(x + 14, y + 14, photo).setOrigin(0).setDisplaySize(130, 130);
    } else {
      this.add.rectangle(x + 14, y + 14, 130, 130, 0x9fb7c4).setOrigin(0);
      text(this, x + 79, y + 79, '?', 64, { bold: true, color: toCss(PALETTE.cream) }).setOrigin(0.5);
    }
    this.add.rectangle(x + 14, y + 14, 130, 130).setOrigin(0).setStrokeStyle(2, PALETTE.ink);
    text(this, x + 156, y + 16, `N° ${index + 1}`, 20, { bold: true, color: toCss(PALETTE.terracotta) });
    text(this, x + 156, y + 44, DIFFICULTY_SETTINGS[mission.difficulty].label.fr, 18);
    text(this, x + 14, y + 154, open ? `« ${mission.nickname} »` : 'Suspect inconnu', 22, { bold: true });

    const status = record?.captured ? 'ARRÊTÉ' : record ? 'ÉCHAPPÉ' : index === progress.current ? 'À ARRÊTER' : '';
    const colour = record?.captured ? 0x2e8b57 : record ? PALETTE.terracotta : PALETTE.seaDeep;
    if (status) {
      text(this, x + 14, y + 188, status, 20, { bold: true, color: toCss(colour) });
      if (record) text(this, x + 140, y + 190, `${record.bestScore} pts`, 18);
    }
    if (record?.medal) medalBadge(this, x + 222, y + 110, record.medal, 22);
    if (open) {
      sheet.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.start('Briefing', { mission: index }));
    }
  }

  private nextLivery(label: Phaser.GameObjects.Text): void {
    const progress = loadProgress();
    const unlocked = LIVERIES.filter((l) => isLiveryUnlocked(progress, l.id));
    const at = unlocked.findIndex((l) => l.id === progress.livery);
    const next = unlocked[(at + 1) % unlocked.length]!;
    saveProgress({ ...progress, livery: next.id });
    label.setText(`VOITURE : ${next.name}`);
    this.drawCar();
  }

  /** The chosen car and the colours still to earn, along the bottom. */
  private carPreview?: Phaser.GameObjects.Container;
  private drawCar(): void {
    this.carPreview?.destroy();
    const progress = loadProgress();
    const chosen = livery(progress.livery);
    const car = createPoliceCar(this, chosen).setScale(3.4).setPosition(this.scale.width / 2, 600);
    const locked = LIVERIES.filter((l) => !isLiveryUnlocked(progress, l.id));
    const hint = locked[0] ? `Prochaine couleur : ${locked[0].name} (${locked[0].unlock})` : 'Toutes les couleurs sont débloquées !';
    const caption = text(this, this.scale.width / 2 + 50, 600, hint, 17, { color: toCss(PALETTE.cream) }).setOrigin(0, 0.5);
    this.carPreview = this.add.container(0, 0, [car, caption]);
  }

  /** Starting the campaign again needs a second press, so it is never done by accident. */
  private reset(label: Phaser.GameObjects.Text): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      label.setText('SÛR ? ENCORE');
      return;
    }
    saveProgress(newCampaign(loadProgress()));
    this.scene.restart();
  }
}
