import Phaser from 'phaser';
import type { ChaseStatus } from '../../engine/chase/chase';
import type { SightingCard } from '../../engine/chase/sightings';
import { LOCATION_WORD_BY_ID, withArticle } from '../../engine/language/locations';
import { drawRunner, drawVehicle } from '../render/actors';
import type { TravelMode } from '../../engine/world/graph';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { FULLSCREEN_BUTTON } from '../layout';

/** The HUD's glass panels, in the garage's screen theme (a police tablet by default). */
export const HUD_THEMES: Record<string, { fill: number; edge: number; radar: number; radarBack: number; label: number }> = {
  TABLETTE: { fill: 0x0b1d26, edge: PALETTE.lightBlue, radar: 0x6fcf7c, radarBack: 0x0d3324, label: PALETTE.lightBlue },
  RETRO: { fill: 0x03140a, edge: 0x39ff6a, radar: 0x39ff6a, radarBack: 0x02200c, label: 0x7dff9a },
  CARNAVAL: { fill: 0x2a0f3d, edge: 0xf2c230, radar: 0xff4fa3, radarBack: 0x3d0f45, label: 0xf2c230 },
  OR: { fill: 0x1c1608, edge: 0xf0c53c, radar: 0xf0c53c, radarBack: 0x2a2008, label: 0xf0c53c },
  OCEAN: { fill: 0x062a33, edge: 0x3ad1c8, radar: 0x7ff0e6, radarBack: 0x083d3a, label: 0x9fe8e0 },
  NUIT: { fill: 0x0c0a2a, edge: 0x8a7cff, radar: 0xb8aaff, radarBack: 0x1a1550, label: 0xc9c0ff },
  ROSE: { fill: 0x3a0f2a, edge: 0xff7ab8, radar: 0xffb3d9, radarBack: 0x4d1438, label: 0xffc2e2 },
};
const GLASS = { fill: 0x0b1d26, alpha: 0.84, edge: PALETTE.lightBlue as number, edgeAlpha: 0.55, radius: 10, radar: 0x6fcf7c, radarBack: 0x0d3324, label: PALETTE.lightBlue as number };
const RED = 0xe0463a;
const BLUE = 0x2f7de1;
const GREEN = 0x6fcf7c;
const AMBER = 0xe8c547;
/** The last seconds of the clock flash red. */
const HURRY_SECONDS = 15;
/** Left column: mission badge, the radar with the signal, then the buttons. */
const LEFT = { x: 16, w: 300 } as const;
const RADAR = { y: 70, h: 92, r: 34 } as const;
const BUTTONS = { y: 174, h: 36, gap: 8 } as const;

function glass(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, edge: number = GLASS.edge): void {
  g.fillStyle(0x000000, 0.3).fillRoundedRect(x + 3, y + 4, w, h, GLASS.radius);
  g.fillStyle(GLASS.fill, GLASS.alpha).fillRoundedRect(x, y, w, h, GLASS.radius);
  g.lineStyle(2, edge, GLASS.edgeAlpha).strokeRoundedRect(x, y, w, h, GLASS.radius);
}

interface HudButton {
  panel: Phaser.GameObjects.Graphics;
  hit: Phaser.GameObjects.Zone;
  key: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
}

/**
 * Chase HUD (blueprint section 19, made more immersive at Mr Henry's request,
 * 2026-10-03): a police tablet's dark glass panels. Top left the mission
 * badge, then a radar sweeping for the suspect's signal, then the buttons
 * (Répéter, Musique, Carte) with their keys; the clock in the middle with
 * flashing lights and a draining bar; the transport top right; the scanner
 * call along the bottom like a radio read-out. TAB hides the panels (the
 * scanner, messages and questions still show). The correct route is never
 * drawn and there is no "CORRECT!" feedback.
 */
