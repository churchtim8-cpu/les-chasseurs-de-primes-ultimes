import Phaser from 'phaser';
import { BELLEVUE } from '../../content/map/bellevue';
import { audioCheck } from '../../engine/audio/manifest';
import { ESCAPE_LINES, REPEAT_LINES, TRANSPORT_LINES } from '../../engine/audio/script';
import { DIFFICULTY_SETTINGS } from '../../engine/difficulty';
import { pointOf, type ChaseEvent, type SpokenText } from '../../engine/chase/chase';
import { Escape } from '../../engine/chase/escape';
import { generateScenario } from '../../engine/chase/scenario';
import type { MissionStats } from '../../engine/campaign/scoring';
import type { Transmission } from '../../engine/language/navigator';
import { LANGUAGE_SETTINGS } from '../../engine/language/settings';
import { LOCATION_WORD_BY_ID, withArticle } from '../../engine/language/locations';
import { nearestLocation } from '../../engine/language/analysis';
import type { MoverStart } from '../../engine/movement/mover';
import { TownGraph, type TravelMode } from '../../engine/world/graph';
import { actionSounds } from '../audio/ActionSounds';
import { ChaseMusic } from '../audio/ChaseMusic';
import { DrivingSounds } from '../audio/DrivingSounds';
import { FootSounds } from '../audio/FootSounds';
import { menuMusic } from '../audio/Jingles';
import { scannerAudio, type SpokenLine } from '../audio/ScannerAudio';
import { CameraRig } from '../camera/cameraRig';
import { loadProgress } from '../campaignStore';
import { debugState } from '../debug/debugState';
import { Hud } from '../hud/Hud';
import { Controls, type ControlAction } from '../input/controls';
import { livery } from '../../engine/campaign/campaign';
import { animateRunner, createIntentBadge, createOfficer, createPoliceCar, createSuspectCar, createSuspectRunner } from '../render/actors';
import { arrestKind, playArrest } from '../render/arrest';
import { BURNOUT_SMOKE, DriftEffects } from '../render/drift';
import { LanePosition } from '../render/lanes';
import { drawNight, nightOn } from '../render/night';
import { RoundaboutGuide } from '../render/roundaboutGuide';
import { preloadCanvaArt } from '../render/canvaArt';
import { drawTown, type TownLayers } from '../render/townRenderer';
import { TownLife } from '../render/townLife';
import { scenarioOptionsFromAddress } from '../scenarioOptions';
import { loadFacing, nextFacing } from './ChaseScene';
import type { ResultsData } from './ResultsScene';
import { PauseScene, type PauseSceneData } from './PauseScene';

export interface EscapeSceneData {
  seed: string;
}

type Stage = 'OPENING' | 'PURSUIT' | 'ARREST' | 'RESULTS';

const RESULTS_DELAY = { minMs: 1800, afterLineMs: 600, maxMs: 9000 } as const;
const OPENING = { minMs: 2500, maxMs: 14_000, goBannerMs: 900 } as const;
const BURNOUT = { holdMs: 700, ms: 1800 } as const;

/**
 * Escape Mode (Mr Henry, 2026-10-03): the roles switched. The player is the
 * fugitive, driving the getaway car or running, guided to the hideout ("la
 * planque") by their partner's French; the police follow their trail, a
 * little slower, and close in on every wrong turn or hesitation. The same
 * controls, scanner text rules, repeats and camera as the chase; the police
 * car and officer are drawn only when close, with their siren.
 *
 * Debug keys (debug mode only): K = arrested now, X = safe at the hideout now,
 * N = next escape.
 */
export class EscapeScene extends Phaser.Scene {
  static readonly KEY = 'Escape';
  private graph!: TownGraph;
  private layers?: TownLayers;
  private life?: TownLife;
  private escape!: Escape;
  private controls!: Controls;
  private rig!: CameraRig;
  private hud!: Hud;
  /** The player's car in each stage (null on foot), and the player on foot. */
  private cars: (Phaser.GameObjects.Container | null)[] = [];
  private runner!: Phaser.GameObjects.Container;
  private policeCar!: Phaser.GameObjects.Container;
  private officer!: Phaser.GameObjects.Container;
  private music!: ChaseMusic;
  private driving!: DrivingSounds;
  private footsteps!: FootSounds;
  private drift!: DriftEffects;
  private lanes!: { me: LanePosition; police: LanePosition };
  private routeOverlay!: Phaser.GameObjects.Graphics;
  private badge!: ReturnType<typeof createIntentBadge>;
  private roundabout!: RoundaboutGuide;
  private staged = false;
  private stride = 0;
  private policeStride = 0;
  private cameraMode: TravelMode = 'CAR';
  private displayHeading = 0;
  private policeHeading = 0;
  private stage: Stage = 'OPENING';
  private speech: Promise<void> = Promise.resolve();
  private burnoutUntil = 0;
  private launchAt = 0;
  private burning = false;
  private seed = '';

