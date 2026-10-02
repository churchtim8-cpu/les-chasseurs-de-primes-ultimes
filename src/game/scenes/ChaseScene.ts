import Phaser from 'phaser';
import { BELLEVUE } from '../../content/map/bellevue';
import { audioCheck } from '../../engine/audio/manifest';
import { EVENT_LINES, OUTCOME_LINES, REPEAT_LINES, TRANSPORT_LINES } from '../../engine/audio/script';
import { DIFFICULTY_SETTINGS } from '../../engine/difficulty';
import { Chase, pointOf, type ChaseEvent, type SpokenText } from '../../engine/chase/chase';
import { generateScenario } from '../../engine/chase/scenario';
import { SIGHTING } from '../../engine/chase/settings';
import { livery, MISSION_COUNT } from '../../engine/campaign/campaign';
import type { MissionStats } from '../../engine/campaign/scoring';
import type { SightingCard } from '../../engine/chase/sightings';
import type { Transmission } from '../../engine/language/navigator';
import { LANGUAGE_SETTINGS } from '../../engine/language/settings';
import { LOCATION_WORD_BY_ID, withArticle } from '../../engine/language/locations';
import type { MoverStart } from '../../engine/movement/mover';
import { TownGraph, type TravelMode } from '../../engine/world/graph';
import { HALF_WIDTH, PAVEMENT } from '../../engine/world/geometry';
import { ChaseMusic } from '../audio/ChaseMusic';
import { DrivingSounds } from '../audio/DrivingSounds';
import { FootSounds } from '../audio/FootSounds';
import { menuMusic } from '../audio/Jingles';
import { loadProgress } from '../campaignStore';
import { scenarioOptionsFromAddress } from '../scenarioOptions';
import type { ResultsData } from './ResultsScene';
import { scannerAudio, type SpokenLine } from '../audio/ScannerAudio';
import { CameraRig, MAP_FACINGS, type MapFacing } from '../camera/cameraRig';
import { debugState } from '../debug/debugState';
import { Hud } from '../hud/Hud';
import { Controls, type ControlAction } from '../input/controls';
import {
  animateRunner,
  createIntentBadge,
  createOfficer,
  createPoliceCar,
  createSuspectCar,
  createSuspectRunner,
} from '../render/actors';
import { arrestKind, playArrest } from '../render/arrest';
import { DriftEffects } from '../render/drift';
import { RoundaboutGuide } from '../render/roundaboutGuide';
import { preloadCanvaArt } from '../render/canvaArt';
import { drawTown, type TownLayers } from '../render/townRenderer';
import { TownLife } from '../render/townLife';

export interface ChaseSceneData {
  seed: string;
  /** Campaign mission (0-based); absent for a practice chase. */
  mission?: number;
}

type Stage = 'COUNTDOWN' | 'PURSUIT' | 'ARREST' | 'RESULTS';

/** When the results screen opens after "Le suspect est arrêté" / "s'est échappé" (ms). */
const RESULTS_DELAY = { minMs: 1800, afterLineMs: 600, maxMs: 9000 } as const;

