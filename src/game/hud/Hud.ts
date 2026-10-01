import Phaser from 'phaser';
import type { ChaseStatus } from '../../engine/chase/chase';
import type { SightingCard } from '../../engine/chase/sightings';
import { LOCATION_WORD_BY_ID, withArticle } from '../../engine/language/locations';
import { drawRunner, drawVehicle } from '../render/actors';
import type { TravelMode } from '../../engine/world/graph';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';

/**
 * Chase HUD (blueprint section 19): mission number, timer, signal strength,
 * transport mode and short messages. The map keeps most of the screen; the
 * correct route is never drawn and there is no "CORRECT!" feedback.
 */
export class Hud {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly timer: Phaser.GameObjects.Text;
  private readonly mode: Phaser.GameObjects.Text;
  private readonly signalBars: Phaser.GameObjects.Rectangle[] = [];
  private readonly signalLabel: Phaser.GameObjects.Text;
  private readonly toast: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly scanner: Phaser.GameObjects.Text;
  private readonly repeat: Phaser.GameObjects.Text;
  private readonly sighting: SightingPanel;

  constructor(
    private readonly scene: Phaser.Scene,
    mission: { number: number; total: number },
  ) {
    const { width } = scene.scale;
    const panel = (x: number, y: number, text: string, origin: [number, number], size = 20) =>
      this.add(
        scene.add
          .text(x, y, text, {
            fontFamily: FONT_FAMILY,
            fontSize: `${size}px`,
            fontStyle: 'bold',
            color: toCss(PALETTE.cream),
            backgroundColor: 'rgba(22, 50, 61, 0.85)',
            padding: { x: 12, y: 6 },
          })
          .setOrigin(...origin),
      );

    panel(16, 16, `MISSION ${mission.number} / ${mission.total}`, [0, 0]);
    this.timer = panel(width / 2, 16, '0:00', [0.5, 0], 26);
    this.mode = panel(width - 16, 16, '', [1, 0]);

    this.signalLabel = this.add(
      scene.add.text(16, 62, 'SIGNAL', {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: 'bold',
        color: toCss(PALETTE.cream),
        backgroundColor: 'rgba(22, 50, 61, 0.85)',
        padding: { x: 8, y: 5 },
      }),
    );
    for (let i = 0; i < 5; i++) {
      this.signalBars.push(this.add(scene.add.rectangle(92 + i * 14, 88, 10, 10 + i * 4, PALETTE.cream).setOrigin(0, 1)));
    }

    // The Repeat button (blueprint sections 16 and 19); R on the keyboard.
    this.repeat = this.add(
      scene.add.text(16, 102, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '17px',
        fontStyle: 'bold',
        color: toCss(PALETTE.cream),
        backgroundColor: 'rgba(22, 50, 61, 0.85)',
        padding: { x: 10, y: 7 },
      }),
    ).setInteractive({ useHandCursor: true });

    this.toast = this.add(
      scene.add
        .text(width / 2, 74, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '22px',
          color: toCss(PALETTE.ink),
          backgroundColor: 'rgba(246, 236, 210, 0.95)',
          padding: { x: 14, y: 8 },
        })
        .setOrigin(0.5, 0)
        .setVisible(false),
    );
    // The police scanner: the French instruction as text, for as long as the level allows.
    this.scanner = this.add(
      scene.add
        .text(width / 2, scene.scale.height - 28, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '28px',
          fontStyle: 'bold',
          color: toCss(PALETTE.cream),
          backgroundColor: 'rgba(22, 50, 61, 0.92)',
          padding: { x: 20, y: 12 },
          align: 'center',
          wordWrap: { width: width - 120 },
        })
        .setOrigin(0.5, 1)
        .setVisible(false),
    );
    this.sighting = new SightingPanel(scene, (o) => this.add(o));
    this.banner = this.add(
      scene.add
        .text(width / 2, scene.scale.height / 2, '', {
          fontFamily: FONT_FAMILY,
          fontSize: '96px',
          fontStyle: 'bold',
          color: toCss(PALETTE.cream),
          stroke: toCss(PALETTE.ink),
          strokeThickness: 10,
        })
        .setOrigin(0.5)
        .setVisible(false),
    );
  }

  update(status: ChaseStatus, mode: TravelMode): void {
    const seconds = Math.ceil(status.timeLeft);
    this.timer.setText(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    this.timer.setColor(seconds <= 15 ? '#ffb4a2' : toCss(PALETTE.cream));
    this.mode.setText(mode === 'CAR' ? 'EN VOITURE' : 'À PIED');

    const lit = status.signalLost ? 0 : Math.ceil(status.signal * 5);
    const colour = status.signal > 0.6 ? 0x6fcf7c : status.signal > 0.3 ? 0xe8c547 : 0xe0463a;
    this.signalBars.forEach((bar, i) => bar.setFillStyle(i < lit ? colour : 0x55656b, 1));
    const blink = (status.warning || status.signalLost) && Math.floor(this.scene.time.now / 300) % 2 === 0;
    this.signalLabel.setText(status.signalLost ? 'SIGNAL PERDU' : 'SIGNAL');
    this.signalLabel.setColor(blink ? '#ffb4a2' : toCss(PALETTE.cream));
    this.signalBars.forEach((bar) => bar.setVisible(!status.signalLost));
    if (status.sighting) this.sighting.tick(status.sighting.secondsLeft);

    const left = status.repeatsLeft;
    this.repeat.setText(left === null ? '⟳ RÉPÉTER (R)' : `⟳ RÉPÉTER (R) · ${left}`);
    this.repeat.setAlpha(left === 0 || status.signalLost ? 0.45 : 1);
  }

  /** Called when the Repeat button is clicked or tapped. */
  onRepeat(listener: () => void): void {
    this.repeat.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      listener();
    });
  }

  showToast(message: string, ms = 1600): void {
    this.toast.setText(message).setVisible(true).setAlpha(1);
    this.scene.tweens.killTweensOf(this.toast);
    this.scene.tweens.add({ targets: this.toast, alpha: 0, delay: ms, duration: 400 });
  }

  /** Show a scanner call ("SCANNER : Tournez à gauche.") for `seconds`; 0 hides the text (audio only). */
  showScanner(text: string, seconds: number): void {
    this.scene.tweens.killTweensOf(this.scanner);
    if (seconds <= 0) {
      this.scanner.setVisible(false);
      return;
    }
    this.scanner.setText(`SCANNER : ${text}`).setVisible(true).setAlpha(1);
    this.scene.tweens.add({ targets: this.scanner, alpha: 0, delay: seconds * 1000, duration: 400 });
  }

  /** Ask where the suspect is: one card per choice; `onPick` gets the card index. */
  showSighting(cards: readonly SightingCard[], seconds: number, call: string, onPick: (index: number) => void): void {
    this.sighting.show(cards, seconds, call, onPick);
  }

  /** Show which card was right (and the wrong pick) and the result, then close the question. */
  resolveSighting(answer: number, chosen: number | null, result: string): void {
    this.sighting.resolve(answer, chosen, result);
  }

  /** Big centred text, e.g. the 3-2-1-GO countdown. Empty string hides it. */
  showBanner(text: string): void {
    this.banner.setText(text).setVisible(text !== '');
  }

  private add<T extends Phaser.GameObjects.GameObject>(object: T): T {
    (object as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(150);
    this.objects.push(object);
    return object;
  }
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
