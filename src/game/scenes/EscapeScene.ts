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
import { debugState } from '../debug/debugState';
import { Hud } from '../hud/Hud';
import { Controls, type ControlAction } from '../input/controls';
import { animateRunner, createGetawayCar, createIntentBadge, createOfficer, createPoliceCar, createSuspectRunner } from '../render/actors';
import { arrestKind, playArrest } from '../render/arrest';
import { BURNOUT_SMOKE, DriftEffects } from '../render/drift';
import { LanePosition } from '../render/lanes';
import { drawNight, nightOn } from '../render/night';
import { DangerPulse, ESCAPE_FX, HideoutMarker } from '../render/escapeFx';
import { Searchlight } from '../render/searchlight';
import { distance } from '../../engine/world/geometry';
import { currentFestival, drawFestival } from '../render/festival';
import { drawWeather, onScreen, weatherFor } from '../render/weather';
import { RoundaboutGuide } from '../render/roundaboutGuide';
import { preloadCanvaArt } from '../render/canvaArt';
import { drawTown, type TownLayers } from '../render/townRenderer';
import { TownLife } from '../render/townLife';
import { scenarioOptionsFromAddress } from '../scenarioOptions';
import { loadFacing, nextFacing } from './ChaseScene';
import type { ResultsData } from './ResultsScene';
import { PauseScene, type PauseSceneData } from './PauseScene';
import { currentLook } from '../lookStore';
import { liveryLook } from '../../engine/campaign/cosmetics';
import { officerInfo } from '../../engine/campaign/officers';
import { FONT_FAMILY } from '../palette';
import { ESCAPE } from '../../engine/chase/settings';

export interface EscapeSceneData {
  seed: string;
  /** The escape campaign's officer (officers.ts id), or none for a practice escape. */
  officer?: string;
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
  private officerId: string | undefined;
  /** Where the police are when they are off the screen but still in view: a flashing marker at its edge. */
  private policeMarker!: Phaser.GameObjects.Container;
  /** The red throb when the police are right behind, the hideout's sign and ring, and the night helicopter. */
  private danger!: DangerPulse;
  private hideoutMark!: HideoutMarker;
  private searchlight?: Searchlight;

  constructor() {
    super(EscapeScene.KEY);
  }