  constructor() {
    super(EscapeScene.KEY);
  }

  init(data: EscapeSceneData): void {
    this.seed = data.seed;
    this.stage = 'OPENING';
    this.burnoutUntil = 0;
    this.launchAt = 0;
    this.burning = false;
    this.staged = false;
  }

  preload(): void {
    preloadCanvaArt(this);
  }

  create(): void {
    this.graph = new TownGraph(BELLEVUE);
    this.lanes = { me: new LanePosition(this.graph), police: new LanePosition(this.graph) };
    this.escape = new Escape(this.graph, generateScenario(this.graph, this.seed, scenarioOptionsFromAddress()), {
      hasAudio: audioCheck(scannerAudio.library),
    });
    scannerAudio.preload([...Object.values(ESCAPE_LINES), ...Object.values(TRANSPORT_LINES)].map((l) => l.audioId));
    menuMusic.stop();
    this.music = new ChaseMusic(scannerAudio);
    this.music.setMode(this.escape.player.mode);
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
    if (nightOn()) drawNight(this, this.graph);
    if (new URLSearchParams(window.location.search).get('life') !== '0') {
      this.life = new TownLife(this, this.graph, {
        player: () => this.mySprite(),
        chasers: () => [this.mySprite(), ...(this.policeCar.visible ? [this.policeCar] : [])],
      });
    }
    this.routeOverlay = this.drawRoute();
    const vehicles = this.escape.scenario.vehicles;
    this.cars = vehicles.map((v) => (v ? createSuspectCar(this, v) : null));
    this.runner = createSuspectRunner(this).setVisible(false);
    this.drift = new DriftEffects(this);
    const colours = livery(loadProgress().livery);
    this.policeCar = createPoliceCar(this, colours).setVisible(false);
    this.officer = createOfficer(this, colours).setVisible(false);
    this.badge = createIntentBadge(this);
    this.roundabout = new RoundaboutGuide(this, this.graph, () =>
      this.hud.showToast('Rond-point : ◀ ▶ pour choisir la sortie', 2600),
    );
    const me = this.escape.player.snapshot();
    this.displayHeading = me.heading;
    this.policeHeading = this.escape.police.snapshot().heading;
    this.mySprite().setPosition(me.x, me.y).setRotation(me.heading);
    this.cameraMode = me.mode;

    const worldObjects = [...this.children.list];

    this.rig = new CameraRig(this, this.cameras.main, BELLEVUE, me.mode);
    this.rig.setFacing(loadFacing());
    this.controls = new Controls(this);
    this.controls.onAction((action) => this.handleAction(action));
    this.hud = new Hud(this, 'ÉVASION', 'POLICE');
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

    const scenario = this.escape.scenario;
    const destination = LOCATION_WORD_BY_ID.get(scenario.destination);
    debugState.info.set('seed', this.seed);
    debugState.info.set('difficulty', scenario.difficulty);
    debugState.info.set('mission', 'ESCAPE');
    debugState.info.set('destination', destination ? withArticle(destination) : scenario.destination);
    debugState.info.set('chase', scenario.chaseType);
    debugState.info.set('route', scenario.stages.map((st) => `${st.mode === 'CAR' ? 'car' : 'foot'} ${Math.round(st.length)} m`).join(' → '));
    debugState.info.set('audio', `${scannerAudio.clipCount} clips`);
    this.hud.update(this.escape.status, me.mode);
    this.opening();
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    if (this.stage === 'PURSUIT' && this.time.now >= this.launchAt) {
      const { accelerate, brake } = this.controls.state;
      this.escape.player.setThrottle(brake ? 'BRAKE' : accelerate ? 'ACCELERATE' : 'CRUISE');
      this.handleEvents(this.escape.update(dt));
    }
    this.drawActors(delta);
    this.life?.update(delta);
    this.hud.update(this.escape.status, this.escape.player.mode);

    if (debugState.isEnabled) {
      const status = this.escape.status;
      const me = this.escape.player.snapshot();
      debugState.info.set('phase', status.phase);
      debugState.info.set('distance', `${Math.round(status.distance)} m`);
      debugState.info.set('mode', me.mode);
      debugState.info.set('edge', `${me.edgeId} → ${me.towards}`);
      debugState.info.set('queued', me.queued ?? '-');
      debugState.info.set('speed', me.speed.toFixed(0));
      debugState.info.set('zoom', this.cameras.main.zoom.toFixed(3));
      debugState.info.set('repeats', `${status.repeatsUsed} used, ${status.repeatsLeft ?? 'unlimited'} left`);
      debugState.info.set('stage', `player ${this.escape.stage + 1}, police ${this.escape.policeStage + 1}`);
      debugState.info.set('police', this.escape.policeOnMap ? this.escape.police.mode : 'arriving');
    }
  }

