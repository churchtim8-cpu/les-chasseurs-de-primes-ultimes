import Phaser from 'phaser';
import { BELLEVUE } from '../../content/map/bellevue';
import { audioCheck } from '../../engine/audio/manifest';
import { EVENT_LINES, OUTCOME_LINES, REPEAT_LINES, TRANSPORT_LINES } from '../../engine/audio/script';
import { DIFFICULTY_SETTINGS } from '../../engine/difficulty';
import { Chase, pointOf, type ChaseEvent, type SpokenText } from '../../engine/chase/chase';
import { generateScenario, type ScenarioOptions } from '../../engine/chase/scenario';
import { CHASE_TYPES, SIGHTING, type ChaseType } from '../../engine/chase/settings';
import type { SightingCard } from '../../engine/chase/sightings';
import type { Transmission } from '../../engine/language/navigator';
import { LANGUAGE_SETTINGS } from '../../engine/language/settings';
import { LOCATION_WORD_BY_ID, withArticle } from '../../engine/language/locations';
import type { MoverStart } from '../../engine/movement/mover';
import { TownGraph, type TravelMode } from '../../engine/world/graph';
import { scannerAudio, type SpokenLine } from '../audio/ScannerAudio';
import { CameraRig } from '../camera/cameraRig';
import { debugState } from '../debug/debugState';
import { Hud } from '../hud/Hud';
import { Controls, type ControlAction } from '../input/controls';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import {
  createIntentBadge,
  createOfficer,
  createPoliceCar,
  createSuspectCar,
  createSuspectRunner,
} from '../render/actors';
import { RoundaboutGuide } from '../render/roundaboutGuide';
import { drawTown, type TownLayers } from '../render/townRenderer';
import { TownLife } from '../render/townLife';

export interface ChaseSceneData {
  seed: string;
}

type Stage = 'COUNTDOWN' | 'PURSUIT' | 'RESULTS';

/**
 * One chase: the suspect travels its generated route (driving, on foot, or
 * changing between the two) and the player pursues, guided by the police
 * scanner's French: pre-recorded clips from the audio manifest, with the text
 * on screen as the level allows (and always when a line has no recording
 * yet). R or the Repeat button asks for the last call again; E or ⇄ gets out
 * of the car or back in.
 *
 * Debug keys (debug mode only): C = jump onto the suspect (test capture),
 * X = force escape, N = next chase. `?type=CAR_FOOT` (with `?seed=`) forces a
 * chase type.
 */
