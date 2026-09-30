import Phaser from 'phaser';
import { BELLEVUE } from '../../content/map/bellevue';
import { audioCheck } from '../../engine/audio/manifest';
import { OUTCOME_LINES, REPEAT_LINES } from '../../engine/audio/script';
import { DIFFICULTY_SETTINGS } from '../../engine/difficulty';
import { Chase, type ChaseEvent } from '../../engine/chase/chase';
import { generateScenario } from '../../engine/chase/scenario';
import type { Transmission } from '../../engine/language/navigator';
import { LANGUAGE_SETTINGS } from '../../engine/language/settings';
import { LOCATION_WORD_BY_ID, withArticle } from '../../engine/language/locations';
import { Mover, type MoverStart } from '../../engine/movement/mover';
import { BOARDING_DISTANCE } from '../../engine/movement/settings';
import { TownGraph } from '../../engine/world/graph';
import { scannerAudio, type SpokenLine } from '../audio/ScannerAudio';
import { CameraRig } from '../camera/cameraRig';
import { debugState } from '../debug/debugState';
import { Hud } from '../hud/Hud';
import { Controls, type ControlAction } from '../input/controls';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { createIntentBadge, createOfficer, createPoliceCar, createSuspectCar } from '../render/actors';
import { drawTown, type TownLayers } from '../render/townRenderer';

export interface ChaseSceneData {
  seed: string;
}

type Stage = 'COUNTDOWN' | 'PURSUIT' | 'RESULTS';

/**
 * One chase: the suspect drives its generated route and the player pursues,
 * guided by the police scanner's French: pre-recorded clips from the audio
 * manifest, with the text on screen as the level allows (and always when a
 * line has no recording yet). R or the Repeat button asks for the last call again.
 *
 * Debug keys (debug mode only): C = jump onto the suspect (test capture),
 * X = force escape, N = next chase.
 */
export class ChaseScene extends Phaser.Scene {
  static readonly KEY = 'Chase';
  private graph!: TownGraph;
  private layers?: TownLayers;
  private chase!: Chase;
  private controls!: Controls;
  private rig!: CameraRig;
  private hud!: Hud;
  private car!: Phaser.GameObjects.Container;
  private officer!: Phaser.GameObjects.Container;
  private suspectCar!: Phaser.GameObjects.Container;
  private routeOverlay!: Phaser.GameObjects.Graphics;
  private badge!: ReturnType<typeof createIntentBadge>;
  private parkedCar: MoverStart | null = null;
  private displayHeading = 0;
  private suspectHeading = 0;
  private stage: Stage = 'COUNTDOWN';
  private seed = '';

  constructor() {
    super(ChaseScene.KEY);
  }

  init(data: ChaseSceneData): void {
    this.seed = data.seed;
    this.stage = 'COUNTDOWN';
    this.parkedCar = null;
  }

  create(): void {
    this.graph = new TownGraph(BELLEVUE);
    this.chase = new Chase(this.graph, generateScenario(this.graph, this.seed), {
      hasAudio: audioCheck(scannerAudio.library),
    });
    scannerAudio.preload([...Object.values(REPEAT_LINES), ...Object.values(OUTCOME_LINES)].map((l) => l.audioId));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scannerAudio.stop());
    this.layers = drawTown(this, this.graph);
    this.routeOverlay = this.drawRoute();
    this.suspectCar = createSuspectCar(this).setAlpha(0);
    this.car = createPoliceCar(this);
    this.officer = createOfficer(this).setVisible(false);
    this.badge = createIntentBadge(this);
    const me = this.chase.player.snapshot();
    this.displayHeading = me.heading;
    this.suspectHeading = this.chase.suspect.snapshot().heading;
    this.car.setPosition(me.x, me.y).setRotation(me.heading);

    const worldObjects = [...this.children.list];

    this.rig = new CameraRig(this, this.cameras.main, BELLEVUE, 'CAR');
    this.controls = new Controls(this);
    this.controls.onAction((action) => this.handleAction(action));
    this.hud = new Hud(this, { number: 1, total: 8 });
    this.hud.onRepeat(() => this.repeat());

    const ui = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    ui.ignore(worldObjects);
    this.cameras.main.ignore([...this.hud.objects, ...this.controls.uiObjects]);

    this.bindKeys();
    this.syncDebug();
    const unsubscribe = debugState.onChange(() => this.syncDebug());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

    const destination = LOCATION_WORD_BY_ID.get(this.chase.scenario.destination);
    debugState.info.set('seed', this.seed);
    debugState.info.set('difficulty', this.chase.scenario.difficulty);
    debugState.info.set('destination', destination ? withArticle(destination) : this.chase.scenario.destination);
    debugState.info.set('route', `${this.chase.scenario.route.length} nodes, ${Math.round(this.chase.scenario.routeLength)} m`);
    debugState.info.set('audio', `${scannerAudio.clipCount} clips`);
    this.hud.update(this.chase.status, 'CAR');
    this.countdown();
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    if (this.stage === 'PURSUIT') {
      const { accelerate, brake } = this.controls.state;
      this.chase.player.setThrottle(brake ? 'BRAKE' : accelerate ? 'ACCELERATE' : 'CRUISE');
      this.handleEvents(this.chase.update(dt));
    }
    this.drawActors(delta);
    this.hud.update(this.chase.status, this.chase.player.mode);