  /** "Allez à la planque ! La police arrive." and the first direction are heard in full, then "GO !". */
  private opening(): void {
    this.hud.showBanner('PRÊT…');
    this.handleEvents(this.escape.openingCall());
    const minWait = new Promise<void>((resolve) => this.time.delayedCall(OPENING.minMs, () => resolve()));
    const maxWait = new Promise<void>((resolve) => this.time.delayedCall(OPENING.maxMs, () => resolve()));
    void Promise.race([Promise.all([this.speech, minWait]), maxWait]).then(() => {
      if (!this.scene.isActive() || this.stage !== 'OPENING') return;
      this.hud.showBanner('GO !');
      this.stage = 'PURSUIT';
      if (this.escape.player.mode === 'CAR') {
        this.launchAt = this.time.now + BURNOUT.holdMs;
        this.burnoutUntil = this.time.now + BURNOUT.ms;
        actionSounds.screech(BURNOUT.ms / 1000 + 0.2, 0.3);
      }
      this.time.delayedCall(OPENING.goBannerMs, () => this.hud.showBanner(''));
    });
  }

  private handleEvents(events: ChaseEvent[]): void {
    for (const [i, event] of events.entries()) {
      switch (event.type) {
        case 'SIGHTED':
          if (event.on) this.hud.showToast('Police en vue !');
          break;
        case 'WARNING':
          if (event.on) this.hud.showToast('La police se rapproche !');
          break;
        case 'CAPTURED':
          this.arrest();
          break;
        case 'ESCAPED':
          this.hideout();
          break;
        case 'TRANSMISSION': {
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
        default:
          break;
      }
    }
  }

  /** The partner's warnings and orders, as text when the level shows it (always when a line has no recording). */
  private announce(lines: SpokenText[]): void {
    const difficulty = this.escape.scenario.difficulty;
    const text = lines.map((l) => l.text).join(' ');
    this.hud.showScanner(text, this.showsText(lines) ? Math.max(LANGUAGE_SETTINGS[difficulty].textSeconds, 4) : 0);
    void scannerAudio.play(lines.map((l) => ({ audioId: l.audioId, radio: true })));
    this.orderToasts(lines);
    debugState.info.set('scanner', `EVENT: ${lines.map((l) => l.audioId).join(' + ')}`);
  }

  private showsText(lines: SpokenText[]): boolean {
    const voiced = lines.every((l) => scannerAudio.has(l.audioId));
    return DIFFICULTY_SETTINGS[this.escape.scenario.difficulty].textDisplay !== 'AUDIO_ONLY' || !voiced;
  }

  private orderToasts(lines: SpokenText[]): void {
    const ids = lines.map((l) => l.audioId);
    if (ids.includes(TRANSPORT_LINES.GET_OUT.audioId)) this.hud.showToast('⇄ (ESPACE) : descendre de la voiture', 3500);
    if (ids.includes(TRANSPORT_LINES.GET_IN.audioId)) this.hud.showToast('⇄ (ESPACE) : monter dans la voiture', 3500);
  }

  private showTransmission(transmission: Transmission, before: SpokenLine[] = [], lead: SpokenText[] = [], tail: SpokenText[] = []): void {
    const difficulty = this.escape.scenario.difficulty;
    const clips = [...lead, ...transmission.instructions.flatMap((i) => i.clips), ...tail];
    const voiced = clips.every((c) => scannerAudio.has(c.audioId));
    const audioOnly = DIFFICULTY_SETTINGS[difficulty].textDisplay === 'AUDIO_ONLY' && voiced;
    const seconds = LANGUAGE_SETTINGS[difficulty].textSeconds + 2 * (clips.length - 1);
    this.hud.showScanner(clips.map((c) => c.text).join(' '), audioOnly ? 0 : seconds);
    this.orderToasts(lead);
    this.speech = scannerAudio.play([...before, ...clips.map((c) => ({ audioId: c.audioId, radio: true }))]);
    const detail = [...lead.map((l) => l.audioId), ...transmission.instructions.map((i) => `${i.template} ${i.audioId}`), ...tail.map((l) => l.audioId)].join(' + ');
    debugState.info.set('scanner', `${transmission.kind}: ${detail}`);
  }

  /** ÉCHAP: everything freezes under the pause menu (the new police colours show from the next escape). */
  private pause(): void {
    if (this.stage === 'RESULTS' || !this.scene.isActive()) return;
    const data: PauseSceneData = {
      returnTo: this.scene.key,
      retry: () => this.scene.start(EscapeScene.KEY, { seed: this.seed }),
      quit: () => this.scene.start('Title'),
    };
    this.scene.launch(PauseScene.KEY, data);
    this.scene.pause();
  }

  private handleAction(action: ControlAction): void {
    if (this.stage !== 'PURSUIT') return;
    const player = this.escape.player;
    switch (action) {
      case 'LEFT':
      case 'RIGHT': {
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
      case 'TOGGLE_MODE': {
        const { result, events } = this.escape.toggleMode();
        if (!result.ok && result.reason !== 'NOT_HERE') this.hud.showToast('La voiture est trop loin.');
        this.handleEvents(events);
        break;
      }
      case 'OVERVIEW':
        if (debugState.isEnabled) this.rig.toggleOverview();
        break;
    }
  }

  /** The player as drawn now: their car for this stage, or on foot. */
  private mySprite(): Phaser.GameObjects.Container {
    return (this.escape.player.mode === 'CAR' ? this.cars[this.escape.stage] : null) ?? this.runner;
  }

  private policeSprite(): Phaser.GameObjects.Container {
    return this.escape.police.mode === 'CAR' ? this.policeCar : this.officer;
  }

  private drawActors(delta: number): void {
    const me = this.escape.player.snapshot();
    if (me.mode !== this.cameraMode) {
      this.cameraMode = me.mode;
      this.rig.setMode(me.mode);
      this.displayHeading = me.heading;
      this.music.setMode(me.mode);
      this.flashMode(me.mode);
    }
    this.displayHeading += Phaser.Math.Angle.Wrap(me.heading - this.displayHeading) * Math.min(1, delta / 90);
    const avatar = this.mySprite();
    const traffic = this.life?.cars() ?? [];
    const mine = this.lanes.me.update(me, traffic, delta);
    const drift = this.drift.update(
      { x: me.x + mine.x, y: me.y + mine.y, heading: me.heading, speed: me.speed, driving: me.mode === 'CAR' && this.stage === 'PURSUIT' },
      this.displayHeading,
      delta,
    );
    if (!this.staged) {
      avatar.setPosition(me.x + mine.x + drift.dx, me.y + mine.y + drift.dy).setRotation(this.displayHeading + drift.swing);
      this.stride += (delta / 1000) * me.speed * 0.75;
      if (me.mode === 'FOOT') animateRunner(this.runner, this.stride, me.speed > 1);
      this.burnout(me, delta);
    }
    this.runner.setVisible(me.mode === 'FOOT');
    const status = this.escape.status;
    const policeNear = this.escape.policeOnMap && (status.suspectVisible || this.stage === 'ARREST');
    this.driving.update({ driving: me.mode === 'CAR' && this.stage === 'PURSUIT', speed: me.speed, heading: me.heading, siren: policeNear }, delta);
    this.footsteps.update({ running: me.mode === 'FOOT' && this.stage === 'PURSUIT', speed: me.speed, stride: this.stride }, delta);
    // Cars not in use: the getaway car waiting up the street, or the one the player left behind.
    this.cars.forEach((car, i) => {
      if (!car || (i === this.escape.stage && me.mode === 'CAR')) return;
      const at = i > this.escape.stage ? (i === this.escape.stage + 1 ? this.escape.parkedCar ?? this.escape.stageStart(i) : this.escape.stageStart(i)) : this.escape.abandonedCar;
      this.placeParked(car, at);
    });
    const lift = me.mode === 'CAR' ? 16 : 10;
    const turned = this.rig.rotation;
    this.badge.container.setPosition(me.x + mine.x - lift * Math.sin(turned), me.y + mine.y - lift * Math.cos(turned));
    this.badge.show(this.stage === 'PURSUIT' ? me.queued : null, this.displayHeading);
    this.music.setIntensity(status.signal);
    this.roundabout.update(this.escape.player, this.stage === 'PURSUIT' && !status.followingTracks);

    // The police: on the map only when close (or always in debug mode), with the car left behind on foot.
    const cop = this.escape.police.snapshot();
    this.policeHeading += Phaser.Math.Angle.Wrap(cop.heading - this.policeHeading) * Math.min(1, delta / 90);
    const visible = this.escape.policeOnMap && (debugState.isEnabled || status.suspectVisible || this.stage !== 'PURSUIT');
    const shown = this.policeSprite();
    const theirs = this.lanes.police.update(cop, traffic, delta);
    if (!this.staged) {
      shown.setPosition(cop.x + theirs.x, cop.y + theirs.y).setRotation(this.policeHeading);
      if (shown === this.officer) {
        this.policeStride += (delta / 1000) * cop.speed * 0.75;
        animateRunner(this.officer, this.policeStride, cop.speed > 1);
      }
      const alpha = shown.alpha + ((visible ? 1 : 0) - shown.alpha) * Math.min(1, delta / 250);
      shown.setAlpha(alpha).setVisible(alpha > 0.02);
    }
    if (shown === this.officer) this.placeParked(this.policeCar, visible ? this.escape.policeParked : null);
    else this.officer.setVisible(false);

    const framed = this.staged ? shown : null;
    this.rig.update(framed ? { x: (avatar.x + framed.x) / 2, y: (avatar.y + framed.y) / 2, heading: this.policeHeading } : me, delta);
    this.scaleLabels();
    this.keepUpright();
  }

  /** "GO !" in the car: the getaway car peels off in a cloud of tyre smoke. */
  private burnout(me: { x: number; y: number; mode: TravelMode }, delta: number): void {
    const burning = me.mode === 'CAR' && this.stage === 'PURSUIT' && this.time.now < this.burnoutUntil;
    const car = this.mySprite();
    if (burning) this.drift.tyres('getaway', car.x, car.y, car.rotation, 1, delta / 1000, BURNOUT_SMOKE);
    else if (this.burning) this.drift.lift('getaway');
    this.burning = burning;
  }

  private flashMode(mode: TravelMode): void {
    if (this.stage !== 'PURSUIT') return;
    this.hud.showBanner(mode === 'FOOT' ? 'À PIED !' : 'EN VOITURE !');
    this.time.delayedCall(1100, () => this.stage === 'PURSUIT' && this.hud.showBanner(''));
    this.cameras.main.flash(180, 255, 255, 255, false);
  }

  private cycleFacing(): void {
    const facing = nextFacing();
    this.rig.setFacing(facing);
    this.hud.setFacing(facing);
  }

  private toggleMusic(): void {
    const muted = this.music.toggleMute();
    this.hud.setMusic(!muted);
  }

  /** A parked car where it was left (or hidden). */
  private placeParked(sprite: Phaser.GameObjects.Container, at: MoverStart | null): void {
    sprite.setVisible(at !== null).setAlpha(1);
    if (!at) return;
    const p = pointOf(this.graph, at);
    const edge = this.graph.edge(at.edgeId);
    const from = this.graph.node(this.graph.other(edge, at.towards));
    const to = this.graph.node(at.towards);
    sprite.setPosition(p.x, p.y).setRotation(Math.atan2(to.y - from.y, to.x - from.x));
  }

  /** Safe: "Bravo ! Vous avez semé la police !" */
  private hideout(): void {
    this.showResults(scannerAudio.play([{ audioId: ESCAPE_LINES.WON.audioId, radio: true }]), 'Vous avez semé la police !');
  }

  /**
   * Caught: the arrest plays out on the map with the roles switched (the
   * police car blocks the getaway car, or the officer tackles the player),
   * then "Vous êtes arrêté !". Out of time, the roadblocks did it.
   */
  private arrest(): void {
    if (this.stage === 'ARREST' || this.stage === 'RESULTS') return;
    const said = () => scannerAudio.play([{ audioId: ESCAPE_LINES.ARRESTED.audioId, radio: true }]);
    if (this.escape.status.escapeReason === 'TIME' || !this.escape.policeOnMap) {
      this.showResults(said(), 'Barrages en place : vous êtes arrêté !');
      return;
    }
    this.stage = 'ARREST';
    this.staged = true;
    const me = this.escape.player.snapshot();
    const police = this.policeSprite();
    police.setAlpha(1).setVisible(true);
    this.rig.closeUp();
    void playArrest(this, this.drift, {
      police,
      suspect: this.mySprite(),
      policeHeading: this.policeHeading,
      suspectHeading: this.displayHeading,
      suspectSpeed: me.speed,
      kind: arrestKind(this.escape.police.mode, me.mode === 'CAR'),
    }).then(() => {
      if (this.scene.isActive()) this.showResults(said(), 'Vous êtes arrêté !');
    });
  }

  private showResults(said: Promise<void>, banner: string): void {
    if (this.stage === 'RESULTS') return;
    this.stage = 'RESULTS';
    this.music.stop();
    const status = this.escape.status;
    const away = status.phase === 'ESCAPED';
    this.hud.showBanner(banner);
    const history = this.escape.navigator.history;
    const stats: MissionStats = {
      difficulty: this.escape.scenario.difficulty,
      captured: away,
      timeLeft: status.timeLeft,
      directions: history.filter((t) => t.kind === 'DIRECTION' || t.kind === 'FINAL').length,
      wrongTurns: history.filter((t) => t.kind === 'RECOVERY').length,
      repeatsUsed: status.repeatsUsed,
      sightingsAsked: 0,
      sightingsRight: 0,
      transportChanges: this.escape.stage,
    };
    const scenario = this.escape.scenario;
    const data: ResultsData = {
      seed: this.seed,
      mission: null,
      boss: null,
      escape: true,
      stats,
      timeLimit: this.escape.timeLimit,
      night: nightOn(),
      mode: this.escape.player.mode,
      lastSeen: nearestLocation(this.graph, this.escape.player.snapshot())?.id ?? scenario.destination,
      vehicle: scenario.vehicles[0] ?? null,
      chaseType: scenario.chaseType,
      ...(status.escapeReason ? { escapeReason: status.escapeReason } : {}),
    };
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

  private bindKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.on('keydown-ESC', () => this.pause());
    keyboard.addCapture('TAB');
    keyboard.on('keydown-TAB', () => this.hud.toggle());
    keyboard.on('keydown-R', () => this.repeat());
    keyboard.on('keydown-K', () => {
      if (debugState.isEnabled && this.stage === 'PURSUIT') this.handleEvents(this.escape.forceOutcome('CAPTURED'));
    });
    keyboard.on('keydown-X', () => {
      if (debugState.isEnabled && this.stage === 'PURSUIT') this.handleEvents(this.escape.forceOutcome('ESCAPED'));
    });
    keyboard.on('keydown-N', () => debugState.isEnabled && this.scene.start('Practice', { autostart: true, escape: true }));
    keyboard.on('keydown-B', () => this.toggleMusic());
    keyboard.on('keydown-V', () => this.cycleFacing());
  }

  /** The last call again (the request shows as text only, as in the chase). */
  private repeat(): void {
    if (this.stage !== 'PURSUIT') return;
    const last = this.escape.navigator.last;
    const result = this.escape.requestRepeat();
    if (!result || !last) return;
    if (!result.allowed) {
      this.hud.showToast('Plus de répétitions !');
      return;
    }
    const request = REPEAT_LINES[result.urgency];
    this.hud.showToast(result.penaltySeconds > 0 ? `${request.text}  (−${result.penaltySeconds} s)` : request.text);
    this.showTransmission(last);
  }

  /** Debug: the route to the hideout, stage by stage, and the hideout itself. */
  private drawRoute(): Phaser.GameObjects.Graphics {
    const g = this.add.graphics().setDepth(25);
    for (const stage of this.escape.scenario.stages) {
      const nodes = stage.route.map((id) => this.graph.node(id));
      g.lineStyle(5, stage.mode === 'CAR' ? 0xff7a00 : 0x2e9e5b, 0.8);
      g.beginPath();
      nodes.forEach((n, i) => (i === 0 ? g.moveTo(n.x, n.y) : g.lineTo(n.x, n.y)));
      g.strokePath();
    }
    const destination = this.graph.map.locations.find((l) => l.id === this.escape.scenario.destination);
    if (destination) {
      const { x, y, w, h } = destination.footprint;
      g.lineStyle(4, 0xff7a00, 1).strokeRect(x - 4, y - 4, w + 8, h + 8);
    }
    return g;
  }

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