  init(data: EscapeSceneData): void {
    this.seed = data.seed;
    this.officerId = officerInfo(data.officer)?.id;
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
    const officer = officerInfo(this.officerId);
    const options = officer?.chaseType ? { ...scenarioOptionsFromAddress(), chaseType: officer.chaseType } : scenarioOptionsFromAddress();
    this.escape = new Escape(this.graph, generateScenario(this.graph, this.seed, options), {
      hasAudio: audioCheck(scannerAudio.library),
      ...(officer ? { policeSpeed: officer.speed } : {}),
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
    // Bellevue en fête: Carnival or Christmas decorations, by the calendar or the title-screen choice.
    drawFestival(this, this.graph, currentFestival(), nightOn());
    if (nightOn()) drawNight(this, this.graph);
    if (new URLSearchParams(window.location.search).get('life') !== '0') {
      this.life = new TownLife(this, this.graph, {
        player: () => this.mySprite(),
        chasers: () => [this.mySprite(), ...(this.policeCar.visible ? [this.policeCar] : [])],
      });
    }
    this.routeOverlay = this.drawRoute();
    this.hideoutMark = new HideoutMarker(this, this.hideoutDoor());
    if (nightOn()) this.searchlight = new Searchlight(this);
    const vehicles = this.escape.scenario.vehicles;
    const look = currentLook();
    // The fugitive's own getaway car and outfit (the garage's Escape Mode choices).
    this.cars = vehicles.map((v) => (v ? createGetawayCar(this, v, look.GETAWAY) : null));
    this.runner = createSuspectRunner(this, look.FUGITIVE).setVisible(false);
    this.drift = new DriftEffects(this, { ids: ['getaway'], style: look.SMOKE });
    // A campaign officer drives their own vehicle and colours; a practice escape has the garage's choice.
    const colours = liveryLook(officer?.livery ?? look.LIVERY);
    this.policeCar = createPoliceCar(this, colours, officer?.vehicle ?? look.VEHICLE).setVisible(false);
    this.officer = createOfficer(this, colours, officer?.outfit ?? look.OUTFIT).setVisible(false);
    this.badge = createIntentBadge(this);
    this.roundabout = new RoundaboutGuide(this, this.graph, () =>
      this.hud.showToast('Roundabout: ◀ ▶ to choose the exit', 2600),
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
    this.hud = new Hud(this, officer ? officer.nickname.toUpperCase() : 'ESCAPE', 'POLICE', look.HUD);
    this.hud.onRepeat(() => this.repeat());
    this.hud.onMusic(() => this.toggleMusic());
    this.hud.setMusic(!this.music.isMuted);
    this.hud.onFacing(() => this.cycleFacing());
    this.hud.onPause(() => this.pause());
    this.hud.setFacing(loadFacing());

    const ui = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    ui.ignore(worldObjects);
    this.cameras.main.ignore([...this.hud.objects, ...this.controls.uiObjects]);
    // Rain or fog over the town (drawing only), under the HUD.
    this.cameras.main.ignore(drawWeather(this, weatherFor(this.seed), () => this.playerOnScreen()));
    this.policeMarker = createPoliceMarker(this);
    this.cameras.main.ignore(this.policeMarker);
    this.danger = new DangerPulse(this);
    this.cameras.main.ignore(this.danger.objects);

    this.bindKeys();
    this.syncDebug();
    const unsubscribe = debugState.onChange(() => this.syncDebug());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

    const scenario = this.escape.scenario;
    const destination = LOCATION_WORD_BY_ID.get(scenario.destination);
    debugState.info.set('seed', this.seed);
    debugState.info.set('difficulty', scenario.difficulty);
    debugState.info.set('mission', officer ? `ESCAPE ${officer.id}` : 'ESCAPE');
    debugState.info.set('destination', destination ? withArticle(destination) : scenario.destination);
    debugState.info.set('chase', scenario.chaseType);
    debugState.info.set('route', scenario.stages.map((st) => `${st.mode === 'CAR' ? 'car' : 'foot'} ${Math.round(st.length)} m`).join(' → '));
    debugState.info.set('audio', `${scannerAudio.clipCount} clips`);
    this.hud.update(this.escape.status, me.mode);
    this.opening();
  }

  /** Where the player is on screen, for the fog to stay clear around them. */
  private playerOnScreen(): { x: number; y: number } {
    const me = this.escape.player.snapshot();
    return onScreen(this.cameras.main, me.x, me.y);
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
    this.hud.showBanner('READY…');
    this.handleEvents(this.escape.openingCall());
    const minWait = new Promise<void>((resolve) => this.time.delayedCall(OPENING.minMs, () => resolve()));
    const maxWait = new Promise<void>((resolve) => this.time.delayedCall(OPENING.maxMs, () => resolve()));
    void Promise.race([Promise.all([this.speech, minWait]), maxWait]).then(() => {
      if (!this.scene.isActive() || this.stage !== 'OPENING') return;
      this.hud.showBanner('GO!');
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
          if (event.on) this.hud.showToast('Police in sight!');
          break;
        case 'WARNING':
          if (event.on) this.hud.showToast('The police are getting closer!');
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
    if (ids.includes(TRANSPORT_LINES.GET_OUT.audioId)) this.hud.showToast('⇄ (SPACE): get out of the car', 3500);
    if (ids.includes(TRANSPORT_LINES.GET_IN.audioId)) this.hud.showToast('⇄ (SPACE): get in the car', 3500);
  }

  private showTransmission(transmission: Transmission, before: SpokenLine[] = [], lead: SpokenText[] = [], tail: SpokenText[] = []): void {
    const difficulty = this.escape.scenario.difficulty;
    const clips = [...lead, ...transmission.instructions.flatMap((i) => i.clips), ...tail];
    const voiced = clips.every((c) => scannerAudio.has(c.audioId));
    const audioOnly = DIFFICULTY_SETTINGS[difficulty].textDisplay === 'AUDIO_ONLY' && voiced;
    const seconds = LANGUAGE_SETTINGS[difficulty].textSeconds + 2 * (clips.length - 1);
    this.hud.showScanner(clips.map((c) => c.text).join(' '), audioOnly ? 0 : seconds);
    this.orderToasts(lead);
    // A way back after a wrong turn replaces anything still queued on the radio (it is out of date now).
    const spoken = [...before, ...clips.map((c) => ({ audioId: c.audioId, radio: true }))];
    this.speech = transmission.urgent && lead.length === 0 ? scannerAudio.interrupt(spoken) : scannerAudio.play(spoken);
    const detail = [...lead.map((l) => l.audioId), ...transmission.instructions.map((i) => `${i.template} ${i.audioId}`), ...tail.map((l) => l.audioId)].join(' + ');
    debugState.info.set('scanner', `${transmission.kind}: ${detail}`);
  }

  /** ÉCHAP: everything freezes under the pause menu (the new police colours show from the next escape). */
  private pause(): void {
    if (this.stage === 'RESULTS' || !this.scene.isActive()) return;
    const data: PauseSceneData = {
      returnTo: this.scene.key,
      retry: () => this.scene.start(EscapeScene.KEY, { seed: this.seed, ...(this.officerId ? { officer: this.officerId } : {}) }),
      quit: () => this.scene.start(this.officerId ? 'Officers' : 'Title'),
      liveryChanged: () => this.redrawFugitive(),
    };
    this.scene.launch(PauseScene.KEY, data);
    this.scene.pause();
  }

  /** A new getaway car or outfit from the pause menu's garage: drawn again where they are. */
  private redrawFugitive(): void {
    const look = currentLook();
    const swap = (old: Phaser.GameObjects.Container, made: Phaser.GameObjects.Container) => {
      made.setPosition(old.x, old.y).setRotation(old.rotation).setVisible(old.visible).setAlpha(old.alpha);
      this.cameras.cameras.filter((c) => c !== this.cameras.main).forEach((c) => c.ignore(made));
      old.destroy();
      return made;
    };
    this.cars = this.cars.map((car, i) => {
      const vehicle = this.escape.scenario.vehicles[i];
      return car && vehicle ? swap(car, createGetawayCar(this, vehicle, look.GETAWAY)) : car;
    });
    this.runner = swap(this.runner, createSuspectRunner(this, look.FUGITIVE));
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
        if (!player.uTurn()) this.hud.showToast('No entry!');
        break;
      case 'TOGGLE_MODE': {
        const { result, events } = this.escape.toggleMode();
        if (!result.ok && result.reason !== 'NOT_HERE') this.hud.showToast('The car is too far away.');
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

    // The police: in view from far off (or always in debug mode), fading as they drop back out of
    // range, with the car left behind on foot; off the screen, a marker at its edge.
    const cop = this.escape.police.snapshot();
    this.policeHeading += Phaser.Math.Angle.Wrap(cop.heading - this.policeHeading) * Math.min(1, delta / 90);
    const inView = this.escape.policeInView;
    const visible = this.escape.policeOnMap && (debugState.isEnabled || inView || this.stage !== 'PURSUIT');
    const range = ESCAPE.showWithin[me.mode];
    const fade = this.stage === 'PURSUIT' ? Phaser.Math.Clamp((range - status.distance) / (range * ESCAPE_VIEW.fadeShare), 0.15, 1) : 1;
    const shown = this.policeSprite();
    const theirs = this.lanes.police.update(cop, traffic, delta);
    if (!this.staged) {
      shown.setPosition(cop.x + theirs.x, cop.y + theirs.y).setRotation(this.policeHeading);
      if (shown === this.officer) {
        this.policeStride += (delta / 1000) * cop.speed * 0.75;
        animateRunner(this.officer, this.policeStride, cop.speed > 1);
      }
      const alpha = shown.alpha + ((visible ? fade : 0) - shown.alpha) * Math.min(1, delta / 250);
      shown.setAlpha(alpha).setVisible(alpha > 0.02);
    }
    this.placeMarker(shown, this.stage === 'PURSUIT' && inView, status.distance, fade);
    if (shown === this.officer) this.placeParked(this.policeCar, visible ? this.escape.policeParked : null);
    else this.officer.setVisible(false);

    const framed = this.staged ? shown : null;
    this.rig.update(framed ? { x: (avatar.x + framed.x) / 2, y: (avatar.y + framed.y) / 2, heading: this.policeHeading } : me, delta);
    // The drama: red edges and a heartbeat with the police right behind; the hideout showing itself on the last stretch.
    const chasing = this.stage === 'PURSUIT';
    this.danger.update(chasing && this.escape.policeOnMap && status.proximity === 'CLOSE', status.captureProgress, delta);
    const lastStretch = this.escape.stage === this.escape.scenario.stages.length - 1;
    this.hideoutMark.update(chasing && lastStretch && distance(me, this.hideoutDoor()) <= ESCAPE_FX.hideout.revealWithin, this.cameras.main.zoom, delta);
    this.searchlight?.update(me, delta);
    this.scaleLabels();
    this.keepUpright();
  }

  /**
   * The police marker: hidden while the police are on the screen; otherwise at
   * the edge of the screen in their direction, with how far back they are, so
   * the player watches the gap grow (or shrink after a mistake).
   */
  private placeMarker(police: Phaser.GameObjects.Container, inView: boolean, metres: number, fade: number): void {
    const marker = this.policeMarker;
    const { width, height } = this.scale;
    const at = onScreen(this.cameras.main, police.x, police.y);
    const inset = ESCAPE_VIEW.markerInset;
    const onTheScreen = at.x > inset.side && at.x < width - inset.side && at.y > inset.top && at.y < height - inset.bottom;
    if (!inView || onTheScreen) {
      marker.setVisible(false);
      return;
    }
    // From the middle of the screen towards the police, stopped at the edge of the safe area.
    const from = { x: width / 2, y: (inset.top + height - inset.bottom) / 2 };
    const dx = at.x - from.x;
    const dy = at.y - from.y;
    const sx = dx > 0 ? (width - inset.side - from.x) / dx : dx < 0 ? (inset.side - from.x) / dx : Infinity;
    const sy = dy > 0 ? (height - inset.bottom - from.y) / dy : dy < 0 ? (inset.top - from.y) / dy : Infinity;
    const k = Math.max(0, Math.min(sx, sy, 1));
    marker.setPosition(from.x + dx * k, from.y + dy * k).setVisible(true).setAlpha(Math.max(0.45, fade));
    const [arrow, , label] = marker.list as [Phaser.GameObjects.Triangle, Phaser.GameObjects.Arc, Phaser.GameObjects.Text];
    arrow.setRotation(Math.atan2(dy, dx) + Math.PI / 2);
    label.setText(`${Math.round(metres / 10) * 10} m`);
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
    this.hud.showBanner(mode === 'FOOT' ? 'ON FOOT!' : 'IN THE CAR!');
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

  /** Where the hideout's door is: the end of the last stretch of the route. */
  private hideoutDoor(): { x: number; y: number } {
    const stages = this.escape.scenario.stages;
    const last = stages[stages.length - 1]!;
    return this.graph.node(last.route[last.route.length - 1]!);
  }

  /** Safe: "Bravo ! Vous avez semé la police !" The fugitive slips in at the door as it lights up. */
  private hideout(): void {
    this.hideoutMark.celebrate();
    this.tweens.add({ targets: this.mySprite(), alpha: 0, delay: 250, duration: 650 });
    this.showResults(scannerAudio.play([{ audioId: ESCAPE_LINES.WON.audioId, radio: true }]), 'You lost the police!');
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
      this.showResults(said(), 'Roadblocks up: you are under arrest!');
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
      if (this.scene.isActive()) this.showResults(said(), 'You are under arrest!');
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
      ...(this.officerId ? { officer: this.officerId } : {}),
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
    // P pauses too: Firefox and Safari keep ÉCHAP for leaving full screen (see FullscreenScene).
    keyboard.on('keydown-P', () => this.pause());
    // Leaving full screen mid-chase (ÉCHAP in Firefox or Safari) pauses rather than carrying on unseen.
    const leftFullscreen = () => this.pause();
    this.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, leftFullscreen);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.LEAVE_FULLSCREEN, leftFullscreen));
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
      this.hud.showToast('No repeats left!');
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
    this.hideoutMark.setUpright(upright);
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

/** How the far-off police are shown (screen pixels and shares; drawing only). */
const ESCAPE_VIEW = {
  /** The police fade over the last share of the distance they can be seen from. */
  fadeShare: 0.25,
  /** The marker stays this far inside the screen edges (clear of the HUD panels). */
  markerInset: { side: 60, top: 120, bottom: 110 },
} as const;

/** A round flashing police marker with an arrow pointing at the police and the distance under it. */
function createPoliceMarker(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const arrow = scene.add.triangle(0, 0, 0, -38, -11, -22, 11, -22, 0xffffff).setStrokeStyle(2, 0x10202a);
  const disc = scene.add.circle(0, 0, 20, 0xd62828).setStrokeStyle(3, 0xffffff);
  const label = scene.add
    .text(0, 30, '', { fontFamily: FONT_FAMILY, fontSize: '16px', fontStyle: 'bold', color: '#ffffff', backgroundColor: 'rgba(16, 32, 42, 0.8)', padding: { x: 6, y: 2 } })
    .setOrigin(0.5, 0);
  const icon = scene.add.text(0, 0, '🚓', { fontSize: '20px' }).setOrigin(0.5);
  const marker = scene.add.container(0, 0, [arrow, disc, label, icon]).setDepth(140).setScrollFactor(0).setVisible(false);
  // Red and blue, like the light bar.
  scene.time.addEvent({ delay: 260, loop: true, callback: () => disc.setFillStyle(disc.fillColor === 0xd62828 ? 0x1f5bd6 : 0xd62828) });
  return marker;
}
