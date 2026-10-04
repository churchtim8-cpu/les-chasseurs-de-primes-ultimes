import Phaser from 'phaser';
import { jingles, menuMusic } from '../audio/Jingles';
import { isComplete, MISSION_COUNT, MISSIONS, recordMission } from '../../engine/campaign/campaign';
import { newlyEarned, SLOT_NAMES } from '../../engine/campaign/cosmetics';
import { scoreMission, type MissionStats, type ScoreLine } from '../../engine/campaign/scoring';
import type { EscapeReason } from '../../engine/chase/chase';
import { BOSS, bossInfo, recordChase, starsFor } from '../../engine/campaign/profile';
import type { ChaseType, Vehicle } from '../../engine/chase/settings';
import type { TravelMode } from '../../engine/world/graph';
import { loadProgress, saveProgress } from '../campaignStore';
import { lookContext } from '../lookStore';
import { loadProfile, saveProfile, today } from '../profileStore';
import { debugState } from '../debug/debugState';
import { addEntry, boardFor, scoreCode } from '../../engine/campaign/daily';
import { loadBoard, saveBoard } from '../dailyStore';
import { onlineOn, submitScore } from '../online/onlineBoard';
import { loadEscapeProgress, newEscapeSeed, saveEscapeProgress } from '../escapeStore';
import { nextOfficer, officerInfo, officerUnlocked, OFFICERS, recordEscape, type OfficerInfo } from '../../engine/campaign/officers';
import { PALETTE, toCss } from '../palette';
import { backdrop, MEDAL_NAMES, medalBadge, Menu, paper, rankLine, SCREEN_PICTURES, text } from '../ui/ui';

export interface ResultsData {
  seed: string;
  /** Campaign mission (0-based), or null for a practice chase. */
  mission: number | null;
  /** A hidden boss's picture id, or null. */
  boss: string | null;
  stats: MissionStats;
  /** For the player's record: the clock, the look, the mode at the end, and the suspect's file. */
  timeLimit: number;
  night: boolean;
  mode: TravelMode;
  lastSeen: string | null;
  vehicle: Vehicle | null;
  chaseType: ChaseType;
  escapeReason?: EscapeReason;
  /** Escape Mode: the player was the fugitive, and `stats.captured` means they reached the hideout. */
  escape?: boolean;
  /** The escape campaign's officer (officers.ts id), when the escape was from one. */
  officer?: string;
  /** Le défi du jour: the day of the daily chase, and whether this was the try that counts. */
  daily?: string;
  dailyOfficial?: boolean;
}

