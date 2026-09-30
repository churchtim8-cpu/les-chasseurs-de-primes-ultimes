import Phaser from 'phaser';
import { BELLEVUE } from '../../content/map/bellevue';
import { Mover, type MoverStart } from '../../engine/movement/mover';
import { BOARDING_DISTANCE } from '../../engine/movement/settings';
import { TownGraph } from '../../engine/world/graph';
import { CameraRig } from '../camera/cameraRig';
import { debugState } from '../debug/debugState';
import { Controls, type ControlAction } from '../input/controls';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { createIntentBadge, createOfficer, createPoliceCar } from '../render/actors';
import { drawTown, type TownLayers } from '../render/townRenderer';

/** The player starts outside le commissariat de police, heading east. */
const PLAYER_START: MoverStart = { edgeId: 'c4r1-c5r1', t: 0.4, towards: 'c5r1', mode: 'CAR' };

/**
 * Free patrol around Bellevue City (milestone M2): drive and walk on the
 * road graph with the car/foot cameras. The chase is added in M3.
 */
export class TownScene extends Phaser.Scene {
  static readonly KEY = 'Town';
  private graph!: TownGraph;
  private layers?: TownLayers;
  private mover!: Mover;
  private controls!: Controls;
  private rig!: CameraRig;
  private car!: Phaser.GameObjects.Container;
  private officer!: Phaser.GameObjects.Container;
  private badge!: ReturnType<typeof createIntentBadge>;
  private modeChip!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  /** Where the car was left when the player got out (null while driving). */
  private parkedCar: MoverStart | null = null;
  private displayHeading = 0;

  constructor() {
    super(TownScene.KEY);
  }

  create(): void {
    this.graph = new TownGraph(BELLEVUE);
    this.parkedCar = null;
    this.layers = drawTown(this, this.graph);
    this.mover = new Mover(this.graph, PLAYER_START);
    this.car = createPoliceCar(this);
    this.officer = createOfficer(this).setVisible(false);
    this.badge = createIntentBadge(this);
    this.displayHeading = this.mover.snapshot().heading;

    const worldObjects = [...this.children.list];

    this.rig = new CameraRig(this, this.cameras.main, BELLEVUE, 'CAR');
    this.controls = new Controls(this);
    this.controls.onAction((action) => this.handleAction(action));
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Title'));

    // Screen-space UI on its own camera so zooming the town does not scale it.
    this.modeChip = this.add
      .text(this.scale.width - 16, 16, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        fontStyle: 'bold',
        color: toCss(PALETTE.cream),
        backgroundColor: 'rgba(22, 50, 61, 0.85)',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(1, 0);
    this.toast = this.add
      .text(this.scale.width / 2, 70, '', {
        fontFamily: FONT_FAMILY,
        fontSize: '22px',
        color: toCss(PALETTE.ink),
        backgroundColor: 'rgba(246, 236, 210, 0.95)',
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    const ui = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    ui.ignore(worldObjects);
    this.cameras.main.ignore([this.modeChip, this.toast, ...this.controls.uiObjects]);

    this.syncDebug();
    const unsubscribe = debugState.onChange(() => this.syncDebug());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    this.refreshModeChip();
  }

  override update(_time: number, delta: number): void {
    const { accelerate, brake } = this.controls.state;
    this.mover.setThrottle(brake ? 'BRAKE' : accelerate ? 'ACCELERATE' : 'CRUISE');
    this.mover.update(Math.min(delta, 50) / 1000);

    const me = this.mover.snapshot();
    // Turn the sprite smoothly towards the new heading instead of snapping.
    const diff = Phaser.Math.Angle.Wrap(me.heading - this.displayHeading);
    this.displayHeading += diff * Math.min(1, delta / 90);

    const avatar = me.mode === 'CAR' ? this.car : this.officer;
    avatar.setPosition(me.x, me.y).setRotation(this.displayHeading);
    this.badge.container.setPosition(me.x, me.y - (me.mode === 'CAR' ? 16 : 10));
    this.badge.show(me.queued);

    this.rig.update(me, delta);
    this.applyZoom();

    if (debugState.isEnabled) {
      debugState.info.set('mode', me.mode);
      debugState.info.set('edge', `${me.edgeId} → ${me.towards}`);
      debugState.info.set('speed', me.speed.toFixed(0));
      debugState.info.set('queued', me.queued ?? '-');
      debugState.info.set('waiting', me.waiting ?? '-');
    }
  }

  private handleAction(action: ControlAction): void {
    switch (action) {
      case 'LEFT':
      case 'RIGHT':
      case 'STRAIGHT':
        this.mover.queue(action);
        break;
      case 'U_TURN':
        if (!this.mover.uTurn()) this.showToast('Sens interdit !');
        break;
      case 'TOGGLE_MODE':
        this.toggleMode();
        break;
      case 'OVERVIEW':
        this.rig.toggleOverview();
        break;
    }
  }

  private toggleMode(): void {
    if (this.mover.mode === 'CAR') {
      this.parkedCar = this.mover.location();
      this.mover.setMode('FOOT');
      this.officer.setVisible(true);
      this.rig.setMode('FOOT');
      this.showToast('Vous êtes à pied.');
    } else {
      const parked = this.parkedCar;
      const me = this.mover.snapshot();
      if (!parked || Phaser.Math.Distance.Between(me.x, me.y, this.car.x, this.car.y) > BOARDING_DISTANCE) {
        this.showToast('La voiture est trop loin.');
        return;
      }
      this.mover = new Mover(this.graph, { ...parked, mode: 'CAR' });
      this.displayHeading = this.mover.snapshot().heading;
      this.parkedCar = null;
      this.officer.setVisible(false);
      this.rig.setMode('CAR');
      this.showToast('Vous êtes en voiture.');
    }
    this.refreshModeChip();
  }

  private refreshModeChip(): void {
    this.modeChip.setText(this.mover.mode === 'CAR' ? 'EN VOITURE' : 'À PIED');
  }

  private showToast(message: string): void {
    this.toast.setText(message).setVisible(true).setAlpha(1);
    this.tweens.killTweensOf(this.toast);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1400, duration: 400 });
  }

  /** Keeps labels a readable size on screen whatever the zoom. */
  private applyZoom(): void {
    const zoom = this.cameras.main.zoom;
    const scale = Phaser.Math.Clamp(0.8 / zoom, 0.35, 2);
    for (const { text, width } of this.layers?.labels ?? []) {
      if (text.scale === scale) continue;
      text.setScale(scale);
      // Wrap long names to roughly the building's width (never narrower than a short word).
      text.setWordWrapWidth(Math.max(width / scale, 70));
    }
    if (debugState.isEnabled) debugState.info.set('zoom', zoom.toFixed(2));
  }

  private syncDebug(): void {
    this.layers?.debug.setVisible(debugState.isEnabled);
  }
}
