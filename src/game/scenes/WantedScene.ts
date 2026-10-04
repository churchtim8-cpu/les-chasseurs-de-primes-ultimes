import Phaser from 'phaser';
import { menuMusic } from '../audio/Jingles';
import { bossInfo, bossUnlocked, EMPTY_FILE, SUSPECT_FILES } from '../../engine/campaign/profile';
import { loadProgress } from '../campaignStore';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { bossForced, loadProfile } from '../profileStore';
import { backdrop, Menu, SCREEN_PICTURES, suspectPictureKey, text } from '../ui/ui';

export interface WantedSceneData {
  /** The screen to go back to (the campaign folder or the police station). */
  back?: string;
}

/** Seconds as m:ss, the way the time is written on the poster. */
export function posterTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The wanted posters wall (Mr Henry, 2026-10-04): one old paper poster per
 * suspect. Once it has been arrested, its poster gets a red "ARRÊTÉ" stamp
 * with the student's quickest time and best stars written on it. The bosses'
 * posters stay hidden until they are found.
 */
export class WantedScene extends Phaser.Scene {
  static readonly KEY = 'Wanted';
  private back = 'Campaign';

  constructor() {
    super(WantedScene.KEY);
  }

  init(data: WantedSceneData): void {
    this.back = data?.back ?? 'Campaign';
  }

  create(): void {
    menuMusic.start();
    const { width } = this.scale;
    backdrop(this, SCREEN_PICTURES.briefing, 0.55);
    // A cork board behind the posters.
    this.add.rectangle(width / 2, 372, 1220, 560, 0x9b6b3d).setStrokeStyle(10, 0x5c3a1c);
    text(this, width / 2, 22, 'WANTED POSTERS', 38, { bold: true, color: toCss(PALETTE.cream) }).setOrigin(0.5, 0);

    const profile = loadProfile();
    const progress = loadProgress();
    const arrested = SUSPECT_FILES.filter((s) => (profile.files[s.picture]?.arrests ?? 0) > 0).length;
    text(this, width / 2, 68, `${arrested} / ${SUSPECT_FILES.length} arrested`, 18, { color: toCss(PALETTE.paleYellow) }).setOrigin(0.5, 0);

    SUSPECT_FILES.forEach((s, i) => {
      const boss = bossInfo(s.picture);
      const hidden = boss !== undefined && !(bossUnlocked(progress, profile, boss.picture) || bossForced());
      const col = i % 5;
      const row = Math.floor(i / 5);
      this.poster(s.picture, s.nickname, 158 + col * 241, 232 + row * 272, hidden, i);
    });

    const menu = new Menu(this);
    menu.add(width / 2, 680, 260, 50, 'BACK', () => this.scene.start(this.back), { key: 'ESC', size: 20 });
  }

  /** One poster, pinned slightly crooked. */
  private poster(picture: string, nickname: string, x: number, y: number, hidden: boolean, index: number): void {
    const f = loadProfile().files[picture] ?? EMPTY_FILE;
    const w = 206;
    const h = 252;
    const c = this.add.container(x, y).setRotation(((index * 37) % 7 - 3) * 0.012);
    const shadow = this.add.rectangle(5, 7, w, h, 0x000000, 0.3);
    const sheet = this.add.rectangle(0, 0, w, h, 0xeedfb8).setStrokeStyle(2, 0x8a6a3a);
    const pin = this.add.circle(0, -h / 2 + 10, 6, 0xc8302c).setStrokeStyle(1.5, 0x5a1010);
    const head = this.add.text(0, -h / 2 + 22, 'RECHERCHÉ', { fontFamily: FONT_FAMILY, fontSize: '26px', fontStyle: 'bold', color: '#4a2e12' }).setOrigin(0.5, 0);
    c.add([shadow, sheet, head]);

    const key = suspectPictureKey(picture);
    const py = -h / 2 + 58;
    if (!hidden && this.textures.exists(key)) {
      c.add(this.add.image(0, py + 56, key).setDisplaySize(118, 112));
    } else {
      c.add(this.add.rectangle(0, py + 56, 118, 112, 0x5a4630));
      c.add(this.add.text(0, py + 56, '?', { fontFamily: FONT_FAMILY, fontSize: '64px', fontStyle: 'bold', color: '#eedfb8' }).setOrigin(0.5));
    }
    c.add(this.add.rectangle(0, py + 56, 118, 112).setStrokeStyle(3, 0x4a2e12));
    c.add(this.add.text(0, py + 120, hidden ? '« ??? »' : `« ${nickname} »`, { fontFamily: FONT_FAMILY, fontSize: '18px', fontStyle: 'bold', color: '#4a2e12' }).setOrigin(0.5, 0));
    const reward = hidden ? 'Secret file' : f.arrests > 0 ? `Arrested ${f.arrests}×` : f.escapes > 0 ? 'Still on the run' : 'Not yet chased';
    c.add(this.add.text(0, py + 146, reward, { fontFamily: FONT_FAMILY, fontSize: '14px', color: '#6a4a22' }).setOrigin(0.5, 0));
    c.add(pin);

    if (f.arrests > 0) {
      // The red rubber stamp, slapped across the picture with the time and stars.
      const time = f.quickest !== null ? posterTime(f.quickest) : '';
      const stars = '★'.repeat(f.stars) + '☆'.repeat(3 - f.stars);
      const red = '#c8202c';
      const word = this.add.text(0, -12, 'ARRÊTÉ', { fontFamily: FONT_FAMILY, fontSize: '38px', fontStyle: 'bold', color: red }).setOrigin(0.5);
      const info = this.add.text(0, 22, `${time}   ${stars}`, { fontFamily: FONT_FAMILY, fontSize: '20px', fontStyle: 'bold', color: red }).setOrigin(0.5);
      // Inked on a pale patch so the time and stars read over the picture.
      const frame = this.add.rectangle(0, 4, 180, 86, 0xf6ead0, 0.82).setStrokeStyle(5, 0xc8202c);
      const stamp = this.add.container(0, py + 66, [frame, word, info]).setRotation(-0.22).setAlpha(0.95);
      c.add(stamp);
    }
  }
}
