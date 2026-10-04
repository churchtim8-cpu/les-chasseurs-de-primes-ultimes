import Phaser from 'phaser';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';

/**
 * Player controls, the same for keyboard and touch:
 *
 *   Left / Right   choose the next turn (held until a junction allows it)
 *   Up             go straight on at the next junction; hold to speed up
 *   Down           hold to slow down and stop; tap twice quickly to turn around
 *   U              turn around (faire demi-tour)
 *   Space or E     get out of / back into the car
 *   M              map overview (debug and practice)
 *   B              music on or off (handled by the chase scene)
 */

export type ControlAction = 'LEFT' | 'RIGHT' | 'STRAIGHT' | 'U_TURN' | 'TOGGLE_MODE' | 'OVERVIEW';

/** Two taps of ▼ this close together (ms) turn around (Mr Henry, 2026-10-03). */
export const DOUBLE_TAP_MS = 320;

export interface ControlState {
  accelerate: boolean;
  brake: boolean;
}

export class Controls {
  readonly state: ControlState = { accelerate: false, brake: false };
  private readonly listeners: ((action: ControlAction) => void)[] = [];
  /** Screen-space objects (touch buttons), so the scene can put them on the UI camera. */
  readonly uiObjects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.bindKeyboard();
    const forceTouch = new URLSearchParams(window.location.search).get('touch') === '1';
    if (forceTouch || scene.sys.game.device.input.touch) this.createTouchButtons();
  }

  onAction(listener: (action: ControlAction) => void): void {
    this.listeners.push(listener);
  }

  private emit(action: ControlAction): void {
    this.listeners.forEach((listener) => listener(action));
  }

  private bindKeyboard(): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;
    const on = (keys: string[], action: ControlAction) =>
      keys.forEach((key) => keyboard.on(`keydown-${key}`, () => this.emit(action)));
    on(['LEFT', 'A'], 'LEFT');
    on(['RIGHT', 'D'], 'RIGHT');
    on(['UP', 'W'], 'STRAIGHT');
    on(['U'], 'U_TURN');
    on(['SPACE', 'E'], 'TOGGLE_MODE');
    // ▼ twice quickly: turn around (a held key's repeats do not count).
    let lastDown = -Infinity;
    for (const key of ['DOWN', 'S']) {
      keyboard.on(`keydown-${key}`, (event: KeyboardEvent) => {
        if (event.repeat) return;
        const now = this.scene.time.now;
        if (now - lastDown <= DOUBLE_TAP_MS) {
          lastDown = -Infinity;
          this.emit('U_TURN');
        } else lastDown = now;
      });
    }
    on(['M'], 'OVERVIEW');

    const hold = (keys: string[], field: keyof ControlState) => {
      for (const key of keys) {
        keyboard.on(`keydown-${key}`, () => (this.state[field] = true));
        keyboard.on(`keyup-${key}`, () => (this.state[field] = false));
      }
    };
    hold(['UP', 'W'], 'accelerate');
    hold(['DOWN', 'S'], 'brake');
    // Keys stuck "down" when the window loses focus would keep the car braking.
    this.scene.game.events.on(Phaser.Core.Events.BLUR, () => {
      this.state.accelerate = false;
      this.state.brake = false;
    });
  }

  private createTouchButtons(): void {
    const { width, height } = this.scene.scale;
    const size = 74;
    const gap = 12;
    const bottom = height - gap - size / 2;
    const button = (x: number, y: number, label: string, press: () => void, release?: () => void) => {
      const bg = this.scene.add
        .circle(x, y, size / 2, PALETTE.ink, 0.55)
        .setStrokeStyle(2, PALETTE.cream, 0.7)
        .setDepth(200)
        .setInteractive();
      const text = this.scene.add
        .text(x, y, label, { fontFamily: FONT_FAMILY, fontSize: '30px', color: toCss(PALETTE.cream) })
        .setOrigin(0.5)
        .setDepth(201);
      bg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        bg.setFillStyle(PALETTE.terracotta, 0.8);
        press();
      });
      const up = () => {
        bg.setFillStyle(PALETTE.ink, 0.55);
        release?.();
      };
      bg.on('pointerup', up);
      bg.on('pointerout', up);
      this.uiObjects.push(bg, text);
    };

    const left = gap + size / 2;
    button(left, bottom, '◀', () => this.emit('LEFT'));
    button(left + size + gap, bottom, '▶', () => this.emit('RIGHT'));
    const right = width - gap - size / 2;
    button(right, bottom - size - gap, '▲', () => {
      this.state.accelerate = true;
      this.emit('STRAIGHT');
    }, () => (this.state.accelerate = false));
    // Touch keeps its own ⟲ button for turning round, so a nervous double brake never spins the car.
    button(right, bottom, '▼', () => (this.state.brake = true), () => (this.state.brake = false));
    button(right - size - gap, bottom, '⟲', () => this.emit('U_TURN'));
    button(right - size - gap, bottom - size - gap, '⇄', () => this.emit('TOGGLE_MODE'));
  }
}