export class Hud {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly timer: Phaser.GameObjects.Text;
  private readonly timerLights: Phaser.GameObjects.Rectangle[];
  private readonly timeBar: Phaser.GameObjects.Rectangle;
  private readonly timeBarWidth = 168;
  private longest = 0;
  private readonly mode: Phaser.GameObjects.Text;
  private readonly modeIcon: Phaser.GameObjects.Graphics;
  private shownMode: TravelMode | null = null;
  private readonly signalPanel: Phaser.GameObjects.Graphics;
  private readonly radar: Phaser.GameObjects.Graphics;
  private readonly signalBars: Phaser.GameObjects.Rectangle[] = [];
  private readonly signalLabel: Phaser.GameObjects.Text;
  private readonly signalState: Phaser.GameObjects.Text;
  private warningShown: boolean | null = null;
  private readonly toast: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly scanner: Phaser.GameObjects.Text;
  private readonly scannerPanel: Phaser.GameObjects.Graphics;
  private readonly scannerTag: Phaser.GameObjects.Text;
  private readonly scannerLed: Phaser.GameObjects.Arc;
  private readonly repeat: HudButton;
  private readonly music: HudButton;
  private readonly facing: HudButton;
  /** Pause (ÉCHAP on a keyboard): a button too, for phones and tablets (Mr Henry, 2026-10-04). */
  private readonly pauseButton: HudButton;
  private readonly sighting: SightingPanel;
  /** The panels TAB hides (the scanner call, banners, messages and questions always show). */
  private readonly chrome: Phaser.GameObjects.GameObject[] = [];
  private shown = true;

