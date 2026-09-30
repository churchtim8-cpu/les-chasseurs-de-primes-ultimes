import Phaser from 'phaser';
import { BELLEVUE } from '../../content/map/bellevue';
import { TownGraph } from '../../engine/world/graph';
import { debugState } from '../debug/debugState';
import { drawTown, type TownLayers } from '../render/townRenderer';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';

const MIN_ZOOM_FACTOR = 1; // relative to "whole town fits"
const MAX_ZOOM = 2.5;
const PAN_SPEED = 700; // screen pixels per second

/**
 * Explore Bellevue City (milestone M1). Drag or use the arrow keys to move,
 * mouse wheel, pinch or +/- to zoom. Debug mode shows the navigation graph.
 * From M2 the player's car and the chase replace free exploring.
 */
export class TownScene extends Phaser.Scene {
  static readonly KEY = 'Town';
  private layers?: TownLayers;
  private fitZoom = 1;
  private keys?: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private pinchDistance?: number;

  constructor() {
    super(TownScene.KEY);
  }

  create(): void {
    const graph = new TownGraph(BELLEVUE);
    this.layers = drawTown(this, graph);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, BELLEVUE.width, BELLEVUE.height);
    this.fitZoom = Math.max(camera.width / BELLEVUE.width, camera.height / BELLEVUE.height);
    camera.setZoom(this.fitZoom);
    camera.centerOn(BELLEVUE.width / 2, BELLEVUE.height / 2);
    this.applyZoom();

    this.setUpInput();
    this.syncDebug();
    const unsubscribe = debugState.onChange(() => this.syncDebug());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

    // Screen-space UI gets its own camera so zooming the town does not scale it.
    const world = [...this.children.list];
    const hint = this.addHint();
    const ui = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    ui.ignore(world);
    camera.ignore(hint);
  }

  override update(_time: number, delta: number): void {
    if (!this.keys) return;
    const k = this.keys;
    const step = (PAN_SPEED * delta) / 1000 / this.cameras.main.zoom;
    const dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    if (dx || dy) {
      this.cameras.main.scrollX += dx * step;
      this.cameras.main.scrollY += dy * step;
    }
  }

  private setUpInput(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      const k = keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D', false) as Record<string, Phaser.Input.Keyboard.Key>;
      this.keys = { up: k.UP!, down: k.DOWN!, left: k.LEFT!, right: k.RIGHT!, w: k.W!, a: k.A!, s: k.S!, d: k.D! };
      keyboard.on('keydown-PLUS', () => this.zoomBy(1.25));
      keyboard.on('keydown-NUMPAD_ADD', () => this.zoomBy(1.25));
      keyboard.on('keydown-MINUS', () => this.zoomBy(0.8));
      keyboard.on('keydown-NUMPAD_SUBTRACT', () => this.zoomBy(0.8));
      keyboard.on('keydown-ESC', () => this.scene.start('Title'));
    }

    this.input.addPointer(1); // second finger for pinch zoom
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 0.9 : 1.1));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchDistance) this.zoomBy(d / this.pinchDistance);
        this.pinchDistance = d;
        return;
      }
      this.pinchDistance = undefined;
      if (!pointer.isDown) return;
      const camera = this.cameras.main;
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
      camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
    });
    this.input.on('pointerup', () => (this.pinchDistance = undefined));
  }

  private zoomBy(factor: number): void {
    const camera = this.cameras.main;
    const zoom = Phaser.Math.Clamp(camera.zoom * factor, this.fitZoom * MIN_ZOOM_FACTOR, MAX_ZOOM);
    camera.setZoom(zoom);
    this.applyZoom();
  }

  /** Keeps labels a readable size on screen whatever the zoom. */
  private applyZoom(): void {
    const zoom = this.cameras.main.zoom;
    const scale = Phaser.Math.Clamp(0.8 / zoom, 0.5, 2);
    for (const { text, width } of this.layers?.labels ?? []) {
      text.setScale(scale);
      // Wrap long names to roughly the building's width (never narrower than a short word).
      text.setWordWrapWidth(Math.max(width / scale, 70));
    }
    debugState.info.set('zoom', zoom.toFixed(2));
  }

  private syncDebug(): void {
    this.layers?.debug.setVisible(debugState.isEnabled);
  }

  private addHint(): Phaser.GameObjects.Text {
    return this.add
      .text(this.scale.width / 2, this.scale.height - 14, 'Glissez ou flèches : se déplacer · molette ou +/- : zoom · Échap : menu', {
        fontFamily: FONT_FAMILY,
        fontSize: '16px',
        color: toCss(PALETTE.cream),
        backgroundColor: 'rgba(22, 50, 61, 0.8)',
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setDepth(100);
  }
}