const LINE_LABELS: Record<ScoreLine['key'], (count: number) => string> = {
  CAPTURE: () => 'Suspect arrested',
  TIME: (n) => `Time left: ${n} s`,
  SIGHTINGS: (n) => `Right sightings: ${n}`,
  TRANSPORT: (n) => `Transport changes: ${n}`,
  WRONG_TURNS: (n) => `Wrong turns: ${n}`,
  REPEATS: (n) => `Repeats: ${n}`,
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
    const escape = this.result.escape === true;
    const score = scoreMission(stats);
    const captured = stats.captured;
    menuMusic.stop(0.2);
    if (captured) jingles.victory();
    else jingles.defeat();
    debugState.info.set('score', String(score.total));
    debugState.info.set('medal', score.medal ?? '-');

    let best = false;
    let caseDone = false;
    // What the garage holds before this chase is recorded, to show what it newly earned.
    const lookBefore = lookContext();
    if (mission !== null) {
      const before = loadProgress();
      const after = recordMission(before, mission, score);
      saveProgress(after);
      best = score.total > (before.missions[mission]?.bestScore ?? -1) && (before.missions[mission] ?? null) !== null;
      caseDone = isComplete(after);
    }
    // The player's record: points towards the next rank, badges, and the suspect's case file.
    const boss = this.result.boss ? bossInfo(this.result.boss) ?? BOSS : null;
    const previousBest = boss ? loadProfile().files[boss.picture]?.bestScore ?? -1 : -1;
    const recorded = recordChase(loadProfile(), {
      stats,
      score,
      timeLimit: this.result.timeLimit,
      night: this.result.night,
      mode: this.result.mode,
      suspect: boss ? boss.picture : mission !== null ? MISSIONS[mission]!.picture : null,
      lastSeen: this.result.lastSeen,
      vehicle: this.result.vehicle,
      chaseType: this.result.chaseType,
      campaign: loadProgress(),
      date: today(),
      ...(escape ? { escape: true } : {}),
    });
    saveProfile(recorded.profile);
    if (boss && captured) best = score.total > previousBest;
    const daily = this.result.daily ? this.recordDaily(this.result.daily, score.total, starsFor(stats)) : null;
    const unlocked = newlyEarned(lookBefore, lookContext()).map((c) => `${SLOT_NAMES[c.slot]}: ${c.name}`);
    // The escape campaign: the officer's file, and any officer this opened.
    const officer = escape ? officerInfo(this.result.officer) ?? null : null;
    let opened: OfficerInfo[] = [];
    if (officer) {
      const before = loadEscapeProgress();
      const after = recordEscape(before, officer.id, { escaped: captured, score: score.total, stars: starsFor(stats) });
      saveEscapeProgress(after);
      best = captured && score.total > (before.records[officer.id]?.bestScore ?? -1) && before.records[officer.id] !== undefined;
      opened = OFFICERS.filter((o) => !officerUnlocked(before, o.id) && officerUnlocked(after, o.id));
    }

    // Escape Mode shows the fugitive's side: the getaway for a win, the arrest for a loss.
    backdrop(this, escape ? (captured ? SCREEN_PICTURES.escapeWon : SCREEN_PICTURES.escapeCaught) : captured ? SCREEN_PICTURES.captured : SCREEN_PICTURES.escaped);
    // Clear of the full-screen button in the top-right corner.
    const x = 628;
    paper(this, x, 30, 600, 600, 0.95);
    const left = x + 32;
    text(this, left, 50, officer ? `ESCAPE: ${officer.nickname.toUpperCase()}` : escape ? 'ESCAPE' : daily ? 'DAILY CHALLENGE' : boss ? `SPECIAL MISSION: ${boss.nickname.toUpperCase()}` : mission === null ? 'PRACTICE' : `MISSION ${mission + 1} / ${MISSION_COUNT}`, 22, {
      bold: true,
      color: toCss(PALETTE.seaDeep),
    });
    // Stars for the chase (★ caught, ★★ no wrong turn, ★★★ no repeat): replaying for all three means more listening.
    if (!escape || officer) {
      const stars = starsFor(stats);
      for (let i = 0; i < 3; i++) {
        const on = i < stars;
        const star = this.add.star(x + 476 + i * 44, 64, 5, 9, 20, on ? 0xf2c230 : 0xcfc6ae).setStrokeStyle(2.5, on ? 0x9c7a12 : 0x9a917c);
        if (on) this.tweens.add({ targets: star, scale: { from: 0, to: 1 }, delay: 300 + i * 260, duration: 300, ease: 'Back.easeOut' });
      }
    }
    const headline = escape ? (captured ? 'You lost the police!' : 'You are under arrest.') : captured ? 'Mission complete!' : 'The suspect got away.';
    text(this, left, captured ? 80 : 86, headline, captured && !escape ? 40 : 34, {
      bold: true,
      color: toCss(captured ? 0x2e8b57 : PALETTE.terracotta),
    });
    const nickname = boss ? ` « ${boss.nickname} »` : mission !== null ? ` « ${MISSIONS[mission]!.nickname} »` : '';
    const detail = escape
      ? captured
        ? officer
          ? `${officer.nickname} lost your trail!`
          : 'You reached the hideout.'
        : this.result.escapeReason === 'TIME'
          ? 'Time is up: the roadblocks were in place.'
          : officer
            ? `${officer.nickname} caught you.`
            : 'The police caught you.'
      : captured
        ? `You caught the suspect${nickname}!`
        : 'Time is up.';
    text(this, left, 134, detail, 22, { wordWrap: { width: 540 } });

    let y = 182;
    for (const line of score.lines) {
      text(this, left, y, escape && line.key === 'CAPTURE' ? 'Hideout reached' : LINE_LABELS[line.key](line.count), 21);
      text(this, x + 568, y, `${line.points > 0 ? '+' : ''}${line.points}`, 21, {
        bold: true,
        color: toCss(line.points < 0 ? PALETTE.terracotta : PALETTE.ink),
      }).setOrigin(1, 0);
      y += 31;
    }
    if (score.lines.length === 0) {
      text(this, left, y, 'No points this time.', 21);
      y += 31;
    }
    this.add.rectangle(left, y + 6, 536, 2, PALETTE.ink).setOrigin(0);
    text(this, left, y + 16, 'TOTAL', 26, { bold: true });
    text(this, x + 568, y + 16, `${score.total}`, 26, { bold: true }).setOrigin(1, 0);
    text(this, left, y + 56, `Listening accuracy: ${Math.round(score.accuracy * 100)}%`, 21, { color: toCss(PALETTE.seaDeep) });

    let note = y + 92;
    if (score.medal) {
      medalBadge(this, left + 26, note + 34, score.medal, 24);
      text(this, left + 64, note + 20, `Medal: ${MEDAL_NAMES[score.medal]}`, 24, { bold: true });
      note += 74;
    }
    if (best) {
      text(this, left, note, 'New record!', 22, { bold: true, color: toCss(PALETTE.terracotta) });
      note += 30;
    }
    if (unlocked.length > 0) {
      // Room for a couple of lines above the rank bar; the rest wait in the garage.
      const shown = unlocked.slice(0, 2).join('  ·  ') + (unlocked.length > 2 ? `  (+${unlocked.length - 2})` : '');
      const line = text(this, left, note, `Garage 🔓 ${shown}`, 19, { bold: true, color: toCss(0x2e8b57), wordWrap: { width: 536 } });
      note += line.height + 6;
    }
    if (opened.length > 0) {
      const line = text(this, left, note, `${opened.some((o) => o.hidden) ? '🏍️ Secret squad open' : '🔓 New officer'}: ${opened.map((o) => o.nickname).join(', ')}`, 20, {
        bold: true,
        color: toCss(PALETTE.terracotta),
        wordWrap: { width: 536 },
      });
      note += line.height + 6;
    }
    if (recorded.newBadges.length > 0) {
      const one = recorded.newBadges.length === 1;
      const list = recorded.newBadges.map((b) => `${b.icon} ${b.name}`).join('   ');
      const badges = text(this, left, note, `${one ? 'New badge' : 'New badges'}: ${list}!`, 20, { bold: true, color: toCss(PALETTE.seaDeep), wordWrap: { width: 536 } });
      note += badges.height + 6;
    }
    if (recorded.rankAfter.id !== recorded.rankBefore.id) {
      text(this, left, note, `New rank: ${recorded.rankAfter.name}!`, 22, { bold: true, color: toCss(PALETTE.terracotta) });
    }
    // Rank and points, along the bottom of the sheet.
    rankLine(this, left, 562, recorded.profile.points, 536);

    const menu = new Menu(this);
    if (daily) {
      this.dailyCard(daily);
      menu.add(x + 300, 680, 340, 60, 'CLASS BOARD  ▶', () => this.scene.start('Daily'), { size: 22 });
      menu.add(x - 330, 680, 220, 60, 'MENU', () => this.scene.start('Title'), { key: 'ESC', size: 22 });
    } else if (officer) {
      const next = nextOfficer(loadEscapeProgress(), officer.id);
      menu.add(x + 300, 680, 340, 60, next ? 'NEXT OFFICER  ▶' : 'OFFICERS  ▶', () => this.scene.start('Officers', next ? { show: next.id } : {}), { size: 22 });
      menu.add(x - 60, 680, 240, 60, 'TRY AGAIN (R)', () => this.scene.start('Escape', { seed: newEscapeSeed(officer), officer: officer.id }), { key: 'R', size: 22 });
      menu.add(x - 330, 680, 220, 60, 'OFFICERS', () => this.scene.start('Officers'), { key: 'ESC', size: 22 });
    } else if (escape) {
      menu.add(x + 300, 680, 340, 60, 'NEW ESCAPE', () => this.scene.start('Practice', { autostart: true, escape: true }), { size: 22 });
      menu.add(x - 60, 680, 240, 60, 'REPLAY (R)', () => this.scene.start('Escape', { seed: this.result.seed }), { key: 'R', size: 22 });
      menu.add(x - 330, 680, 220, 60, 'MENU', () => this.scene.start('Title'), { key: 'ESC', size: 22 });
    } else if (boss) {
      menu.add(x + 300, 680, 340, 60, 'POLICE STATION  ▶', () => this.scene.start('Commissariat'), { size: 22 });
      menu.add(x - 60, 680, 240, 60, 'TRY AGAIN (R)', () => this.scene.start('Briefing', { boss: boss.picture }), { key: 'R', size: 22 });
      menu.add(x - 330, 680, 220, 60, 'MENU', () => this.scene.start('Title'), { key: 'ESC', size: 22 });
    } else if (mission !== null) {
      const last = mission + 1 >= MISSION_COUNT;
      const nextLabel = caseDone && last ? 'CASE CLOSED  ▶' : last ? 'CASE FILE  ▶' : 'NEXT MISSION  ▶';
      menu.add(x + 300, 680, 340, 60, nextLabel, () => {
        if (caseDone && last) this.scene.start('CaseClosed');
        else if (last) this.scene.start('Campaign');
        else this.scene.start('Briefing', { mission: mission + 1 });
      });
      menu.add(x - 60, 680, 240, 60, 'TRY AGAIN (R)', () => this.scene.start('Briefing', { mission }), { key: 'R', size: 22 });
      menu.add(x - 330, 680, 220, 60, 'CASE FILE', () => this.scene.start('Campaign'), { key: 'ESC', size: 22 });
    } else {
      menu.add(x + 300, 680, 340, 60, 'NEW CHASE', () => this.scene.start('Practice', { autostart: true }), { size: 22 });
      menu.add(x - 60, 680, 240, 60, 'REPLAY (R)', () => this.scene.start('Chase', { seed: this.result.seed }), { key: 'R', size: 22 });
      menu.add(x - 330, 680, 220, 60, 'MENU', () => this.scene.start('Title'), { key: 'ESC', size: 22 });
    }
    text(this, 24, 24, `${escape ? 'Escape' : 'Chase'} ${this.result.seed}`, 16, { color: toCss(PALETTE.cream), backgroundColor: 'rgba(22, 50, 61, 0.7)', padding: { x: 8, y: 4 } });
  }

  /** The daily chase's first try goes on this device's class board, with a score code for the teacher. */
  private recordDaily(date: string, total: number, stars: number): DailyResult {
    const board = loadBoard();
    if (!this.result.dailyOfficial || !board.nickname || !board.classCode) return { date, official: false, code: null, place: null, sent: null };
    const after = addEntry(board, { date, nickname: board.nickname, classCode: board.classCode, score: total, stars, local: true });
    saveBoard(after);
    const sent = onlineOn() ? submitScore({ date, nickname: board.nickname, classCode: board.classCode, score: total, stars }) : null;
    const list = boardFor(after, date, board.classCode);
    const place = list.findIndex((e) => e.local && e.nickname === board.nickname) + 1;
    return {
      date,
      official: true,
      code: scoreCode(date, board.nickname, board.classCode, { score: total, stars }),
      place: place > 0 ? { place, of: list.length, classCode: board.classCode, nickname: board.nickname } : null,
      sent,
    };
  }

  /** The score code, large enough to read across a classroom, on the left of the results sheet. */
  private dailyCard(daily: DailyResult): void {
    paper(this, 40, 404, 548, 236, 0.95);
    text(this, 64, 420, 'LE DÉFI DU JOUR', 24, { bold: true, color: toCss(PALETTE.terracotta) });
    if (!daily.official || !daily.code) {
      text(this, 64, 460, 'Practice try: only your first try of the day goes on the class board. Come back tomorrow for a new chase!', 21, { wordWrap: { width: 500 } });
      return;
    }
    text(this, 64, 458, `${daily.place?.nickname ?? ''}  ·  class ${daily.place?.classCode ?? ''}`, 20);
    text(this, 64, 490, 'Score code:', 20);
    text(this, 314, 520, daily.code, 54, { bold: true, color: toCss(PALETTE.seaDeep), letterSpacing: 4 }).setOrigin(0.5, 0);
    const where = daily.place ? `Place ${daily.place.place} of ${daily.place.of} on this device · show the code to your teacher` : 'Show the code to your teacher';
    const line = text(this, 64, 590, daily.sent ? '🌐 Sending to the online class board…' : where, 17, { wordWrap: { width: 500 } });
    void daily.sent?.then((ok) => {
      if (!line.active) return;
      line.setText(ok ? '🌐 On the online class board ✓  (keep the code as a backup)' : 'Could not reach the online board: it will try again later. Show the code to your teacher.');
    });
  }
}

interface DailyResult {
  date: string;
  official: boolean;
  code: string | null;
  place: { place: number; of: number; classCode: string; nickname: string } | null;
  /** The send to the online board (true once it arrived), or null when the online board is off. */
  sent: Promise<boolean> | null;
}