/**
 * One chase: the suspect travels its generated route (driving, on foot, or
 * changing between the two) and the player pursues, guided by the police
 * scanner's French: pre-recorded clips from the audio manifest, with the text
 * on screen as the level allows (and always when a line has no recording
 * yet). R or the Repeat button asks for the last call again; E or ⇄ gets out
 * of the car or back in.
 *
 * Debug keys (debug mode only): C = jump onto the suspect (test capture),
 * K = skip the mission (counts as a capture), X = force escape, N = next chase. `?type=CAR_FOOT` (with `?seed=`) forces a
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
  private music!: ChaseMusic;
  private driving!: DrivingSounds;
  private footsteps!: FootSounds;
  /** Speed streaks behind the police car. */
  private trail!: Phaser.GameObjects.Graphics;
  private trailPoints: { x: number; y: number; heading: number }[] = [];
  private drift!: DriftEffects;
  /** The arrest scene has taken over the police and suspect drawings. */
  private staged = false;
  private stride = 0;
  private suspectStride = 0;
  /** Smoothed sideways shift that puts runners on the pavement (see onPavement). */
  private readonly pavement = { me: { x: 0, y: 0 }, suspect: { x: 0, y: 0 } };
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
  private mission: number | null = null;

  constructor() {
    super(ChaseScene.KEY);
  }

  init(data: ChaseSceneData): void {
    this.seed = data.seed;
    this.mission = typeof data.mission === 'number' ? data.mission : null;
    this.stage = 'COUNTDOWN';
    this.staged = false;
  }

  preload(): void {
    preloadCanvaArt(this);
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
    menuMusic.stop();
    this.music = new ChaseMusic(scannerAudio);
    this.music.setMode(this.chase.player.mode);
    this.music.start();
    this.driving = new DrivingSounds(scannerAudio);
    this.footsteps = new FootSounds(scannerAudio);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scannerAudio.stop();
      this.music.stop();
      this.driving.stop();
      this.footsteps.stop();
    });
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
    this.trail = this.add.graphics().setDepth(28);
    this.drift = new DriftEffects(this);
    const colours = livery(loadProgress().livery);
    this.car = createPoliceCar(this, colours);
    this.officer = createOfficer(this, colours).setVisible(false);
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
    this.rig.setFacing(loadFacing());
    this.controls = new Controls(this);
    this.controls.onAction((action) => this.handleAction(action));
    this.hud = new Hud(this, this.mission === null ? 'ENTRAÎNEMENT' : `MISSION ${this.mission + 1} / ${MISSION_COUNT}`);
    this.hud.onRepeat(() => this.repeat());
    this.hud.onMusic(() => this.toggleMusic());
    this.hud.setMusic(!this.music.isMuted);
    this.hud.onFacing(() => this.cycleFacing());
    this.hud.setFacing(loadFacing());

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
          this.arrest();
          break;
        case 'ESCAPED':
          this.showResults(scannerAudio.play([{ audioId: OUTCOME_LINES.ESCAPED.audioId, radio: true }]));
          break;
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
      this.music.setMode(me.mode);
      this.trailPoints = [];
      this.flashMode(me.mode);
    }
    this.displayHeading += Phaser.Math.Angle.Wrap(me.heading - this.displayHeading) * Math.min(1, delta / 90);
    const avatar = me.mode === 'CAR' ? this.car : this.officer;
    const mine = this.onPavement(me, this.pavement.me, delta);
    const drift = this.drift.update(
      { x: me.x, y: me.y, heading: me.heading, speed: me.speed, driving: me.mode === 'CAR' && this.stage === 'PURSUIT' },
      this.displayHeading,
      delta,
    );
    if (!this.staged) {
      avatar.setPosition(me.x + mine.x + drift.dx, me.y + mine.y + drift.dy).setRotation(this.displayHeading + drift.swing);
      // About three strides a second at running speed.
      this.stride += (delta / 1000) * me.speed * 0.75;
      if (me.mode === 'FOOT') animateRunner(this.officer, this.stride, me.speed > 1);
    }
    this.officer.setVisible(me.mode === 'FOOT');
    this.drawTrail(me);
    this.driving.update({ driving: me.mode === 'CAR' && this.stage === 'PURSUIT', speed: me.speed, heading: me.heading }, delta);
    this.footsteps.update({ running: me.mode === 'FOOT' && this.stage === 'PURSUIT', speed: me.speed, stride: this.stride }, delta);
    this.placeParked(this.car, me.mode === 'CAR' ? null : this.chase.parkedCar, me.mode === 'CAR');
    this.placeParked(this.abandonedCar, this.chase.abandonedCar, false);
    // Above the player on screen, whichever way the map is turned.
    const lift = me.mode === 'CAR' ? 16 : 10;
    const turned = this.rig.rotation;
    this.badge.container.setPosition(me.x + mine.x - lift * Math.sin(turned), me.y + mine.y - lift * Math.cos(turned));
    this.badge.show(this.stage === 'PURSUIT' ? me.queued : null, this.displayHeading);
    const status = this.chase.status;
    this.music.setIntensity(status.signal);
    this.roundabout.update(this.chase.player, this.stage === 'PURSUIT' && !status.followingTracks);

    const suspect = this.chase.suspect.snapshot();
    this.suspectHeading += Phaser.Math.Angle.Wrap(suspect.heading - this.suspectHeading) * Math.min(1, delta / 90);
    // The suspect is only on the map when close (a sighting) or at the end; debug always shows it.
    const visible = debugState.isEnabled || this.chase.status.suspectVisible || this.stage === 'RESULTS';
    const shown = this.suspectCars[this.chase.suspectStage] ?? this.suspectRunner;
    for (const sprite of [...this.suspectCars, this.suspectRunner]) if (sprite && sprite !== shown) sprite.setAlpha(0);
    const theirs = this.onPavement(suspect, this.pavement.suspect, delta);
    if (!this.staged) {
      shown.setPosition(suspect.x + theirs.x, suspect.y + theirs.y).setRotation(this.suspectHeading);
      if (shown === this.suspectRunner) {
        this.suspectStride += (delta / 1000) * suspect.speed * 0.75;
        animateRunner(this.suspectRunner, this.suspectStride, suspect.speed > 1);
      }
      const alpha = shown.alpha + ((visible ? 1 : 0) - shown.alpha) * Math.min(1, delta / 250);
      shown.setAlpha(alpha);
    }

    // During the arrest the camera frames both of them.
    const framed = this.staged ? this.suspectCars[this.chase.suspectStage] ?? this.suspectRunner : null;
    this.rig.update(framed ? { x: (avatar.x + framed.x) / 2, y: (avatar.y + framed.y) / 2, heading: this.suspectHeading } : me, delta);
    this.scaleLabels();
    this.keepUpright();
  }

  /**
   * On foot along a road, runners keep to the pavement on their right instead of
   * the middle of the road (drawing only: the chase still measures the road's centre).
   * The shift eases in and out so it never jumps at junctions or footpaths.
   */
  private onPavement(
    who: { heading: number; mode: TravelMode; edgeId: string },
    shift: { x: number; y: number },
    delta: number,
  ): { x: number; y: number } {
    const edge = this.graph.edge(who.edgeId);
    const side = who.mode === 'FOOT' && edge.car ? HALF_WIDTH[edge.kind] + PAVEMENT / 2 : 0;
    const k = Math.min(1, delta / 220);
    shift.x += (-Math.sin(who.heading) * side - shift.x) * k;
    shift.y += (Math.cos(who.heading) * side - shift.y) * k;
    return shift;
  }

  /** Light streaks behind the police car at speed: driving feels fast, running does not leave them. */
  private drawTrail(me: { x: number; y: number; heading: number; speed: number; mode: TravelMode }): void {
    this.trail.clear();
    if (me.mode !== 'CAR' || this.stage !== 'PURSUIT' || me.speed < 30) {
      this.trailPoints = [];
      return;
    }
    this.trailPoints.unshift({ x: me.x, y: me.y, heading: me.heading });
    if (this.trailPoints.length > 12) this.trailPoints.length = 12;
    for (const side of [-3.6, 3.6]) {
      for (let i = 1; i < this.trailPoints.length; i++) {
        const a = this.trailPoints[i - 1]!;
        const b = this.trailPoints[i]!;
        const back = 11;
        const ax = a.x - Math.cos(a.heading) * back - Math.sin(a.heading) * side;
        const ay = a.y - Math.sin(a.heading) * back + Math.cos(a.heading) * side;
        const bx = b.x - Math.cos(b.heading) * back - Math.sin(b.heading) * side;
        const by = b.y - Math.sin(b.heading) * back + Math.cos(b.heading) * side;
        this.trail.lineStyle(1.6, 0xffffff, 0.45 * (1 - i / this.trailPoints.length)).lineBetween(ax, ay, bx, by);
      }
    }
  }

  /** "À PIED !" / "EN VOITURE !" across the screen when the player changes transport. */
  private flashMode(mode: TravelMode): void {
    if (this.stage !== 'PURSUIT') return;
    this.hud.showBanner(mode === 'FOOT' ? 'À PIED !' : 'EN VOITURE !');
    this.time.delayedCall(1100, () => this.stage === 'PURSUIT' && this.hud.showBanner(''));
    this.cameras.main.flash(180, 255, 255, 255, false);
  }

  /** V or the CARTE button: map turns on foot, always, or never (remembered on this device). */
  private cycleFacing(): void {
    const facing = MAP_FACINGS[(MAP_FACINGS.indexOf(loadFacing()) + 1) % MAP_FACINGS.length] as MapFacing;
    try {
      window.localStorage.setItem(FACING_KEY, facing);
    } catch {
      // storage unavailable: the choice lasts for this chase only
    }
    chosenFacing = facing;
    this.rig.setFacing(facing);
    this.hud.setFacing(facing);
  }

  private toggleMusic(): void {
    const muted = this.music.toggleMute();
    this.hud.setMusic(!muted);
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

  /**
   * The chase is over: the outcome shows as a banner over the map while the
   * scanner says it, and the results screen opens once the line has been
   * heard in full (never sooner than RESULTS_DELAY.minMs, never later than
   * RESULTS_DELAY.maxMs). ENTRÉE or a tap goes there at once.
   */
  private showResults(said: Promise<void>): void {
    if (this.stage === 'RESULTS') return;
    this.stage = 'RESULTS';
    this.music.stop();
    const status = this.chase.status;
    const captured = status.phase === 'CAPTURED';
    this.hud.showBanner(captured ? 'Le suspect est arrêté !' : 'Le suspect s’est échappé.');
    const history = this.chase.navigator.history;
    const stats: MissionStats = {
      difficulty: this.chase.scenario.difficulty,
      captured,
      timeLeft: status.timeLeft,
      directions: history.filter((t) => t.kind === 'DIRECTION' || t.kind === 'FINAL').length,
      wrongTurns: history.filter((t) => t.kind === 'RECOVERY').length,
      repeatsUsed: status.repeatsUsed,
      sightingsAsked: status.sightingsAsked,
      sightingsRight: status.sightingsRight,
      transportChanges: this.chase.playerStage,
    };
    const data: ResultsData = {
      seed: this.seed,
      mission: this.mission,
      stats,
      ...(status.escapeReason ? { escapeReason: status.escapeReason } : {}),
    };
    debugState.info.set('wrong turns', String(stats.wrongTurns));
    let left = false;
    const go = () => {
      if (left || !this.scene.isActive()) return;
      left = true;
      this.scene.start('Results', data);
    };
    const minWait = new Promise<void>((resolve) => this.time.delayedCall(RESULTS_DELAY.minMs, () => resolve()));
    void Promise.all([said, minWait]).then(() => {
      if (this.scene.isActive()) this.time.delayedCall(RESULTS_DELAY.afterLineMs, go);
    });
    this.time.delayedCall(RESULTS_DELAY.maxMs, go);
    this.input.once('pointerdown', go);
    this.input.keyboard?.once('keydown-ENTER', go);
  }

  /**
   * Caught: the arrest plays out on the map (the police car blocks the
   * suspect's car, or the officer tackles the suspect), then the scanner says
   * "Le suspect est arrêté !" and the results follow.
   */
  private arrest(): void {
    if (this.stage === 'ARREST' || this.stage === 'RESULTS') return;
    this.stage = 'ARREST';
    this.staged = true;
    const me = this.chase.player.snapshot();
    const suspectCar = this.suspectCars[this.chase.suspectStage] ?? null;
    this.rig.closeUp();
    void playArrest(this, this.drift, {
      police: me.mode === 'CAR' ? this.car : this.officer,
      suspect: suspectCar ?? this.suspectRunner,
      policeHeading: this.displayHeading,
      suspectHeading: this.suspectHeading,
      suspectSpeed: this.chase.suspect.snapshot().speed,
      kind: arrestKind(me.mode, suspectCar !== null),
    }).then(() => {
      if (this.scene.isActive()) this.showResults(scannerAudio.play([{ audioId: OUTCOME_LINES.CAPTURED.audioId, radio: true }]));
    });
  }

  private nextChase(): void {
    this.scene.start('Practice', { autostart: true });
  }

  private bindKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.on('keydown-ESC', () => this.scene.start(this.mission === null ? 'Title' : 'Campaign'));
    keyboard.on('keydown-R', () => this.repeat());
    keyboard.on('keydown-C', () => {
      if (debugState.isEnabled && this.stage === 'PURSUIT') this.chase.teleportPlayerToSuspect();
    });
    keyboard.on('keydown-K', () => {
      if (debugState.isEnabled && this.stage === 'PURSUIT') this.handleEvents(this.chase.forceOutcome('CAPTURED'));
    });
    keyboard.on('keydown-X', () => {
      if (debugState.isEnabled && this.stage === 'PURSUIT') this.handleEvents(this.chase.forceOutcome('ESCAPED'));
    });
    keyboard.on('keydown-N', () => debugState.isEnabled && this.nextChase());
    keyboard.on('keydown-B', () => this.toggleMusic());
    keyboard.on('keydown-V', () => this.cycleFacing());
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

  /** Place names and exit numbers stay readable when the map turns. */
  private keepUpright(): void {
    const upright = -this.rig.rotation;
    for (const { text } of this.layers?.labels ?? []) text.setRotation(upright);
    this.roundabout.setUpright(upright);
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

const FACING_KEY = 'chasseurs.mapFacing';
/** Set when the player changes the facing during this visit. */
let chosenFacing: MapFacing | null = null;

/** The map facing: the player's latest choice, else `?facing=north` (or foot, always), else remembered. */
function loadFacing(): MapFacing {
  if (chosenFacing) return chosenFacing;
  const fromAddress = new URLSearchParams(window.location.search).get('facing')?.toUpperCase();
  if (MAP_FACINGS.includes(fromAddress as MapFacing)) return fromAddress as MapFacing;
  try {
    const stored = window.localStorage.getItem(FACING_KEY);
    if (MAP_FACINGS.includes(stored as MapFacing)) return stored as MapFacing;
  } catch {
    // storage unavailable
  }
  return 'FOOT';
}