export class ChaseScene extends Phaser.Scene {
  static readonly KEY = 'Chase';
  private graph!: TownGraph;
  private layers?: TownLayers;
  private life?: TownLife;
  private chase!: Chase;
  private controls!: Controls;
  private rig!: CameraRig;
  private hud!: Hud;
  private car!: Phaser.GameObjects.Container;
  private officer!: Phaser.GameObjects.Container;
  /** The suspect's vehicle in each stage (null on foot). */
  private suspectCars: (Phaser.GameObjects.Container | null)[] = [];
  private suspectRunner!: Phaser.GameObjects.Container;
  private abandonedCar!: Phaser.GameObjects.Container;
  private routeOverlay!: Phaser.GameObjects.Graphics;
  private badge!: ReturnType<typeof createIntentBadge>;
  private roundabout!: RoundaboutGuide;
  /** The sighting call being answered, for R (repeat) while the question is open. */
  private sightingLine: SpokenText | null = null;
  private cameraMode: TravelMode = 'CAR';
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
  }

  create(): void {
    this.graph = new TownGraph(BELLEVUE);
    this.chase = new Chase(this.graph, generateScenario(this.graph, this.seed, scenarioOptionsFromAddress()), {
      hasAudio: audioCheck(scannerAudio.library),
    });
    scannerAudio.preload(
      [
        ...Object.values(OUTCOME_LINES),
        ...Object.values(TRANSPORT_LINES),
        ...Object.values(EVENT_LINES),
      ].map(
        (l) => l.audioId,
      ),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scannerAudio.stop());
    this.layers = drawTown(this, this.graph);
    if (new URLSearchParams(window.location.search).get('life') !== '0') {
      this.life = new TownLife(this, this.graph, { player: () => this.chase.player.snapshot() });
    }
    this.routeOverlay = this.drawRoute();
    // A suspect only ever leaves its first car behind (a later car stage is the last).
    const vehicles = this.chase.scenario.vehicles;
    this.abandonedCar = createSuspectCar(this, vehicles.find((v) => v !== null) ?? 'BLUE').setVisible(false);
    this.suspectCars = vehicles.map((v) => (v ? createSuspectCar(this, v).setAlpha(0) : null));
    this.suspectRunner = createSuspectRunner(this).setAlpha(0);
    this.car = createPoliceCar(this);
    this.officer = createOfficer(this).setVisible(false);
    this.badge = createIntentBadge(this);
    this.roundabout = new RoundaboutGuide(this, this.graph, () =>
      this.hud.showToast('Rond-point : ◀ ▶ pour choisir la sortie', 2600),
    );
    const me = this.chase.player.snapshot();
    this.displayHeading = me.heading;
    this.suspectHeading = this.chase.suspect.snapshot().heading;
    this.car.setPosition(me.x, me.y).setRotation(me.heading);
    this.cameraMode = me.mode;

    const worldObjects = [...this.children.list];

    this.rig = new CameraRig(this, this.cameras.main, BELLEVUE, me.mode);
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
    const stages = this.chase.scenario.stages.map((st) => `${st.mode === 'CAR' ? 'car' : 'foot'} ${Math.round(st.length)} m`);
    debugState.info.set('chase', this.chase.scenario.chaseType);
    debugState.info.set('route', stages.join(' → '));
    debugState.info.set('audio', `${scannerAudio.clipCount} clips`);
    this.hud.update(this.chase.status, me.mode);
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
    this.life?.update(delta);
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
      debugState.info.set('stage', `suspect ${this.chase.suspectStage + 1}, player ${this.chase.playerStage + 1}`);
      debugState.info.set('sightings', `${status.sightingsRight} / ${status.sightingsAsked}`);
    }
  }

  private countdown(): void {
    const steps = ['3', '2', '1', 'GO !'];
    steps.forEach((text, i) => this.time.delayedCall(i * 700, () => this.hud.showBanner(text)));
    this.time.delayedCall(steps.length * 700 - 500, () => (this.stage = 'PURSUIT'));
    this.time.delayedCall(steps.length * 700 + 100, () => this.hud.showBanner(''));
  }

  private handleEvents(events: ChaseEvent[]): void {
    for (const [i, event] of events.entries()) {
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
        case 'TRANSMISSION': {
          // An announcement just before it ("Attention ! Le suspect a changé de direction.")
          // is spoken first, and one marked `after` ("Nous avons perdu le signal.") straight
          // after, in the same call, so none cuts another off.
          const previous = events[i - 1];
          const next = events[i + 1];
          const lead = previous?.type === 'ANNOUNCE' && !previous.after ? previous.lines : [];
          const tail = next?.type === 'ANNOUNCE' && next.after ? next.lines : [];
          this.showTransmission(event.transmission, [], lead, tail);
          break;
        }
        case 'ANNOUNCE': {
          const joined = event.after ? events[i - 1]?.type === 'TRANSMISSION' : events[i + 1]?.type === 'TRANSMISSION';
          if (!joined) this.announce(event.lines);
          break;
        }
        case 'SIGHTING':
          this.askSighting(event.line, event.cards, event.seconds);
          break;
        case 'SIGHTING_RESULT':
          this.hud.resolveSighting(
            event.answer,
            event.chosen,
            event.correct
              ? `Bravo ! (+${SIGHTING.bonusSeconds} s)`
              : event.chosen === null
                ? `Trop tard ! (−${SIGHTING.penaltySeconds} s)`
                : `Ce n’est pas le suspect. (−${SIGHTING.penaltySeconds} s)`,
          );
          break;
        case 'SIGNAL':
          this.hud.showToast(event.lost ? 'SIGNAL PERDU' : 'SIGNAL RÉTABLI', 2000);
          break;
        case 'SUSPECT_MODE':
          break;
      }
    }
  }

  /**
   * Events and orders ("Il est à pied !", "Descendez de la voiture !"). Shown
   * as text unless every line is recorded and the level is audio only; an
   * order also shows which button to press.
   */
  private announce(lines: SpokenText[]): void {
    const difficulty = this.chase.scenario.difficulty;
    const text = lines.map((l) => l.text).join(' ');
    this.hud.showScanner(text, this.showsText(lines) ? Math.max(LANGUAGE_SETTINGS[difficulty].textSeconds, 4) : 0);
    void scannerAudio.play(lines.map((l) => ({ audioId: l.audioId, radio: true })));
    this.orderToasts(lines);
    debugState.info.set('scanner', `EVENT: ${lines.map((l) => l.audioId).join(' + ')}`);
  }

  /**
   * A sighting: the scanner says where the suspect is and the chase pauses
   * while the player picks the matching card (click, tap, or keys 1 to 4).
   */
  private askSighting(line: SpokenText, cards: readonly SightingCard[], seconds: number): void {
    this.sightingLine = line;
    void scannerAudio.play([{ audioId: line.audioId, radio: true }]);
    debugState.info.set('scanner', `EVENT: ${line.audioId}`);
    // The call is shown in the question strip (not the scanner bar below) when the level shows text.
    const call = this.showsText([line]) ? line.text : '';
    this.hud.showSighting(cards, seconds, call, (index) => this.handleEvents(this.chase.answerSighting(index)));
    const answer = this.chase.scenario.sightings.find((s) => s.cards === cards)?.answer;
    debugState.info.set('sighting', `answer ${answer === undefined ? '?' : answer + 1}`);
  }

  /** Text is shown unless the level is audio only and every line is recorded. */
  private showsText(lines: SpokenText[]): boolean {
    const voiced = lines.every((l) => scannerAudio.has(l.audioId));
    return DIFFICULTY_SETTINGS[this.chase.scenario.difficulty].textDisplay !== 'AUDIO_ONLY' || !voiced;
  }

  /** An order also shows which button to press. */
  private orderToasts(lines: SpokenText[]): void {
    const ids = lines.map((l) => l.audioId);
    if (ids.includes(TRANSPORT_LINES.GET_OUT.audioId)) this.hud.showToast('⇄ (E) : descendre de la voiture', 3500);
    if (ids.includes(TRANSPORT_LINES.GET_IN.audioId)) this.hud.showToast('⇄ (E) : monter dans la voiture', 3500);
  }

  /**
   * Speak a scanner call and show its text as the level allows: Hard and
   * Expert are audio only, but a line with no recording yet is always shown.
   * `before` is spoken first (the officer asking for a repeat); `lead` is an
   * announcement the dispatcher makes just before the call.
   */
  private showTransmission(
    transmission: Transmission,
    before: SpokenLine[] = [],
    lead: SpokenText[] = [],
    tail: SpokenText[] = [],
  ): void {
    const difficulty = this.chase.scenario.difficulty;
    const clips = [...lead, ...transmission.instructions.flatMap((i) => i.clips), ...tail];
    const voiced = clips.every((c) => scannerAudio.has(c.audioId));
    const audioOnly = DIFFICULTY_SETTINGS[difficulty].textDisplay === 'AUDIO_ONLY' && voiced;
    // A multi-part call stays up longer: two more seconds for each extra clip.
    const seconds = LANGUAGE_SETTINGS[difficulty].textSeconds + 2 * (clips.length - 1);
    this.hud.showScanner(clips.map((c) => c.text).join(' '), audioOnly ? 0 : seconds);
    this.orderToasts(lead);
    void scannerAudio.play([...before, ...clips.map((c) => ({ audioId: c.audioId, radio: true }))]);
    const detail = [
      ...lead.map((l) => l.audioId),
      ...transmission.instructions.map((i) => `${i.template} ${i.audioId}`),
      ...tail.map((l) => l.audioId),
    ].join(' + ');
    debugState.info.set('scanner', `${transmission.kind}: ${detail}`);
  }

  private handleAction(action: ControlAction): void {
    if (this.stage !== 'PURSUIT') return;
    const player = this.chase.player;
    switch (action) {
      case 'LEFT':
      case 'RIGHT': {
        // At a roundabout the arrows choose the numbered exit instead.
        const by = action === 'RIGHT' ? 1 : -1;
        if (!this.roundabout.step(player, by, this.roundabout.firstAvailable(player))) player.queue(action);
        break;
      }
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
    const { result, events } = this.chase.toggleMode();
    if (!result.ok && result.reason !== 'NOT_HERE') this.hud.showToast('La voiture est trop loin.');
    this.handleEvents(events);
  }

  private drawActors(delta: number): void {
    const me = this.chase.player.snapshot();
    if (me.mode !== this.cameraMode) {
      this.cameraMode = me.mode;
      this.rig.setMode(me.mode);
      this.displayHeading = me.heading;
    }
    this.displayHeading += Phaser.Math.Angle.Wrap(me.heading - this.displayHeading) * Math.min(1, delta / 90);
    const avatar = me.mode === 'CAR' ? this.car : this.officer;
    avatar.setPosition(me.x, me.y).setRotation(this.displayHeading);
    this.officer.setVisible(me.mode === 'FOOT');
    this.placeParked(this.car, me.mode === 'CAR' ? null : this.chase.parkedCar, me.mode === 'CAR');
    this.placeParked(this.abandonedCar, this.chase.abandonedCar, false);
    this.badge.container.setPosition(me.x, me.y - (me.mode === 'CAR' ? 16 : 10));
    this.badge.show(this.stage === 'PURSUIT' ? me.queued : null, this.displayHeading);
    const status = this.chase.status;
    this.roundabout.update(this.chase.player, this.stage === 'PURSUIT' && !status.followingTracks);

    const suspect = this.chase.suspect.snapshot();
    this.suspectHeading += Phaser.Math.Angle.Wrap(suspect.heading - this.suspectHeading) * Math.min(1, delta / 90);
    // The suspect is only on the map when close (a sighting) or at the end; debug always shows it.
    const visible = debugState.isEnabled || this.chase.status.suspectVisible || this.stage === 'RESULTS';
    const shown = this.suspectCars[this.chase.suspectStage] ?? this.suspectRunner;
    for (const sprite of [...this.suspectCars, this.suspectRunner]) if (sprite && sprite !== shown) sprite.setAlpha(0);
    shown.setPosition(suspect.x, suspect.y).setRotation(this.suspectHeading);
    const alpha = shown.alpha + ((visible ? 1 : 0) - shown.alpha) * Math.min(1, delta / 250);
    shown.setAlpha(alpha);

    this.rig.update(me, delta);
    this.scaleLabels();
  }

  /** A parked car (the police car while on foot, or the one the suspect left), or hidden. */
  private placeParked(sprite: Phaser.GameObjects.Container, at: MoverStart | null, inUse: boolean): void {
    if (inUse) {
      sprite.setVisible(true);
      return;
    }
    sprite.setVisible(at !== null);
    if (!at) return;
    const p = pointOf(this.graph, at);
    const edge = this.graph.edge(at.edgeId);
    const from = this.graph.node(this.graph.other(edge, at.towards));
    const to = this.graph.node(at.towards);
    sprite.setPosition(p.x, p.y).setRotation(Math.atan2(to.y - from.y, to.x - from.x));
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
    // Sighting answers.
    ['ONE', 'TWO', 'THREE', 'FOUR'].forEach((key, i) => {
      const answer = () => this.stage === 'PURSUIT' && this.handleEvents(this.chase.answerSighting(i));
      keyboard.on(`keydown-${key}`, answer);
      keyboard.on(`keydown-NUMPAD_${key}`, answer);
    });
  }

  /**
   * The last call plays again at once, unchanged. The officer's request
   * ("Répétez, s'il vous plaît !") shows as text only: spoken first, it made
   * the wait for the repeat too long (Mr Henry's playtest).
   */
  private repeat(): void {
    if (this.stage !== 'PURSUIT') return;
    if (this.chase.status.signalLost) {
      this.hud.showToast('Pas de signal !');
      return;
    }
    // While a sighting question is open, R repeats that call (free: the chase is paused).
    if (this.chase.status.sighting && this.sightingLine) {
      void scannerAudio.play([{ audioId: this.sightingLine.audioId, radio: true }]);
      return;
    }
    const last = this.chase.navigator.last;
    const result = this.chase.requestRepeat();
    if (!result || !last) return;
    if (!result.allowed) {
      this.hud.showToast('Plus de répétitions !');
      return;
    }
    const request = REPEAT_LINES[result.urgency];
    this.hud.showToast(result.penaltySeconds > 0 ? `${request.text}  (−${result.penaltySeconds} s)` : request.text);
    this.showTransmission(last);
  }

  /** Debug: the suspect's whole route, stage by stage (orange driving, green on foot), and its destination. */
  private drawRoute(): Phaser.GameObjects.Graphics {
    const g = this.add.graphics().setDepth(25);
    for (const stage of this.chase.scenario.stages) {
      const nodes = stage.route.map((id) => this.graph.node(id));
      g.lineStyle(5, stage.mode === 'CAR' ? 0xff7a00 : 0x2e9e5b, 0.8);
      g.beginPath();
      nodes.forEach((n, i) => (i === 0 ? g.moveTo(n.x, n.y) : g.lineTo(n.x, n.y)));
      g.strokePath();
      const start = nodes[0];
      if (start && stage !== this.chase.scenario.stages[0]) g.fillStyle(0xffffff, 1).fillCircle(start.x, start.y, 6);
    }
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

/**
 * Debug and tests: `?type=CAR_FOOT` forces a chase type; `?turnoff=1` (or 0) a
 * change of direction, `?sightings=0` no sightings, `?lost=1` a lost signal.
 * (`?life=0` turns off the town's traffic and other movement.)
 */
function scenarioOptionsFromAddress(): ScenarioOptions {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');
  const flag = (name: string) => {
    const value = params.get(name);
    return value === '1' || value === '0' ? value === '1' : undefined;
  };
  const turnOff = flag('turnoff');
  const sightings = flag('sightings');
  const lostSignal = flag('lost');
  return {
    ...(type && (CHASE_TYPES as readonly string[]).includes(type) ? { chaseType: type as ChaseType } : {}),
    ...(turnOff !== undefined ? { turnOff } : {}),
    ...(sightings !== undefined ? { sightings } : {}),
    ...(lostSignal !== undefined ? { lostSignal } : {}),
  };
}
