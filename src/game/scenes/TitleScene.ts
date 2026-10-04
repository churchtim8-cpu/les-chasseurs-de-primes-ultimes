import Phaser from 'phaser';
import { menuMusic } from '../audio/Jingles';
import { nightOn, setNight } from '../render/night';
import { cycleFestival, festivalLabel } from '../render/festival';
import { cycleWeather, weatherChoice, WEATHER_ICONS, WEATHER_NAMES } from '../render/weather';
import { titleBackdropFx, titleFrontFx } from '../render/titleFx';
import { parseSeed, type ChaseSeed } from '../../engine';
import type { AudioManifest } from '../../engine/audio/manifest';
import { capturedCount, isComplete, MISSION_COUNT } from '../../engine/campaign/campaign';
import { scannerAudio } from '../audio/ScannerAudio';
import { rankFor } from '../../engine/campaign/profile';
import { loadProgress } from '../campaignStore';
import { loadProfile } from '../profileStore';
import { debugState } from '../debug/debugState';
import { GAME_HEIGHT, GAME_WIDTH, TITLE_PICTURE } from '../layout';
import { PALETTE, toCss } from '../palette';
import { Menu, text } from '../ui/ui';
import { openCommands } from './CommandsScene';

export { GAME_HEIGHT, GAME_WIDTH } from '../layout';

/**
 * Title screen (blueprint section 20): the game's name over the title
 * picture, then Campaign (the eight suspects) or Practice (one chase at a
 * chosen level). A `?seed=` in the address adds a button that replays that
 * exact chase.
 */
export class TitleScene extends Phaser.Scene {
  static readonly KEY = 'Title';

  constructor() {
    super(TitleScene.KEY);
  }

  create(): void {
    scannerAudio.setManifest(this.cache.json.get('audio-manifest') as AudioManifest | undefined);
    menuMusic.start();
    if (this.textures.exists(TITLE_PICTURE)) {
      this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, TITLE_PICTURE).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    } else {
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, PALETTE.seaDeep);
    }
    // Police glows at the edges and speed streaks, behind the panel.
    titleBackdropFx(this);
    const panel = { x: GAME_WIDTH / 2 - 590, y: 336 - 190, w: 1180, h: 380 };
    this.add.rectangle(GAME_WIDTH / 2, 336, panel.w, panel.h, PALETTE.cream, 0.78).setStrokeStyle(3, PALETTE.ink, 0.5);

    const title = text(this, GAME_WIDTH / 2, 196, 'Les Chasseurs de Primes Ultimes', 58, {
      bold: true,
      stroke: toCss(PALETTE.cream),
      strokeThickness: 8,
    }).setOrigin(0.5);
    text(this, GAME_WIDTH / 2, 266, 'BELLEVUE CITY', 28, { color: toCss(PALETTE.terracotta), letterSpacing: 10 }).setOrigin(0.5);
    // The flashing light bar, the scanner sweep and the pulsing title (under the buttons).
    titleFrontFx(this, panel, title);

    const progress = loadProgress();
    const played = progress.missions.filter((m) => m !== null).length;
    const campaignLabel =
      played === 0 ? 'CAMPAIGN' : isComplete(progress) ? 'CAMPAIGN  ✓' : `CAMPAIGN  ·  mission ${progress.current + 1} / ${MISSION_COUNT}`;

    const menu = new Menu(this);
    const replay = this.seedFromAddress();
    if (replay) {
      menu.add(GAME_WIDTH / 2, 352, 560, 56, `REPLAY CHASE ${replay.code}`, () => this.replay(replay), { size: 22 });
    }
    const top = replay ? 420 : 370;
    menu.add(GAME_WIDTH / 2 - 210, top, 400, 64, campaignLabel, () => this.scene.start('Campaign'), { key: 'C', size: 22 });
    menu.add(GAME_WIDTH / 2 + 210, top, 400, 64, 'PRACTICE', () => this.scene.start('Practice'), { key: 'P' });
    const profile = loadProfile();
    const rank = rankFor(profile.points);
    const detail =
      played === 0
        ? '8 suspects, from Easy to Expert   ·   C: campaign   ·   P: practice   ·   E: escape'
        : `${capturedCount(progress)} / ${MISSION_COUNT} suspects arrested   ·   Rank: ${rank.name} (${profile.points.toLocaleString('en-GB')} pts)`;
    text(this, GAME_WIDTH / 2, top + 62, detail, 19).setOrigin(0.5);
    // The police station (rank, badges, case files), Escape Mode (the player is the fugitive), and day or night in the town.
    menu.add(GAME_WIDTH / 2 - 432, top + 108, 276, 44, '🏅 POLICE STATION (O)', () => this.scene.start('Commissariat'), { key: 'O', size: 19 });
    menu.add(GAME_WIDTH / 2 - 144, top + 108, 276, 44, '🏃 ESCAPE (E)', () => this.scene.start('Practice', { escape: true }), { key: 'E', size: 19 });
    const nightLabel = () => `🌙 NIGHT: ${nightOn() ? 'ON' : 'OFF'}`;
    menu.add(GAME_WIDTH / 2 + 144, top + 108, 276, 44, '🎮 CONTROLS (H)', () => openCommands(this), { key: 'H', size: 19 });
    const night = menu.add(GAME_WIDTH / 2 + 432, top + 108, 276, 44, nightLabel(), () => {
      setNight(!nightOn());
      night.label.setText(nightLabel());
    }, { key: 'N', size: 19 });
    // The garage (what the police drive and wear) and the wanted posters wall.
    menu.add(GAME_WIDTH / 2 - 432, top + 162, 276, 44, '📅 DAILY CHALLENGE (D)', () => this.scene.start('Daily'), { key: 'D', size: 18 });
    menu.add(GAME_WIDTH / 2 - 144, top + 162, 276, 44, '🔧 GARAGE (G)', () => this.scene.start('Garage', { back: 'Title' }), { key: 'G', size: 19 });
    menu.add(GAME_WIDTH / 2 + 144, top + 162, 276, 44, '📜 POSTERS (W)', () => this.scene.start('Wanted', { back: 'Title' }), { key: 'W', size: 19 });
    // Rain and fog hide more of the town, so the French matters even more (T for "temps").
    const weatherLabel = () => `${WEATHER_ICONS[weatherChoice()]} WEATHER: ${WEATHER_NAMES[weatherChoice()].toUpperCase()}`;
    const weather = menu.add(GAME_WIDTH / 2 + 432, top + 162, 276, 44, weatherLabel(), () => {
      cycleWeather();
      weather.label.setText(weatherLabel());
    }, { key: 'T', size: 18 });
    // Bellevue en fête: Carnival and Christmas decorations (by the calendar unless chosen).
    const fete = menu.add(GAME_WIDTH / 2, top + 216, 400, 40, festivalLabel(), () => {
      cycleFestival();
      fete.label.setText(festivalLabel());
    }, { size: 17 });
  }

  private replay(seed: ChaseSeed): void {
    debugState.info.set('seed', seed.code);
    this.scene.start('Chase', { seed: seed.code });
  }

  /** `?seed=BV-E-...` replays one chase; it is offered once, then removed from the address. */
  private seedFromAddress(): ChaseSeed | undefined {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('seed');
    if (!code) return undefined;
    params.delete('seed');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    const parsed = parseSeed(code);
    return parsed.ok ? parsed.seed : undefined;
  }
}
