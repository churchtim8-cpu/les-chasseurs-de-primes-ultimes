import Phaser from 'phaser';
import { menuMusic } from '../audio/Jingles';
import { DIFFICULTY_SETTINGS, type RepeatRule, type TextDisplay } from '../../engine';
import { TRANSPORT_LINES } from '../../engine/audio/script';
import { MISSION_COUNT, MISSIONS } from '../../engine/campaign/campaign';
import { BOSS, bossInfo, type BossInfo } from '../../engine/campaign/profile';
import { CHASE_TYPE_MODES } from '../../engine/chase/settings';
import { generateScenario } from '../../engine/chase/scenario';
import { vehicleLine } from '../../engine/language/sightings';
import { TownGraph } from '../../engine/world/graph';
import { BELLEVUE } from '../../content/map/bellevue';
import { scannerAudio } from '../audio/ScannerAudio';
import { debugState } from '../debug/debugState';
import { PALETTE, toCss } from '../palette';
import { scenarioOptionsFromAddress } from '../scenarioOptions';
import { newSeed } from '../seedSource';
import { backdrop, Menu, paper, SCREEN_PICTURES, suspectPictureKey, text } from '../ui/ui';

export interface BriefingData {
  /** 0-based campaign mission (ignored for a boss). */
  mission?: number;
  /** A hidden boss's picture id ("boss", "patronne") instead of a campaign mission. */
  boss?: string;
}

const REPEAT_RULES: Record<RepeatRule['kind'], (rule: RepeatRule) => string> = {
  UNLIMITED: () => 'as many as you like',
  LIMITED: (rule) => `${rule.kind === 'LIMITED' ? rule.maxPerChase : 0} per chase`,
  COSTS_TIME: (rule) => `each repeat costs ${rule.kind === 'COSTS_TIME' ? rule.secondsPerRepeat : 0} seconds`,
  ONCE: () => 'just one',
};

const TEXT_RULES: Record<TextDisplay, string> = {
  BRIEF: 'yes',
  BRIEF_THEN_REMOVED: 'for a few seconds only',
  AUDIO_ONLY: 'no: listen only',
};

/**
 * Mission briefing and intro (blueprint section 20): the suspect's file
 * (number, nickname, status), the level and its rules, and the scanner's
 * first information, which can be played before starting. The chase seed is
 * made here so the briefing describes the exact chase that follows.
 */
export class BriefingScene extends Phaser.Scene {
  static readonly KEY = 'Briefing';
  private mission = 0;
  private boss: BossInfo | null = null;

  constructor() {
    super(BriefingScene.KEY);
  }

  init(data: BriefingData): void {
    this.mission = Math.max(0, Math.min(MISSION_COUNT - 1, data.mission ?? 0));
    this.boss = data.boss ? bossInfo(data.boss) ?? BOSS : null;
  }

  create(): void {
    const { boss } = this;
    const mission = boss ?? MISSIONS[this.mission]!;
    menuMusic.start();
    const settings = DIFFICULTY_SETTINGS[mission.difficulty];
    const seed = newSeed(mission.difficulty);
    const options = boss ? { ...scenarioOptionsFromAddress(), chaseType: boss.chaseType } : scenarioOptionsFromAddress();
    const scenario = generateScenario(new TownGraph(BELLEVUE), seed.code, options);
    const vehicle = scenario.vehicles[0];
    const firstLine = vehicle ? vehicleLine(vehicle) : TRANSPORT_LINES.ON_FOOT;
    scannerAudio.preload([firstLine.audioId]);
    debugState.info.set('seed', seed.code);
    debugState.info.set('mission', boss ? 'BOSS' : `${this.mission + 1} / ${MISSION_COUNT}`);

    backdrop(this, SCREEN_PICTURES.briefing, 0.3);

    // The suspect's photo, clipped to the file like a mugshot.
    paper(this, 60, 92, 360, 450);
    const photo = suspectPictureKey(mission.picture);
    if (this.textures.exists(photo)) this.add.image(80, 112, photo).setOrigin(0).setDisplaySize(320, 320);
    this.add.rectangle(80, 112, 320, 320).setOrigin(0).setStrokeStyle(3, PALETTE.ink);
    text(this, 240, 450, `« ${mission.nickname} »`, 32, { bold: true }).setOrigin(0.5, 0);
    text(this, 240, 496, 'RECHERCHÉ', 22, { bold: true, color: toCss(PALETTE.terracotta), letterSpacing: 6 }).setOrigin(0.5, 0);

    // The file itself.
    paper(this, 460, 60, 760, 540);
    const x = 496;
    text(this, x, 84, boss ? 'SPECIAL MISSION' : `MISSION ${this.mission + 1} / ${MISSION_COUNT}`, 40, { bold: true, color: toCss(PALETTE.terracotta) });
    text(this, x, 142, boss ? `Gang leader: « ${mission.nickname} »` : `Suspect no. ${this.mission + 1}: « ${mission.nickname} »`, 26, { bold: true });
    text(this, x, 180, 'Status: on the run', 22);
    text(this, x, 212, `Level: ${settings.label.en}`, 22);

    text(this, x, 262, 'First news from the scanner:', 20, { color: toCss(PALETTE.seaDeep), bold: true });
    text(this, x, 292, `« ${firstLine.text} »`, 28, { bold: true, wordWrap: { width: 690 } });

    const limit = settings.timeLimitSeconds + (boss?.extraSeconds ?? 0);
    const minutes = Math.floor(limit / 60);
    const seconds = String(limit % 60).padStart(2, '0');
    const rules = [
      `Time: ${minutes}:${seconds}`,
      `Repeats: ${REPEAT_RULES[settings.repeat.kind](settings.repeat)}`,
      `Text on screen: ${TEXT_RULES[settings.textDisplay]}`,
    ];
    text(this, x, 360, 'Rules', 20, { color: toCss(PALETTE.seaDeep), bold: true });
    rules.forEach((rule, i) => text(this, x + 12, 392 + i * 32, `•  ${rule}`, 21));
    text(this, x, 500, boss ? `Three stages: ${stagesLine(boss)}. ${mission.nickname} will not be caught easily!` : 'Listen carefully to the scanner and follow the directions!', 21, { fontStyle: 'italic', wordWrap: { width: 690 } });

    const menu = new Menu(this);
    menu.add(840, 650, 300, 60, 'START  ▶', () => this.start(seed.code), { size: 26 });
    menu.add(530, 650, 280, 60, '🔊  LISTEN (R)', () => void scannerAudio.play([{ audioId: firstLine.audioId, radio: true }]), {
      key: 'R',
      size: 22,
    });
    menu.add(1120, 650, 200, 60, boss ? 'BACK' : 'CASE FILE', () => this.scene.start(boss ? 'Commissariat' : 'Campaign'), { key: 'ESC', size: 22 });
    menu.add(240, 650, 260, 60, 'MENU', () => this.scene.start('Title'), { size: 22 });
  }

  private start(seed: string): void {
    scannerAudio.stop();
    this.scene.start('Chase', this.boss ? { seed, boss: this.boss.picture } : { seed, mission: this.mission });
  }
}

/** "by car, on foot, then by car" for a boss's three-stage chase. */
function stagesLine(boss: BossInfo): string {
  const words = CHASE_TYPE_MODES[boss.chaseType].map((m) => (m === 'CAR' ? 'by car' : 'on foot'));
  return `${words.slice(0, -1).join(', ')}, then ${words[words.length - 1]}`;
}
