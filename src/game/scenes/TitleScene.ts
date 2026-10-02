import Phaser from 'phaser';
import { parseSeed, type ChaseSeed } from '../../engine';
import type { AudioManifest } from '../../engine/audio/manifest';
import { capturedCount, isComplete, MISSION_COUNT } from '../../engine/campaign/campaign';
import { scannerAudio } from '../audio/ScannerAudio';
import { loadProgress } from '../campaignStore';
import { debugState } from '../debug/debugState';
import { GAME_HEIGHT, GAME_WIDTH, TITLE_PICTURE } from '../layout';
import { PALETTE, toCss } from '../palette';
import { Menu, text } from '../ui/ui';

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
    if (this.textures.exists(TITLE_PICTURE)) {
      this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, TITLE_PICTURE).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    } else {
      this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, PALETTE.seaDeep);
    }
    this.add.rectangle(GAME_WIDTH / 2, 336, 1180, 380, PALETTE.cream, 0.78).setStrokeStyle(3, PALETTE.ink, 0.5);

    text(this, GAME_WIDTH / 2, 196, 'Les Chasseurs de Primes Ultimes', 58, {
      bold: true,
      stroke: toCss(PALETTE.cream),
      strokeThickness: 8,
    }).setOrigin(0.5);
    text(this, GAME_WIDTH / 2, 266, 'BELLEVUE CITY', 28, { color: toCss(PALETTE.terracotta), letterSpacing: 10 }).setOrigin(0.5);

    const progress = loadProgress();
    const played = progress.missions.filter((m) => m !== null).length;
    const campaignLabel =
      played === 0 ? 'CAMPAGNE' : isComplete(progress) ? 'CAMPAGNE  ✓' : `CAMPAGNE  ·  mission ${progress.current + 1} / ${MISSION_COUNT}`;

    const menu = new Menu(this);
    const replay = this.seedFromAddress();
    if (replay) {
      menu.add(GAME_WIDTH / 2, 352, 560, 56, `REJOUER LA POURSUITE ${replay.code}`, () => this.replay(replay), { size: 22 });
    }
    const top = replay ? 420 : 370;
    menu.add(GAME_WIDTH / 2 - 210, top, 400, 64, campaignLabel, () => this.scene.start('Campaign'), { key: 'C', size: 22 });
    menu.add(GAME_WIDTH / 2 + 210, top, 400, 64, 'ENTRAÎNEMENT', () => this.scene.start('Practice'), { key: 'P' });
    const detail =
      played === 0
        ? '8 suspects, du niveau Facile au niveau Expert   ·   C : campagne   ·   P : entraînement'
        : `${capturedCount(progress)} / ${MISSION_COUNT} suspects arrêtés   ·   C : campagne   ·   P : entraînement`;
    text(this, GAME_WIDTH / 2, top + 62, detail, 19).setOrigin(0.5);
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