    if (debugState.isEnabled) {
      const status = this.chase.status;
      const me = this.chase.player.snapshot();
      debugState.info.set('phase', status.phase);
      debugState.info.set('distance', `${Math.round(status.distance)} m`);
      debugState.info.set('mode', me.mode);
      debugState.info.set('edge', `${me.edgeId} → ${me.towards}`);
      debugState.info.set('queued', me.queued ?? '-');
      debugState.info.set('speed', me.speed.toFixed(0));
      debugState.info.set('zoom', this.cameras.main.zoom.toFixed(3));
      debugState.info.set('repeats', `${status.repeatsUsed} used, ${status.repeatsLeft ?? 'unlimited'} left`);
    }
  }

  private countdown(): void {
    const steps = ['3', '2', '1', 'GO !'];
    steps.forEach((text, i) => this.time.delayedCall(i * 700, () => this.hud.showBanner(text)));
    this.time.delayedCall(steps.length * 700 - 500, () => (this.stage = 'PURSUIT'));
    this.time.delayedCall(steps.length * 700 + 100, () => this.hud.showBanner(''));
  }

  private handleEvents(events: ChaseEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'SIGHTED':
          if (event.on) this.hud.showToast('Suspect en vue !');
          break;
        case 'WARNING':
          if (event.on) {
            this.hud.showToast('Le suspect s’éloigne !');
            void scannerAudio.play([{ audioId: OUTCOME_LINES.WARNING.audioId, radio: true }]);
          }
          break;
        case 'CAPTURED':
        case 'ESCAPED': {
          const line = event.type === 'CAPTURED' ? OUTCOME_LINES.CAPTURED : OUTCOME_LINES.ESCAPED;
          void scannerAudio.play([{ audioId: line.audioId, radio: true }]);
          this.showResults();
          break;
        }
        case 'SUSPECT_ARRIVED':
          break;
        case 'TRANSMISSION':
          this.showTransmission(event.transmission);
          break;
      }
    }
  }

  /**
   * Speak a scanner call and show its text as the level allows: Hard and
   * Expert are audio only, but a line with no recording yet is always shown.
   * `before` is spoken first (the officer asking for a repeat).
   */
  private showTransmission(transmission: Transmission, before: SpokenLine[] = []): void {
    const difficulty = this.chase.scenario.difficulty;
    const voiced = transmission.instructions.every((i) => scannerAudio.has(i.audioId));
    const audioOnly = DIFFICULTY_SETTINGS[difficulty].textDisplay === 'AUDIO_ONLY' && voiced;
    this.hud.showScanner(transmission.text, audioOnly ? 0 : LANGUAGE_SETTINGS[difficulty].textSeconds);
    void scannerAudio.play([...before, ...transmission.instructions.map((i) => ({ audioId: i.audioId, radio: true }))]);
    const detail = transmission.instructions.map((i) => `${i.template} ${i.audioId}`).join(' + ');
    debugState.info.set('scanner', `${transmission.kind}: ${detail}`);
  }

  private handleAction(action: ControlAction): void {
    if (this.stage !== 'PURSUIT') return;
    const player = this.chase.player;
    switch (action) {
      case 'LEFT':
      case 'RIGHT':
      case 'STRAIGHT':
        player.queue(action);
        break;
      case 'U_TURN':
        if (!player.uTurn()) this.hud.showToast('Sens interdit !');
        break;
      case 'TOGGLE_MODE':
        this.toggleMode();
        break;
      case 'OVERVIEW':
        if (debugState.isEnabled) this.rig.toggleOverview();
        break;
    }
  }

  private toggleMode(): void {
    const player = this.chase.player;
    if (player.mode === 'CAR') {
      this.parkedCar = player.location();
      player.setMode('FOOT');
      this.officer.setVisible(true);
      this.rig.setMode('FOOT');
      return;
    }
    const me = player.snapshot();
    if (!this.parkedCar || Phaser.Math.Distance.Between(me.x, me.y, this.car.x, this.car.y) > BOARDING_DISTANCE) {
      this.hud.showToast('La voiture est trop loin.');
      return;
    }
    this.chase.player = new Mover(this.graph, { ...this.parkedCar, mode: 'CAR' });
    this.displayHeading = this.chase.player.snapshot().heading;
    this.parkedCar = null;
    this.officer.setVisible(false);
    this.rig.setMode('CAR');
  }

  private drawActors(delta: number): void {
    const me = this.chase.player.snapshot();
    this.displayHeading += Phaser.Math.Angle.Wrap(me.heading - this.displayHeading) * Math.min(1, delta / 90);
    const avatar = me.mode === 'CAR' ? this.car : this.officer;
    avatar.setPosition(me.x, me.y).setRotation(this.displayHeading);
    this.badge.container.setPosition(me.x, me.y - (me.mode === 'CAR' ? 16 : 10));
    this.badge.show(this.stage === 'PURSUIT' ? me.queued : null);

    const suspect = this.chase.suspect.snapshot();
    this.suspectHeading += Phaser.Math.Angle.Wrap(suspect.heading - this.suspectHeading) * Math.min(1, delta / 90);
    this.suspectCar.setPosition(suspect.x, suspect.y).setRotation(this.suspectHeading);
    // The suspect is only on the map when close (a sighting) or at the end; debug always shows it.
    const visible = debugState.isEnabled || this.chase.status.suspectVisible || this.stage === 'RESULTS';
    const alpha = this.suspectCar.alpha + ((visible ? 1 : 0) - this.suspectCar.alpha) * Math.min(1, delta / 250);
    this.suspectCar.setAlpha(alpha);

    this.rig.update(me, delta);
    this.scaleLabels();
  }

  private showResults(): void {
    this.stage = 'RESULTS';
    const status = this.chase.status;
    const captured = status.phase === 'CAPTURED';
    const title = captured ? 'Le suspect est arrêté !' : 'Le suspect s’est échappé.';
    const detail = captured
      ? `Temps : ${status.elapsed.toFixed(1)} s`
      : status.escapeReason === 'TIME'
        ? 'Le temps est écoulé.'
        : 'Vous avez perdu le suspect.';
    const { width, height } = this.scale;
    const panel = this.add
      .text(width / 2, height / 2, `${title}\n\n${detail}\nPoursuite ${this.seed}\n\nENTRÉE : nouvelle poursuite   ·   R : rejouer`, {
        fontFamily: FONT_FAMILY,
        fontSize: '26px',
        color: toCss(PALETTE.ink),
        align: 'center',
        backgroundColor: 'rgba(246, 236, 210, 0.96)',
        padding: { x: 36, y: 26 },
      })
      .setOrigin(0.5)
      .setDepth(300);
    this.cameras.main.ignore(panel);
    panel.setInteractive().on('pointerdown', () => this.nextChase());
  }

  private nextChase(): void {
    this.scene.start('Title', { autostart: true });
  }

  private bindKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.on('keydown-ESC', () => this.scene.start('Title'));
    keyboard.on('keydown-ENTER', () => this.stage === 'RESULTS' && this.nextChase());
    keyboard.on('keydown-R', () => {
      if (this.stage === 'RESULTS') this.scene.restart({ seed: this.seed });
      else this.repeat();
    });
    keyboard.on('keydown-C', () => {
      if (debugState.isEnabled && this.stage === 'PURSUIT') this.chase.teleportPlayerToSuspect();
    });
    keyboard.on('keydown-X', () => {
      if (debugState.isEnabled && this.stage === 'PURSUIT') this.handleEvents(this.chase.forceOutcome('ESCAPED'));
    });
    keyboard.on('keydown-N', () => debugState.isEnabled && this.nextChase());
  }

  /** The officer asks the dispatcher to repeat, then the last call plays again, unchanged. */
  private repeat(): void {
    if (this.stage !== 'PURSUIT') return;
    const last = this.chase.navigator.last;
    const result = this.chase.requestRepeat();
    if (!result || !last) return;
    if (!result.allowed) {
      this.hud.showToast('Plus de répétitions !');
      return;
    }
    const request = REPEAT_LINES[result.urgency];
    this.hud.showToast(result.penaltySeconds > 0 ? `${request.text}  (−${result.penaltySeconds} s)` : request.text);
    this.showTransmission(last, [{ audioId: request.audioId, radio: false }]);
  }

  /** Debug: the suspect's whole route and its destination. */
  private drawRoute(): Phaser.GameObjects.Graphics {
    const g = this.add.graphics().setDepth(25);
    const nodes = this.chase.scenario.route.map((id) => this.graph.node(id));
    g.lineStyle(5, 0xff7a00, 0.8);
    g.beginPath();
    nodes.forEach((n, i) => (i === 0 ? g.moveTo(n.x, n.y) : g.lineTo(n.x, n.y)));
    g.strokePath();
    const destination = this.graph.map.locations.find((l) => l.id === this.chase.scenario.destination);
    if (destination) {
      const { x, y, w, h } = destination.footprint;
      g.lineStyle(4, 0xff7a00, 1).strokeRect(x - 4, y - 4, w + 8, h + 8);
    }
    return g;
  }

  private scaleLabels(): void {
    const zoom = this.cameras.main.zoom;
    const scale = Phaser.Math.Clamp(0.8 / zoom, 0.35, 2);
    for (const { text, width } of this.layers?.labels ?? []) {
      if (text.scale === scale) continue;
      text.setScale(scale);
      text.setWordWrapWidth(Math.max(width / scale, 70));
    }
  }

  private syncDebug(): void {
    const on = debugState.isEnabled;
    this.layers?.debug.setVisible(on);
    this.routeOverlay?.setVisible(on);
  }
}
