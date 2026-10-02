import Phaser from 'phaser';
import {
  capturedCount,
  isLiveryUnlocked,
  LIVERIES,
  MISSION_COUNT,
  MISSIONS,
  newCampaign,
  totalScore,
} from '../../engine/campaign/campaign';
import type { Medal } from '../../engine/campaign/scoring';
import { loadProgress, saveProgress } from '../campaignStore';
import { PALETTE, toCss } from '../palette';
import { backdrop, medalBadge, Menu, paper, SCREEN_PICTURES, suspectPictureKey, text } from '../ui/ui';

/**
 * Final results and case complete (blueprint section 20): all eight
 * missions played, the suspects arrested, the total score, the medals and
 * the car colours earned, with a little confetti.
 */
export class CaseClosedScene extends Phaser.Scene {
  static readonly KEY = 'CaseClosed';
  private resetArmed = false;

  constructor() {
    super(CaseClosedScene.KEY);
  }

  create(): void {
    this.resetArmed = false;
    const progress = loadProgress();
    const { width } = this.scale;
    backdrop(this, SCREEN_PICTURES.caseClosed, 0.15);
    this.confetti();

    paper(this, 140, 40, 1000, 560, 0.93);
    text(this, width / 2, 64, 'Affaire classée !', 52, { bold: true, color: toCss(PALETTE.terracotta) }).setOrigin(0.5, 0);
    text(this, width / 2, 130, 'La mission est terminée.', 26).setOrigin(0.5, 0);

    // The eight suspects, stamped.
    MISSIONS.forEach((mission, i) => {
      const x = 186 + i * 116;
      const y = 186;
      const record = progress.missions[i] ?? null;
      const key = suspectPictureKey(mission.picture);
      if (this.textures.exists(key)) this.add.image(x, y, key).setOrigin(0).setDisplaySize(100, 100);
      this.add.rectangle(x, y, 100, 100).setOrigin(0).setStrokeStyle(2, PALETTE.ink);
      const caught = record?.captured === true;
      text(this, x + 50, y + 108, caught ? 'ARRÊTÉ' : 'ÉCHAPPÉ', 15, {
        bold: true,
        color: toCss(caught ? 0x2e8b57 : PALETTE.terracotta),
      }).setOrigin(0.5, 0);
      if (record?.medal) medalBadge(this, x + 86, y + 86, record.medal, 13);
    });

    const medals: Record<Medal, number> = { GOLD: 0, SILVER: 0, BRONZE: 0 };
    for (const m of progress.missions) if (m?.medal) medals[m.medal]++;
    const lines = [
      `Suspects arrêtés : ${capturedCount(progress)} / ${MISSION_COUNT}`,
      `Score total : ${totalScore(progress)}`,
      `Médailles : ${medals.GOLD} or · ${medals.SILVER} argent · ${medals.BRONZE} bronze`,
      `Couleurs de voiture : ${LIVERIES.filter((l) => isLiveryUnlocked(progress, l.id)).map((l) => l.name).join(', ')}`,
    ];
    lines.forEach((line, i) => text(this, 200, 344 + i * 40, line, 26, { bold: i < 2 }));
    const missing = MISSION_COUNT - capturedCount(progress);
    text(
      this,
      200,
      516,
      missing > 0
        ? `Rejouez une mission depuis le dossier pour arrêter ${missing === 1 ? 'le dernier suspect' : `les ${missing} derniers suspects`} !`
        : 'Bravo ! Tous les suspects sont arrêtés. Visez les médailles d’or !',
      21,
      { fontStyle: 'italic', wordWrap: { width: 880 } },
    );

    const menu = new Menu(this);
    menu.add(width / 2 - 260, 660, 280, 60, 'DOSSIER', () => this.scene.start('Campaign'));
    menu.add(width / 2 + 40, 660, 260, 60, 'MENU', () => this.scene.start('Title'), { key: 'ESC' });
    const reset = menu.add(width / 2 + 330, 660, 300, 60, 'NOUVELLE CAMPAGNE', () => {
      if (!this.resetArmed) {
        this.resetArmed = true;
        reset.label.setText('SÛR ? ENCORE');
        return;
      }
      saveProgress(newCampaign(loadProgress()));
      this.scene.start('Campaign');
    }, { size: 21 });
  }

  /** Paper confetti drifting down. */
  private confetti(): void {
    const colours = [PALETTE.terracotta, PALETTE.paleYellow, PALETTE.lightBlue, 0x2e8b57, 0xf0c53c];
    for (let i = 0; i < 70; i++) {
      const bit = this.add
        .rectangle(Phaser.Math.Between(0, this.scale.width), Phaser.Math.Between(-720, 0), 10, 6, colours[i % colours.length])
        .setAngle(Phaser.Math.Between(0, 180))
        .setDepth(50);
      this.tweens.add({
        targets: bit,
        y: this.scale.height + 20,
        angle: bit.angle + 360,
        x: bit.x + Phaser.Math.Between(-80, 80),
        duration: Phaser.Math.Between(4000, 8000),
        repeat: -1,
        delay: Phaser.Math.Between(0, 3000),
      });
    }
  }
}
