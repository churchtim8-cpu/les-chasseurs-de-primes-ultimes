import Phaser from 'phaser';
import { jingles, menuMusic } from '../audio/Jingles';
import { isComplete, MISSION_COUNT, MISSIONS, newlyUnlocked, recordMission } from '../../engine/campaign/campaign';
import { scoreMission, type MissionStats, type ScoreLine } from '../../engine/campaign/scoring';
import type { EscapeReason } from '../../engine/chase/chase';
import { loadProgress, saveProgress } from '../campaignStore';
import { debugState } from '../debug/debugState';
import { PALETTE, toCss } from '../palette';
import { backdrop, MEDAL_NAMES, medalBadge, Menu, paper, SCREEN_PICTURES, text } from '../ui/ui';

export interface ResultsData {
  seed: string;
  /** Campaign mission (0-based), or null for a practice chase. */
  mission: number | null;
  stats: MissionStats;
  escapeReason?: EscapeReason;
}

const LINE_LABELS: Record<ScoreLine['key'], (count: number) => string> = {
  CAPTURE: () => 'Suspect arrêté',
  TIME: (n) => `Temps restant : ${n} s`,
  SIGHTINGS: (n) => `Observations justes : ${n}`,
  TRANSPORT: (n) => `Changements de transport : ${n}`,
  WRONG_TURNS: (n) => `Mauvaises directions : ${n}`,
  REPEATS: (n) => `Répétitions : ${n}`,
};

/**
 * Mission results (blueprint sections 20 and 21): capture or escape, the
 * score line by line (listening accuracy, wrong turns, repeats, time left,
 * reactions to events), the medal, and any car colour just earned. In the
 * campaign the result is saved and the player goes on, tries again, or goes
 * back to the case folder; there are no lives.
 */
export class ResultsScene extends Phaser.Scene {
  static readonly KEY = 'Results';
  private result!: ResultsData;

  constructor() {
    super(ResultsScene.KEY);
  }

  init(data: ResultsData): void {
    this.result = data;
  }

  create(): void {
    const { stats, mission } = this.result;
    const score = scoreMission(stats);
    const captured = stats.captured;
    menuMusic.stop(0.2);
    if (captured) jingles.victory();
    else jingles.defeat();
    debugState.info.set('score', String(score.total));
    debugState.info.set('medal', score.medal ?? '-');

    let best = false;
    let unlocked: string[] = [];
    let caseDone = false;
    if (mission !== null) {
      const before = loadProgress();
      const after = recordMission(before, mission, score);
      saveProgress(after);
      best = score.total > (before.missions[mission]?.bestScore ?? -1) && (before.missions[mission] ?? null) !== null;
      unlocked = newlyUnlocked(before, after).map((l) => l.name);
      caseDone = isComplete(after);
    }

    backdrop(this, captured ? SCREEN_PICTURES.captured : SCREEN_PICTURES.escaped);
    // Clear of the full-screen button in the top-right corner.
    const x = 628;
    paper(this, x, 30, 600, 600, 0.95);
    const left = x + 32;
    text(this, left, 50, mission === null ? 'ENTRAÎNEMENT' : `MISSION ${mission + 1} / ${MISSION_COUNT}`, 22, {
      bold: true,
      color: toCss(PALETTE.seaDeep),
    });
    text(this, left, captured ? 80 : 86, captured ? 'Mission réussie !' : 'Le suspect s’est échappé.', captured ? 40 : 34, {
      bold: true,
      color: toCss(captured ? 0x2e8b57 : PALETTE.terracotta),
    });
    const nickname = mission !== null ? ` « ${MISSIONS[mission]!.nickname} »` : '';
    const detail = captured
      ? `Vous avez capturé le suspect${nickname} !`
      : 'Le temps est écoulé.';
    text(this, left, 134, detail, 22, { wordWrap: { width: 540 } });

    let y = 182;
    for (const line of score.lines) {
      text(this, left, y, LINE_LABELS[line.key](line.count), 21);
      text(this, x + 568, y, `${line.points > 0 ? '+' : ''}${line.points}`, 21, {
        bold: true,
        color: toCss(line.points < 0 ? PALETTE.terracotta : PALETTE.ink),
      }).setOrigin(1, 0);
      y += 31;
    }
    if (score.lines.length === 0) {
      text(this, left, y, 'Pas de points cette fois.', 21);
      y += 31;
    }
    this.add.rectangle(left, y + 6, 536, 2, PALETTE.ink).setOrigin(0);
    text(this, left, y + 16, 'TOTAL', 26, { bold: true });
    text(this, x + 568, y + 16, `${score.total}`, 26, { bold: true }).setOrigin(1, 0);
    text(this, left, y + 56, `Précision d’écoute : ${Math.round(score.accuracy * 100)} %`, 21, { color: toCss(PALETTE.seaDeep) });

    let note = y + 92;
    if (score.medal) {
      medalBadge(this, left + 26, note + 34, score.medal, 24);
      text(this, left + 64, note + 20, `Médaille : ${MEDAL_NAMES[score.medal]}`, 24, { bold: true });
      note += 74;
    }
    if (best) {
      text(this, left, note, 'Nouveau record !', 22, { bold: true, color: toCss(PALETTE.terracotta) });
      note += 30;
    }
    for (const name of unlocked) {
      text(this, left, note, `Nouvelle couleur de voiture : ${name} !`, 21, { bold: true, color: toCss(0x2e8b57) });
      note += 28;
    }

    const menu = new Menu(this);
    if (mission !== null) {
      const last = mission + 1 >= MISSION_COUNT;
      const nextLabel = caseDone && last ? 'AFFAIRE CLASSÉE  ▶' : last ? 'DOSSIER  ▶' : 'MISSION SUIVANTE  ▶';
      menu.add(x + 300, 680, 340, 60, nextLabel, () => {
        if (caseDone && last) this.scene.start('CaseClosed');
        else if (last) this.scene.start('Campaign');
        else this.scene.start('Briefing', { mission: mission + 1 });
      });
      menu.add(x - 60, 680, 240, 60, 'RÉESSAYER (R)', () => this.scene.start('Briefing', { mission }), { key: 'R', size: 22 });
      menu.add(x - 330, 680, 220, 60, 'DOSSIER', () => this.scene.start('Campaign'), { key: 'ESC', size: 22 });
    } else {
      menu.add(x + 300, 680, 340, 60, 'NOUVELLE POURSUITE', () => this.scene.start('Practice', { autostart: true }), { size: 22 });
      menu.add(x - 60, 680, 240, 60, 'REJOUER (R)', () => this.scene.start('Chase', { seed: this.result.seed }), { key: 'R', size: 22 });
      menu.add(x - 330, 680, 220, 60, 'MENU', () => this.scene.start('Title'), { key: 'ESC', size: 22 });
    }
    text(this, 24, 24, `Poursuite ${this.result.seed}`, 16, { color: toCss(PALETTE.cream), backgroundColor: 'rgba(22, 50, 61, 0.7)', padding: { x: 8, y: 4 } });
  }
}