  constructor(
    private readonly scene: Phaser.Scene,
    /** Top-left label, e.g. "MISSION 4 / 8" (or "ENTRAÎNEMENT" in practice). */
    missionLabel: string,
    /** What the signal measures: the suspect's signal, or "POLICE" in Escape Mode. */
    private readonly signalName = 'SIGNAL',
    /** The garage's screen theme. */
    theme = 'TABLETTE',
  ) {
    Object.assign(GLASS, HUD_THEMES[theme] ?? HUD_THEMES.TABLETTE);
    const { width, height } = scene.scale;
    const label = (x: number, y: number, value: string, size: number, colour: number = PALETTE.cream) =>
      scene.add.text(x, y, value, { fontFamily: FONT_FAMILY, fontSize: `${size}px`, fontStyle: 'bold', color: toCss(colour) });

    // Mission badge: a gold police shield and the mission.
    const badge = this.chromed(scene.add.graphics());
    glass(badge, LEFT.x, 14, LEFT.w, 44);
    badge.fillStyle(AMBER).fillPoints(shield(LEFT.x + 24, 36, 13), true);
    badge.fillStyle(0x9c7a12).fillCircle(LEFT.x + 24, 34, 4);
    this.chromed(label(LEFT.x + 46, 36, missionLabel, 19)).setOrigin(0, 0.5);

    // The radar: a sweep turning round, the suspect's blip, the signal bars beside it.
    this.signalPanel = this.chromed(scene.add.graphics());
    this.radar = this.chromed(scene.add.graphics());
    this.signalLabel = this.chromed(label(LEFT.x + 98, RADAR.y + 14, signalName, 15, GLASS.label));
    this.signalState = this.chromed(label(LEFT.x + 98, RADAR.y + 66, '', 13, PALETTE.cream));
    for (let i = 0; i < 5; i++) {
      this.signalBars.push(this.chromed(scene.add.rectangle(LEFT.x + 100 + i * 18, RADAR.y + 60, 12, 10 + i * 6, PALETTE.cream).setOrigin(0, 1)));
    }

    // The buttons, each with its key.
    const button = (row: number): HudButton => {
      const y = BUTTONS.y + row * (BUTTONS.h + BUTTONS.gap);
      const panel = this.chromed(scene.add.graphics());
      glass(panel, LEFT.x, y, LEFT.w, BUTTONS.h);
      panel.fillStyle(PALETTE.cream).fillRoundedRect(LEFT.x + 6, y + 5, 26, BUTTONS.h - 10, 5);
      const key = this.chromed(label(LEFT.x + 19, y + BUTTONS.h / 2, '', 15, PALETTE.ink)).setOrigin(0.5);
      const text = this.chromed(label(LEFT.x + 42, y + BUTTONS.h / 2, '', 15)).setOrigin(0, 0.5);
      const hit = this.chromed(scene.add.zone(LEFT.x, y, LEFT.w, BUTTONS.h).setOrigin(0).setInteractive({ useHandCursor: true }));
      hit.on('pointerover', () => text.setColor(toCss(PALETTE.paleYellow)));
      hit.on('pointerout', () => text.setColor(toCss(PALETTE.cream)));
      return { panel, hit, key, label: text };
    };
    this.repeat = button(0);
    this.repeat.key.setText('R');
    this.music = button(1);
    this.music.key.setText('B');
    this.facing = button(2);
    this.facing.key.setText('V');
    this.pauseButton = button(3);
    this.pauseButton.key.setText('ESC').setFontSize(10);
    this.pauseButton.label.setText('❙❙  PAUSE');

    // The clock: red and blue lights either side, a bar draining underneath.
    const pod = this.chromed(scene.add.graphics());
    glass(pod, width / 2 - 110, 8, 220, 56);
    this.timerLights = [
      this.chromed(scene.add.rectangle(width / 2 - 96, 34, 8, 34, RED).setOrigin(0.5)),
      this.chromed(scene.add.rectangle(width / 2 + 96, 34, 8, 34, BLUE).setOrigin(0.5)),
    ];
    this.timer = this.chromed(label(width / 2, 31, '0:00', 32)).setOrigin(0.5);
    this.chromed(scene.add.rectangle(width / 2, 55, this.timeBarWidth, 5, 0x33464f).setOrigin(0.5));
    this.timeBar = this.chromed(scene.add.rectangle(width / 2 - this.timeBarWidth / 2, 55, this.timeBarWidth, 5, GREEN).setOrigin(0, 0.5));

    // How the player travels, left of the full-screen button.
    const modeRight = width - FULLSCREEN_BUTTON.size - 28;
    const modePanel = this.chromed(scene.add.graphics());
    glass(modePanel, modeRight - 196, 14, 196, 44);
    this.modeIcon = this.chromed(scene.add.graphics().setPosition(modeRight - 168, 36));
    this.mode = this.chromed(label(modeRight - 140, 36, '', 18)).setOrigin(0, 0.5);

    this.toast = this.add(
      scene.add
        .text(width / 2, 78, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '22px',
          fontStyle: 'bold',
          color: toCss(PALETTE.ink),
          backgroundColor: 'rgba(243, 214, 112, 0.96)',
          padding: { x: 16, y: 8 },
        })
        .setOrigin(0.5, 0)
        .setVisible(false),
    );
    // The police scanner: the French instruction as text, for as long as the level allows.
    this.scannerPanel = this.add(scene.add.graphics().setVisible(false));
    this.scannerTag = this.add(label(0, 0, 'SCANNER', 13, GLASS.radar).setVisible(false));
    this.scannerLed = this.add(scene.add.circle(0, 0, 5, GLASS.radar).setVisible(false));
    this.scanner = this.add(
      scene.add
        .text(width / 2, height - 30, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '28px',
          fontStyle: 'bold',
          color: toCss(PALETTE.cream),
          padding: { x: 24, y: 14 },
          align: 'center',
          wordWrap: { width: width - 160 },
        })
        .setOrigin(0.5, 1)
        .setVisible(false),
    );
    this.sighting = new SightingPanel(scene, (o) => this.add(o));
    this.banner = this.add(
      scene.add
        .text(width / 2, height / 2, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '96px',
          fontStyle: 'bold',
          color: toCss(PALETTE.cream),
          stroke: toCss(PALETTE.ink),
          strokeThickness: 10,
          shadow: { offsetX: 0, offsetY: 6, color: '#000000', blur: 12, fill: true, stroke: true },
        })
        .setOrigin(0.5)
        .setVisible(false),
    );
  }

  update(status: ChaseStatus, mode: TravelMode): void {
    const now = this.scene.time.now;
    const seconds = Math.ceil(status.timeLeft);
    const hurry = seconds <= HURRY_SECONDS;
    put(this.timer, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, hurry ? '#ffb4a2' : toCss(PALETTE.cream));
    // The lights take turns, faster and brighter in the last seconds.
    const beat = Math.floor(now / (hurry ? 180 : 520)) % 2;
    this.timerLights.forEach((light, i) => light.setAlpha(i === beat ? (hurry ? 1 : 0.85) : 0.18));
    this.longest = Math.max(this.longest, status.timeLeft);
    const share = this.longest > 0 ? Math.max(0, status.timeLeft / this.longest) : 0;
    this.timeBar.width = this.timeBarWidth * share;
    this.timeBar.setFillStyle(share > 0.5 ? GREEN : share > 0.2 ? AMBER : RED);

    if (mode !== this.shownMode) {
      this.shownMode = mode;
      this.mode.setText(mode === 'CAR' ? 'IN THE CAR' : 'ON FOOT');
      this.modeIcon.clear();
      if (mode === 'CAR') {
        this.modeIcon.setScale(1.5);
        this.modeIcon.fillStyle(0xf7f7f2).fillRoundedRect(-9, -4.8, 18, 9.6, 2.5);
        this.modeIcon.fillStyle(0x1f4e9c).fillRect(-9, -1.4, 18, 2.8);
        this.modeIcon.fillStyle(0x27323a).fillRoundedRect(1.5, -3.8, 3.5, 7.6, 1);
        this.modeIcon.fillStyle(RED).fillRect(-2, -4.8, 2, 2.4).fillStyle(BLUE).fillRect(-2, 2.4, 2, 2.4);
      } else {
        // A running figure, like a road sign.
        this.modeIcon.setScale(1);
        this.modeIcon.fillStyle(PALETTE.cream).fillCircle(3, -12, 3.6);
        this.modeIcon.lineStyle(3.4, PALETTE.cream);
        this.modeIcon.lineBetween(1, -7, -2, 3); // body
        this.modeIcon.lineBetween(-2, 3, 5, 7).lineBetween(5, 7, 4, 13); // front leg
        this.modeIcon.lineBetween(-2, 3, -6, 9).lineBetween(-6, 9, -11, 9); // back leg
        this.modeIcon.lineBetween(0, -5, 7, -2).lineBetween(0, -5, -6, -1); // arms
      }
    }

    this.drawRadar(status, now);
    if (status.sighting) this.sighting.tick(status.sighting.secondsLeft);

    const left = status.repeatsLeft;
    put(this.repeat.label, left === null ? '⟳  REPEAT' : `⟳  REPEAT  ·  ${left}`);
    const off = left === 0 || status.signalLost;
    [this.repeat.label, this.repeat.key].forEach((o) => o.setAlpha(off ? 0.45 : 1));
  }

  /** The radar sweep, the suspect's blip (brighter with a stronger signal) and the bars. */
  private drawRadar(status: ChaseStatus, now: number): void {
    const warn = status.warning || status.signalLost;
    if (warn !== this.warningShown) {
      this.warningShown = warn;
      this.signalPanel.clear();
      glass(this.signalPanel, LEFT.x, RADAR.y, LEFT.w, RADAR.h, warn ? RED : GLASS.edge);
    }
    const cx = LEFT.x + 50;
    const cy = RADAR.y + RADAR.h / 2;
    const r = RADAR.r;
    const g = this.radar.clear();
    g.fillStyle(GLASS.radarBack, 0.95).fillCircle(cx, cy, r);
    g.lineStyle(1, GLASS.radar, 0.35).strokeCircle(cx, cy, r * 0.66).strokeCircle(cx, cy, r * 0.33);
    g.lineBetween(cx - r, cy, cx + r, cy).lineBetween(cx, cy - r, cx, cy + r);
    g.lineStyle(2, GLASS.radar, 0.8).strokeCircle(cx, cy, r);
    if (!status.signalLost) {
      // The sweep, with a fading trail behind it.
      const angle = (now / 1400) * Math.PI * 2;
      for (let k = 0; k < 6; k++) {
        const a = angle - k * 0.12;
        g.lineStyle(2, GLASS.radar, 0.75 - k * 0.12).lineBetween(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      // The blip: nearer the middle as the signal grows, glowing as the sweep passes.
      const blipAngle = -0.9;
      const blipR = r * (0.85 - 0.6 * status.signal);
      const since = (((angle - blipAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const glow = Math.max(0.25, 1 - since / Math.PI);
      g.fillStyle(status.warning ? RED : 0xb8ffbf, glow).fillCircle(cx + Math.cos(blipAngle) * blipR, cy + Math.sin(blipAngle) * blipR, 4);
    } else {
      g.fillStyle(GLASS.radar, 0.25 + 0.2 * Math.random()).fillCircle(cx, cy, r - 2);
    }

    const lit = status.signalLost ? 0 : Math.ceil(status.signal * 5);
    const colour = status.signal > 0.6 ? GREEN : status.signal > 0.3 ? AMBER : RED;
    this.signalBars.forEach((bar, i) => bar.setFillStyle(i < lit ? colour : 0x55656b, 1).setVisible(this.shown && !status.signalLost));
    const blink = warn && Math.floor(now / 300) % 2 === 0;
    put(this.signalLabel, status.signalLost ? 'SIGNAL LOST' : this.signalName, blink ? '#ffb4a2' : toCss(GLASS.label));
    put(this.signalState, status.signalLost ? '' : status.warning ? 'GETTING AWAY!' : lit >= 4 ? 'VERY CLOSE' : '', status.warning ? '#ffb4a2' : toCss(GREEN));
  }

  /** Called when the Repeat button is clicked or tapped. */
  onRepeat(listener: () => void): void {
    this.onPress(this.repeat, listener);
  }

  /** Called when the music button is clicked or tapped. */
  onMusic(listener: () => void): void {
    this.onPress(this.music, listener);
  }

  /** Called when the pause button is clicked or tapped. */
  onPause(listener: () => void): void {
    this.onPress(this.pauseButton, listener);
  }

  /** Called when the map facing button is clicked or tapped. */
  onFacing(listener: () => void): void {
    this.onPress(this.facing, listener);
  }

  private onPress(button: HudButton, listener: () => void): void {
    button.hit.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      listener();
    });
  }

  setFacing(facing: 'FOOT' | 'ALWAYS' | 'NORTH'): void {
    const label = { FOOT: 'TURNS ON FOOT', ALWAYS: 'ALWAYS TURNS', NORTH: 'FIXED' }[facing];
    this.facing.label.setText(`🧭  MAP  ·  ${label}`);
  }

  setMusic(on: boolean): void {
    this.music.label.setText(on ? '♪  MUSIC' : '♪  MUSIC  ·  OFF').setAlpha(on ? 1 : 0.6);
  }

  showToast(message: string, ms = 1600): void {
    this.toast.setText(message).setVisible(true).setAlpha(1).setScale(1.12);
    this.scene.tweens.killTweensOf(this.toast);
    this.scene.tweens.add({ targets: this.toast, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: this.toast, alpha: 0, delay: ms, duration: 400 });
  }

  /** Show a scanner call for `seconds`, like a radio read-out; 0 hides the text (audio only). */
  showScanner(text: string, seconds: number): void {
    const parts = [this.scanner, this.scannerPanel, this.scannerTag, this.scannerLed];
    this.scene.tweens.killTweensOf(parts);
    if (seconds <= 0) {
      parts.forEach((p) => p.setVisible(false));
      return;
    }
    this.scanner.setText(text);
    const b = this.scanner.getBounds();
    this.scannerPanel.clear();
    glass(this.scannerPanel, b.x, b.y, b.width, b.height, GLASS.radar);
    this.scannerPanel.fillStyle(GLASS.radar, 0.9).fillRect(b.x + 10, b.y, 70, 3);
    this.scannerTag.setPosition(b.x + 28, b.y - 20);
    this.scannerLed.setPosition(b.x + 16, b.y - 12);
    parts.forEach((p) => p.setVisible(true).setAlpha(1));
    this.scene.tweens.add({ targets: this.scannerLed, alpha: 0.2, duration: 260, yoyo: true, repeat: 3 });
    this.scene.tweens.add({ targets: parts, alpha: 0, delay: seconds * 1000, duration: 400 });
  }

  /** Ask where the suspect is: one card per choice; `onPick` gets the card index. */
  showSighting(cards: readonly SightingCard[], seconds: number, call: string, onPick: (index: number) => void): void {
    this.sighting.show(cards, seconds, call, onPick);
  }

  /** Show which card was right (and the wrong pick) and the result, then close the question. */
  resolveSighting(answer: number, chosen: number | null, result: string): void {
    this.sighting.resolve(answer, chosen, result);
  }

  /** Big centred text, e.g. "PRÊT…" and "GO !": it lands with a punch. Empty string hides it. */
  showBanner(text: string): void {
    const changed = text !== this.banner.text;
    this.banner.setText(text).setVisible(text !== '');
    if (changed && text !== '') {
      this.scene.tweens.killTweensOf(this.banner);
      this.banner.setScale(1.7).setAlpha(0.2);
      this.scene.tweens.add({ targets: this.banner, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
    }
  }

  /** TAB: hide or show the panels (mission, radar, buttons, clock, transport) for a clearer view of the town. */
  toggle(): void {
    this.shown = !this.shown;
    for (const o of this.chrome) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(this.shown);
    for (const o of [this.repeat, this.music, this.facing]) {
      if (this.shown) o.hit.setInteractive({ useHandCursor: true });
      else o.hit.disableInteractive();
    }
  }

  private chromed<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.chrome.push(object);
    return this.add(object);
  }

  private add<T extends Phaser.GameObjects.GameObject>(object: T): T {
    (object as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(150);
    this.objects.push(object);
    return object;
  }
}

/** A police shield's outline around (x, y). */
function shield(x: number, y: number, size: number): Phaser.Math.Vector2[] {
  const p = (dx: number, dy: number) => new Phaser.Math.Vector2(x + dx * size, y + dy * size);
  return [p(-0.8, -0.9), p(0, -1.05), p(0.8, -0.9), p(0.8, 0.1), p(0, 1), p(-0.8, 0.1)];
}


const CARD_W = 150;
const CARD_H = 104;
const CARD_GAP = 12;
const MAX_CARDS = 4;
/** The question sits in a strip at the top, so the car and the streets around it stay in view. */
const TOP = 66;
const TITLE_Y = TOP + 20;
const CALL_Y = TOP + 46;
const CARDS_Y = TOP + 64 + CARD_H / 2;
const BAR_Y = CARDS_Y + CARD_H / 2 + 12;

/**
 * The sighting question: "Où est le suspect ?" with one card per choice, each
 * a vehicle (or a runner) and a place, and a shrinking time bar. The call is
 * repeated in the strip when the level shows text. Built once and reused, so
 * the scene's cameras are set up for it from the start.
 */
class SightingPanel {
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private readonly title: Phaser.GameObjects.Text;
  private readonly call: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Rectangle;
  private readonly cards: {
    box: Phaser.GameObjects.Rectangle;
    icon: Phaser.GameObjects.Graphics;
    place: Phaser.GameObjects.Text;
    key: Phaser.GameObjects.Text;
  }[] = [];
  private onPick: ((index: number) => void) | null = null;
  private seconds = 1;
  private count = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    add: <T extends Phaser.GameObjects.GameObject>(o: T) => T,
  ) {
    const { width } = scene.scale;
    this.backdrop = add(scene.add.rectangle(width / 2, TOP, 100, 100, PALETTE.ink, 0.9).setOrigin(0.5, 0));
    this.title = add(
      scene.add
        .text(width / 2, TITLE_Y, 'Où est le suspect ?', {
          fontFamily: FONT_FAMILY,
          fontSize: '24px',
          fontStyle: 'bold',
          color: toCss(PALETTE.cream),
        })
        .setOrigin(0.5),
    );
    this.call = add(
      scene.add
        .text(width / 2, CALL_Y, '', { fontFamily: FONT_FAMILY, fontSize: '18px', color: toCss(PALETTE.paleYellow) })
        .setOrigin(0.5),
    );
    for (let i = 0; i < MAX_CARDS; i++) {
      const box = add(scene.add.rectangle(0, CARDS_Y, CARD_W, CARD_H, PALETTE.cream).setStrokeStyle(3, PALETTE.ink));
      box.setInteractive({ useHandCursor: true });
      box.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.onPick?.(i);
      });
      const icon = add(scene.add.graphics());
      const place = add(
        scene.add
          .text(0, CARDS_Y + 32, '', {
            fontFamily: FONT_FAMILY,
            fontSize: '18px',
            fontStyle: 'bold',
            color: toCss(PALETTE.ink),
            align: 'center',
            wordWrap: { width: CARD_W - 12 },
          })
          .setOrigin(0.5),
      );
      const key = add(
        scene.add
          .text(0, 0, String(i + 1), {
            fontFamily: FONT_FAMILY,
            fontSize: '16px',
            fontStyle: 'bold',
            color: toCss(PALETTE.cream),
            backgroundColor: toCss(PALETTE.ink),
            padding: { x: 6, y: 1 },
          })
          .setOrigin(0.5),
      );
      this.cards.push({ box, icon, place, key });
    }
    this.bar = add(scene.add.rectangle(0, BAR_Y, 100, 6, PALETTE.paleYellow).setOrigin(0, 0.5));
    this.setVisible(false);
  }

  /** `call` is the French to repeat in the strip ('' at levels that are audio only). */
  show(cards: readonly SightingCard[], seconds: number, call: string, onPick: (index: number) => void): void {
    const { width } = this.scene.scale;
    this.count = Math.min(cards.length, MAX_CARDS);
    this.seconds = seconds;
    this.onPick = (i) => {
      if (i < this.count) onPick(i);
    };
    const total = this.count * CARD_W + (this.count - 1) * CARD_GAP;
    this.backdrop.setSize(Math.max(total, 420) + 32, BAR_Y - TOP + 14).setPosition(width / 2, TOP);
    this.title.setText('Où est le suspect ?').setColor(toCss(PALETTE.cream));
    this.call.setText(call ? `« ${call} »` : '');
    this.cards.forEach((card, i) => {
      const data = cards[i];
      const on = i < this.count && data !== undefined;
      for (const o of [card.box, card.icon, card.place, card.key]) o.setVisible(on);
      if (!on) return;
      const x = width / 2 - total / 2 + CARD_W / 2 + i * (CARD_W + CARD_GAP);
      card.box.setPosition(x, CARDS_Y).setFillStyle(PALETTE.cream).setStrokeStyle(3, PALETTE.ink).setAlpha(1);
      card.key.setPosition(x - CARD_W / 2 + 14, CARDS_Y - CARD_H / 2 + 14);
      card.icon.clear().setPosition(x, CARDS_Y - 14).setScale(data.vehicle ? 3 : 4.2);
      if (data.vehicle) drawVehicle(card.icon, data.vehicle);
      else drawRunner(card.icon);
      const word = LOCATION_WORD_BY_ID.get(data.place);
      card.place.setText(word ? withArticle(word) : data.place).setPosition(x, CARDS_Y + 30);
    });
    this.bar.setPosition(width / 2 - total / 2, BAR_Y).setSize(total, 6);
    this.setVisible(true);
  }

  tick(secondsLeft: number): void {
    const total = this.count * CARD_W + (this.count - 1) * CARD_GAP;
    this.bar.setSize(Math.max(0, total * (secondsLeft / this.seconds)), 6);
  }

  /** Marks the right card (and a wrong pick) and says how it went, then closes. */
  resolve(answer: number, chosen: number | null, result: string): void {
    this.onPick = null;
    this.title.setText(result).setColor(chosen === answer ? '#bfe5b4' : '#ffb4a2');
    this.cards.forEach((card, i) => {
      if (i === answer) card.box.setFillStyle(0xbfe5b4).setStrokeStyle(5, 0x2e9e5b);
      else if (i === chosen) card.box.setFillStyle(0xf3c1b4).setStrokeStyle(5, 0xc0392b);
      else card.box.setAlpha(0.5);
    });
    this.bar.setVisible(false);
    this.scene.time.delayedCall(1600, () => {
      if (!this.onPick) this.setVisible(false);
    });
  }

  /** Shows or hides the panel; `show` has already chosen which cards are in use. */
  private setVisible(on: boolean): void {
    for (const o of [this.backdrop, this.title, this.call, this.bar]) o.setVisible(on);
    if (!on) for (const card of this.cards) for (const o of [card.box, card.icon, card.place, card.key]) o.setVisible(false);
  }
}

/**
 * Changes a text only when its words or colour really change: every change
 * redraws the text and sends it to the graphics card again, which several
 * HUD texts were doing every frame (slow on modest devices).
 */
function put(text: Phaser.GameObjects.Text, words: string, colour?: string): void {
  if (text.text !== words) text.setText(words);
  if (colour !== undefined && text.style.color !== colour) text.setColor(colour);
}
