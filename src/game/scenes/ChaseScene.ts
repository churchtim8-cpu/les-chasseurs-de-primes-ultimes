import Phaser from 'phaser';
import { BELLEVUE } from '../../content/map/bellevue';
import { audioCheck } from '../../engine/audio/manifest';
import { EVENT_LINES, OUTCOME_LINES, REPEAT_LINES, TRANSPORT_LINES } from '../../engine/audio/script';
import { DIFFICULTY_SETTINGS } from '../../engine/difficulty';
import { Chase, pointOf, type ChaseEvent, type SpokenText } from '../../engine/chase/chase';
import { generateScenario } from '../../engine/chase/scenario';
import { DODGE, SIGHTING } from '../../engine/chase/settings';
import { MOVEMENT } from '../../engine/movement/settings';
import { MISSION_COUNT } from '../../engine/campaign/campaign';
import type { MissionStats } from '../../engine/campaign/scoring';
import type { SightingCard } from '../../engine/chase/sightings';
import type { Transmission } from '../../engine/language/navigator';
import { LANGUAGE_SETTINGS } from '../../engine/language/settings';
import { LOCATION_WORD_BY_ID, withArticle } from '../../engine/language/locations';
import type { MoverStart } from '../../engine/movement/mover';
import { TownGraph, type TravelMode } from '../../engine/world/graph';
import { HALF_WIDTH, PAVEMENT } from '../../engine/world/geometry';
import { actionSounds } from '../audio/ActionSounds';
import { ChaseMusic } from '../audio/ChaseMusic';
import { DrivingSounds } from '../audio/DrivingSounds';
import { FootSounds } from '../audio/FootSounds';
import { menuMusic } from '../audio/Jingles';
import { scenarioOptionsFromAddress } from '../scenarioOptions';
import { loadProfile } from '../profileStore';
import { BOSS, bossInfo, suspectPaceFor, type BossInfo } from '../../engine/campaign/profile';
import { nearestLocation } from '../../engine/language/analysis';
import type { ResultsData } from './ResultsScene';
import { PauseScene, type PauseSceneData } from './PauseScene';
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
import { BURNOUT_SMOKE, DriftEffects } from '../render/drift';
import { ColleagueArrival } from '../render/colleague';
import { arrestEffect, victoryPose } from '../render/celebrate';
import { currentLook } from '../lookStore';
import { liveryLook, type CosmeticSlot } from '../../engine/campaign/cosmetics';
import { drawNight, nightOn } from '../render/night';
import { LanePosition } from '../render/lanes';
import { EscapeEffects } from '../render/escapes';
import { RoundaboutGuide } from '../render/roundaboutGuide';
import { preloadCanvaArt } from '../render/canvaArt';
import { drawTown, type TownLayers } from '../render/townRenderer';
import { TownLife } from '../render/townLife';

export interface ChaseSceneData {
  seed: string;
  /** Campaign mission (0-based); absent for a practice chase. */
  mission?: number;
  /** The secret ninth suspect: the longest kind of chase, with extra time. */
  /** A hidden boss's picture id instead of a campaign mission. */
  boss?: string;
}

type Stage = 'OPENING' | 'PURSUIT' | 'ARREST' | 'RESULTS';

/** When the results screen opens after "Le suspect est arrêté" / "s'est échappé" (ms). */
const RESULTS_DELAY = { minMs: 1800, afterLineMs: 600, maxMs: 9000 } as const;
/**
 * The chase begins only once the opening call has been heard in full
 * (Mr Henry, 2026-10-03): never sooner than minMs after the scene opens
 * (time to read it when there is no sound), never later than maxMs.
 */
const OPENING = { minMs: 2500, maxMs: 14_000, goBannerMs: 900 } as const;
/**
 * "GO !" in the car: a burnout. The car sits spinning its wheels in a cloud of
 * tyre smoke for `holdMs`, then takes off, still smoking, until `ms` is up.
 */
const BURNOUT = { holdMs: 700, ms: 1800 } as const;
/** The suspect's run up to its getaway car takes this share of the change of transport; then it gets in. */
const BOARDING = { runShare: 0.55, getInShare: 0.25, doorMetres: 2.4 } as const;

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
  /** Where across the road the police and the suspect are drawn: their lane, or the pavement on foot. */
  private lanes!: { me: LanePosition; suspect: LanePosition };
  /** The suspect's vehicle in each stage (null on foot). */
  private suspectCars: (Phaser.GameObjects.Container | null)[] = [];
  private suspectRunner!: Phaser.GameObjects.Container;
  private abandonedCar!: Phaser.GameObjects.Container;
  private escapes!: EscapeEffects;
  /** Stages whose car the suspect crashed: the wreck stays where it came to rest. */
  private wrecked = new Set<number>();
  /** How many times the suspect has pulled away: the calls alternate so they never sound canned. */
  private warnings = 0;
  /** The police car is skidding to a stop (held after a crash or U-turn). */
  private policeSkid = false;
  private routeOverlay!: Phaser.GameObjects.Graphics;
  private badge!: ReturnType<typeof createIntentBadge>;
  private roundabout!: RoundaboutGuide;
  /** The sighting call being answered, for R (repeat) while the question is open. */
  private sightingLine: SpokenText | null = null;
  private cameraMode: TravelMode = 'CAR';
  private displayHeading = 0;
  private suspectHeading = 0;
  private stage: Stage = 'OPENING';
  /** The call being spoken (resolves when it has been heard). */
  private speech: Promise<void> = Promise.resolve();
  /** The burnout at "GO !" lasts until this scene time; the car only moves off from `launchAt`. */
  private burnoutUntil = 0;
  /** The colleague bringing the police car, while it drives up (see colleagueDrivesUp). */
  private arrival: ColleagueArrival | null = null;
  /** What the garage dressed the player's police in (see lookStore). */
  private look!: Record<CosmeticSlot, string>;
  /** The officer is posing after the arrest (shown even after a car arrest). */
  private celebrating = false;
  /** The camera that draws only the HUD (world objects made later must be hidden from it). */
  private uiCamera: Phaser.Cameras.Scene2D.Camera | null = null;
  private launchAt = 0;
  private burning = false;
  private seed = '';
  private mission: number | null = null;
  private boss: BossInfo | null = null;

  constructor() {
    super(ChaseScene.KEY);
  }

  init(data: ChaseSceneData): void {
    this.seed = data.seed;
    this.mission = typeof data.mission === 'number' ? data.mission : null;
    this.boss = data.boss ? bossInfo(data.boss) ?? BOSS : null;
    this.stage = 'OPENING';
    this.burnoutUntil = 0;
    this.arrival = null;
    this.celebrating = false;
    this.launchAt = 0;
    this.burning = false;
    this.staged = false;
    this.wrecked = new Set();
    this.warnings = 0;
    this.policeSkid = false;
  }

  preload(): void {
    preloadCanvaArt(this);
  }

  create(): void {
    this.graph = new TownGraph(BELLEVUE);
    this.lanes = { me: new LanePosition(this.graph), suspect: new LanePosition(this.graph) };
    const options = this.boss ? { ...scenarioOptionsFromAddress(), chaseType: this.boss.chaseType } : scenarioOptionsFromAddress();
    this.chase = new Chase(this.graph, generateScenario(this.graph, this.seed, options), {
      hasAudio: audioCheck(scannerAudio.library),
      // Suspects move a touch faster at each police rank the player has earned.
      suspectPace: suspectPaceFor(loadProfile().points),
      ...(this.boss ? { extraSeconds: this.boss.extraSeconds } : {}),
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
    if (nightOn()) drawNight(this, this.graph);
    if (new URLSearchParams(window.location.search).get('life') !== '0') {
      this.life = new TownLife(this, this.graph, {
        player: () => (this.chase.player.mode === 'CAR' ? this.car : this.officer),
        chasers: () => {
          const theirs = this.suspectSprite();
          return [
            ...(this.chase.player.mode === 'CAR' ? [this.car] : []),
            ...(theirs !== this.suspectRunner && theirs.alpha > 0.5 ? [theirs] : []),
          ];
        },
      });
    }
    this.routeOverlay = this.drawRoute();
    // A suspect only ever leaves its first car behind (a later car stage is the last).
    const vehicles = this.chase.scenario.vehicles;
    this.abandonedCar = createSuspectCar(this, vehicles.find((v) => v !== null) ?? 'BLUE').setVisible(false);
    this.suspectCars = vehicles.map((v) => (v ? createSuspectCar(this, v).setAlpha(0) : null));
    this.suspectRunner = createSuspectRunner(this).setAlpha(0);
    this.trail = this.add.graphics().setDepth(28);
    const look = currentLook();
    this.look = look;
    this.drift = new DriftEffects(this, { ids: ['player', 'police'], style: look.SMOKE });
    this.escapes = new EscapeEffects(this, this.drift);
    const colours = liveryLook(look.LIVERY);
    this.car = createPoliceCar(this, colours, look.VEHICLE);
    this.officer = createOfficer(this, colours, look.OUTFIT).setVisible(false);
    this.badge = createIntentBadge(this);
    this.roundabout = new RoundaboutGuide(this, this.graph, () =>
      this.hud.showToast('Roundabout: ◀ ▶ to choose the exit', 2600),
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
    this.hud = new Hud(this, this.boss ? this.boss.nickname.toUpperCase() : this.mission === null ? 'PRACTICE' : `MISSION ${this.mission + 1} / ${MISSION_COUNT}`, 'SIGNAL', look.HUD);
    this.hud.onRepeat(() => this.repeat());
    this.hud.onMusic(() => this.toggleMusic());
    this.hud.setMusic(!this.music.isMuted);
    this.hud.onFacing(() => this.cycleFacing());
    this.hud.setFacing(loadFacing());

    const ui = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    ui.ignore(worldObjects);
    this.uiCamera = ui;
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
    this.opening();
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    if (this.stage === 'PURSUIT' && this.time.now >= this.launchAt) {
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

  /**
   * The dispatcher's opening call is heard in full before anything moves,
   * then "GO !" and the chase begins (in the car with a burnout).
   */
  private opening(): void {
    this.hud.showBanner('READY…');
    this.handleEvents(this.chase.openingCall());
    const minWait = new Promise<void>((resolve) => this.time.delayedCall(OPENING.minMs, () => resolve()));
    const maxWait = new Promise<void>((resolve) => this.time.delayedCall(OPENING.maxMs, () => resolve()));
    void Promise.race([Promise.all([this.speech, minWait]), maxWait]).then(() => {
      if (!this.scene.isActive() || this.stage !== 'OPENING') return;
      this.hud.showBanner('GO!');
      this.stage = 'PURSUIT';
      if (this.chase.player.mode === 'CAR') {
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
          if (event.on) this.hud.showToast('Suspect in sight!');
          break;
        case 'WARNING':
          if (event.on) {
            this.hud.showToast('The suspect is getting away!');
            // Only when the radio is free: a "Vite !" never holds up a direction.
            if (event.speak) {
              const call = this.warnings++ % 2 === 0 ? OUTCOME_LINES.WARNING : OUTCOME_LINES.HURRY;
              void scannerAudio.play([{ audioId: call.audioId, radio: true }]);
            }
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
          if (!joined) this.announce(event.lines, event.interrupt);
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
              ? `Well done! (+${SIGHTING.bonusSeconds} s)`
              : event.chosen === null
                ? `Too late! (−${SIGHTING.penaltySeconds} s)`
                : `That is not the suspect. (−${SIGHTING.penaltySeconds} s)`,
          );
          break;
        case 'SIGNAL':
          this.hud.showToast(event.lost ? 'SIGNAL LOST' : 'SIGNAL BACK', 2000);
          break;
        case 'SUSPECT_MODE':
          break;
        case 'SUSPECT_CRASH':
          this.crashSuspectCar();
          break;
        case 'SUSPECT_DODGE':
          this.escapes.dodge(event.mode, DODGE.downSeconds[event.mode], this.officer);
          break;
      }
    }
  }

  /**
   * Events and orders ("Il est à pied !", "Descendez de la voiture !"). Shown
   * as text unless every line is recorded and the level is audio only; an
   * order also shows which button to press.
   */
  private announce(lines: SpokenText[], interrupt = false): void {
    const difficulty = this.chase.scenario.difficulty;
    const text = lines.map((l) => l.text).join(' ');
    this.hud.showScanner(text, this.showsText(lines) ? Math.max(LANGUAGE_SETTINGS[difficulty].textSeconds, 4) : 0);
    const spoken = lines.map((l) => ({ audioId: l.audioId, radio: true }));
    void (interrupt ? scannerAudio.interrupt(spoken) : scannerAudio.play(spoken));
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
    if (ids.includes(TRANSPORT_LINES.GET_OUT.audioId)) this.hud.showToast('⇄ (SPACE): get out of the car', 3500);
    if (ids.includes(TRANSPORT_LINES.GET_IN.audioId)) this.hud.showToast('⇄ (SPACE): get in the car', 3500);
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
    this.speech = scannerAudio.play([...before, ...clips.map((c) => ({ audioId: c.audioId, radio: true }))]);
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
        if (!player.uTurn()) this.hud.showToast('No entry!');
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
    if (!result.ok && result.reason !== 'NOT_HERE') this.hud.showToast('The car is too far away.');
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
    const traffic = this.life?.cars() ?? [];
    const mine = this.lanes.me.update(me, traffic, delta);
    const suspectNow = this.chase.suspect.snapshot();
    const spinningCar = this.escapes.spinning ? this.suspectCars[this.chase.suspectStage] ?? null : null;
    const tumble = this.escapes.update(delta, spinningCar, this.officer);
    const drift = this.drift.update(
      { x: me.x + mine.x, y: me.y + mine.y, heading: me.heading, speed: me.speed, driving: me.mode === 'CAR' && this.stage === 'PURSUIT' },
      this.displayHeading,
      delta,
    );
    if (!this.staged) {
      avatar.setPosition(me.x + mine.x + drift.dx, me.y + mine.y + drift.dy).setRotation(this.displayHeading + drift.swing);
      // About three strides a second at running speed.
      this.stride += (delta / 1000) * me.speed * 0.75;
      if (me.mode === 'FOOT') {
        animateRunner(this.officer, this.stride, me.speed > 1 && tumble === 0);
        // Knocked over by the suspect turning round: sprawled across the way, seeing stars.
        if (tumble > 0) this.officer.setRotation(this.displayHeading + tumble);
      }
      this.skidToStop(me);
      this.burnout(me, delta);
    }
    if (!this.celebrating) this.officer.setVisible(me.mode === 'FOOT');
    this.drawTrail({ ...me, x: me.x + mine.x, y: me.y + mine.y });
    this.driving.update({ driving: me.mode === 'CAR' && this.stage === 'PURSUIT', speed: me.speed, heading: me.heading }, delta);
    this.footsteps.update({ running: me.mode === 'FOOT' && this.stage === 'PURSUIT', speed: me.speed, stride: this.stride }, delta);
    this.placeParked(this.car, me.mode === 'CAR' ? null : this.chase.parkedCar, me.mode === 'CAR');
    this.colleagueDrivesUp(me.mode, delta);
    // After a crash the wreck stands for the abandoned car (and any car left earlier stays where it is).
    if (this.wrecked.size === 0) this.placeParked(this.abandonedCar, this.chase.abandonedCar, false);
    // Above the player on screen, whichever way the map is turned.
    const lift = me.mode === 'CAR' ? 16 : 10;
    const turned = this.rig.rotation;
    this.badge.container.setPosition(me.x + mine.x - lift * Math.sin(turned), me.y + mine.y - lift * Math.cos(turned));
    this.badge.show(this.stage === 'PURSUIT' ? me.queued : null, this.displayHeading);
    const status = this.chase.status;
    this.music.setIntensity(status.signal);
    this.roundabout.update(this.chase.player, this.stage === 'PURSUIT' && !status.followingTracks);

    const suspect = suspectNow;
    // A car spinning round turns visibly; otherwise the heading eases round quickly.
    const ease = this.escapes.spinning ? 320 : 90;
    this.suspectHeading += Phaser.Math.Angle.Wrap(suspect.heading - this.suspectHeading) * Math.min(1, delta / ease);
    // The suspect is only on the map when close (a sighting), just after an escape, or at the end; debug always shows it.
    const visible = debugState.isEnabled || this.chase.status.suspectVisible || this.escapes.revealing || this.stage === 'RESULTS';
    const shown = this.suspectSprite();
    const stage = this.chase.suspectStage;
    const stages = this.chase.scenario.stages;
    // A getaway car waits parked where its stage starts until the suspect runs up and gets in.
    this.suspectCars.forEach((sprite, i) => {
      if (!sprite || sprite === shown || this.wrecked.has(i)) return;
      if (i > stage && stages[i - 1]?.mode === 'FOOT') {
        this.placeParked(sprite, this.chase.stageStart(i), false);
        sprite.setAlpha(1);
      } else sprite.setAlpha(0);
    });
    if (shown !== this.suspectRunner) this.suspectRunner.setAlpha(0);
    const theirs = this.lanes.suspect.update(suspect, traffic, delta);
    if (!this.staged) {
      shown.setPosition(suspect.x + theirs.x, suspect.y + theirs.y).setRotation(this.suspectHeading);
      let inCar = 0;
      if (shown === this.suspectRunner) {
        const boarding = this.boarding(shown);
        inCar = boarding?.inCar ?? 0;
        this.suspectStride += (delta / 1000) * (boarding ? boarding.speed : suspect.speed) * 0.75;
        animateRunner(this.suspectRunner, this.suspectStride, (boarding ? boarding.speed : suspect.speed) > 1);
      }
      const alpha = shown.alpha + ((visible && inCar < 1 ? 1 - inCar : 0) - shown.alpha) * Math.min(1, delta / 250);
      shown.setAlpha(alpha);
    }

    // During the arrest the camera frames both of them.
    const framed = this.staged ? this.suspectSprite() : null;
    this.rig.update(framed ? { x: (avatar.x + framed.x) / 2, y: (avatar.y + framed.y) / 2, heading: this.suspectHeading } : me, delta);
    this.scaleLabels();
    this.keepUpright();
  }

  /**
   * The suspect changing into a car: runs the last metres up to the getaway
   * car, opens the door and gets in (the runner fades as it does); the car
   * then pulls away when its stage starts. Moves the runner and returns how
   * far it is into the car (0 to 1) and how fast it is drawn running.
   */
  private boarding(runner: Phaser.GameObjects.Container): { inCar: number; speed: number } | null {
    const transfer = this.chase.transfer;
    if (!transfer || transfer.to !== 'CAR') return null;
    const car = this.suspectCars[this.chase.suspectStage + 1];
    if (!car) return null;
    const run = Phaser.Math.Clamp(transfer.progress / BOARDING.runShare, 0, 1);
    const inCar = Phaser.Math.Clamp((transfer.progress - BOARDING.runShare) / BOARDING.getInShare, 0, 1);
    // The driver's door is on the car's left.
    const door = { x: car.x + Math.sin(car.rotation) * BOARDING.doorMetres, y: car.y - Math.cos(car.rotation) * BOARDING.doorMetres };
    const eased = 1 - (1 - run) * (1 - run);
    const from = { x: runner.x, y: runner.y };
    runner.setPosition(from.x + (door.x - from.x) * eased, from.y + (door.y - from.y) * eased);
    if (run < 1) runner.setRotation(Math.atan2(door.y - from.y, door.x - from.x));
    else runner.setRotation(car.rotation);
    return { inCar, speed: run < 1 ? MOVEMENT.FOOT.cruise : 0 };
  }

  /** "GO !" in the car: skid marks and tyre smoke pour off the rear wheels as it takes off. */
  private burnout(me: { x: number; y: number; mode: TravelMode }, delta: number): void {
    const burning = me.mode === 'CAR' && this.stage === 'PURSUIT' && this.time.now < this.burnoutUntil;
    if (burning) this.drift.tyres('police', this.car.x, this.car.y, this.car.rotation, 1, delta / 1000, BURNOUT_SMOKE);
    else if (this.burning) this.drift.lift('police');
    this.burning = burning;
  }

  /** The suspect as drawn now: their car, or on foot (out of a crashed car too). */
  private suspectSprite(): Phaser.GameObjects.Container {
    const stage = this.chase.suspectStage;
    return (this.wrecked.has(stage) ? null : this.suspectCars[stage]) ?? this.suspectRunner;
  }

  /**
   * The suspect crashes: the car they were driving slides into the kerb and
   * stays there as a steaming wreck while they run off.
   */
  private crashSuspectCar(): void {
    // Just before the arrest the suspect is already on foot; at a planned change of transport, still in the car.
    const stage = this.chase.suspect.mode === 'CAR' ? this.chase.suspectStage : this.chase.suspectStage - 1;
    const car = this.suspectCars[stage];
    if (!car || this.wrecked.has(stage)) return;
    this.wrecked.add(stage);
    const at = this.chase.suspect.location();
    const p = pointOf(this.graph, at);
    const edge = this.graph.edge(at.edgeId);
    const from = this.graph.node(this.graph.other(edge, at.towards));
    const to = this.graph.node(at.towards);
    const heading = Math.atan2(to.y - from.y, to.x - from.x);
    // Up on the pavement on its right, out of the police car's way.
    const kerb = edge.car ? HALF_WIDTH[edge.kind] + PAVEMENT / 2 : 0;
    this.escapes.crash(car, { x: p.x - Math.sin(heading) * kerb, y: p.y + Math.cos(heading) * kerb, rotation: heading });
  }

  /** Held still after a crash or a U-turn, the police car skids to a stop with a screech. */
  private skidToStop(me: { x: number; y: number; speed: number; mode: TravelMode }): void {
    const skidding = me.mode === 'CAR' && this.stage === 'PURSUIT' && this.chase.player.speedFactor === 0 && me.speed > 12;
    if (skidding && !this.policeSkid) actionSounds.screech(Math.min(1.2, me.speed / 70), 0.22);
    if (skidding) this.drift.tyres('police', this.car.x, this.car.y, this.car.rotation, 0.8, this.game.loop.delta / 1000);
    else if (this.policeSkid) this.drift.lift('police');
    this.policeSkid = skidding;
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
    this.hud.showBanner(mode === 'FOOT' ? 'ON FOOT!' : 'IN THE CAR!');
    this.time.delayedCall(1100, () => this.stage === 'PURSUIT' && this.hud.showBanner(''));
    this.cameras.main.flash(180, 255, 255, 255, false);
  }

  /** V or the CARTE button: map turns on foot, always, or never (remembered on this device). */
  private cycleFacing(): void {
    const facing = nextFacing();
    this.rig.setFacing(facing);
    this.hud.setFacing(facing);
  }

  private toggleMusic(): void {
    const muted = this.music.toggleMute();
    this.hud.setMusic(!muted);
  }

  /**
   * When the suspect jumps into a car, a colleague races the police car up the
   * road and screeches to a halt beside the officer ("Montez dans la voiture !"),
   * instead of the car simply appearing where it parks.
   */
  private colleagueDrivesUp(mode: TravelMode, delta: number): void {
    const parked = mode === 'FOOT' && this.chase.colleagueCar ? this.chase.parkedCar : null;
    if (!parked) {
      if (this.arrival) this.drift.lift('colleague');
      this.arrival = null;
      return;
    }
    if (this.arrival?.parked !== parked) this.arrival = new ColleagueArrival(this.graph, parked);
    if (this.arrival.done) return;
    const at = this.arrival.update(delta);
    this.car.setVisible(true).setPosition(at.x, at.y).setRotation(at.rotation);
    if (at.screech) actionSounds.screech(1.1, 0.22);
    if (at.braking) this.drift.tyres('colleague', at.x, at.y, at.rotation, 0.9, delta / 1000);
    else this.drift.lift('colleague');
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
    this.hud.showBanner(captured ? 'Suspect arrested!' : 'The suspect got away.');
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
    const scenario = this.chase.scenario;
    const data: ResultsData = {
      seed: this.seed,
      mission: this.mission,
      boss: this.boss?.picture ?? null,
      stats,
      timeLimit: this.chase.timeLimit,
      night: nightOn(),
      mode: this.chase.player.mode,
      lastSeen: nearestLocation(this.graph, this.chase.suspect.snapshot())?.id ?? scenario.destination,
      vehicle: scenario.vehicles[0] ?? null,
      chaseType: scenario.chaseType,
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
    const sprite = this.suspectSprite();
    const suspectCar = sprite === this.suspectRunner ? null : sprite;
    this.rig.closeUp();
    void playArrest(this, this.drift, {
      police: me.mode === 'CAR' ? this.car : this.officer,
      suspect: suspectCar ?? this.suspectRunner,
      policeHeading: this.displayHeading,
      suspectHeading: this.suspectHeading,
      suspectSpeed: this.chase.suspect.snapshot().speed,
      kind: arrestKind(me.mode, suspectCar !== null),
    }).then(() => {
      if (!this.scene.isActive()) return;
      this.celebrate(me.mode, suspectCar ?? this.suspectRunner);
      this.showResults(scannerAudio.play([{ audioId: OUTCOME_LINES.CAPTURED.audioId, radio: true }]));
    });
  }

  /**
   * The garage's arrest effect over the suspect, and the officer's victory
   * pose (stepping out beside the car first when the arrest was made driving).
   */
  private celebrate(mode: TravelMode, suspect: Phaser.GameObjects.Container): void {
    this.celebrating = true;
    if (mode === 'CAR') {
      const side = this.car.rotation + Math.PI / 2;
      this.officer.setPosition(this.car.x + Math.cos(side) * 9, this.car.y + Math.sin(side) * 9).setRotation(this.car.rotation);
    }
    this.officer.setVisible(true);
    victoryPose(this, this.officer, this.look.POSE);
    arrestEffect(this, this.look.ARREST, { x: suspect.x, y: suspect.y }, (o) => this.cameras.main.ignore(o), (o) => this.uiCamera?.ignore(o));
  }

  /** ÉCHAP: everything freezes under the pause menu (see PauseScene). */
  private pause(): void {
    if (this.stage === 'RESULTS' || !this.scene.isActive()) return;
    const data: PauseSceneData = {
      returnTo: this.scene.key,
      retry: () => this.scene.start(ChaseScene.KEY, { seed: this.seed, ...(this.mission !== null ? { mission: this.mission } : {}), ...(this.boss ? { boss: this.boss.picture } : {}) }),
      quit: () => this.scene.start(this.mission === null ? 'Title' : 'Campaign'),
      liveryChanged: () => this.redrawPolice(),
    };
    this.scene.launch(PauseScene.KEY, data);
    this.scene.pause();
  }

  /** New police colours from the pause menu: the car and officer are drawn again where they are. */
  private redrawPolice(): void {
    const look = currentLook();
    this.look = look;
    const colours = liveryLook(look.LIVERY);
    const swap = (old: Phaser.GameObjects.Container, made: Phaser.GameObjects.Container) => {
      made.setPosition(old.x, old.y).setRotation(old.rotation).setVisible(old.visible).setAlpha(old.alpha);
      this.uiCamera?.ignore(made);
      old.destroy();
      return made;
    };
    this.car = swap(this.car, createPoliceCar(this, colours, look.VEHICLE));
    this.officer = swap(this.officer, createOfficer(this, colours, look.OUTFIT));
  }

  private nextChase(): void {
    this.scene.start('Practice', { autostart: true });
  }

  private bindKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.on('keydown-ESC', () => this.pause());
    // TAB hides or shows the HUD (the browser would otherwise move the focus).
    keyboard.addCapture('TAB');
    keyboard.on('keydown-TAB', () => this.hud.toggle());
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
      this.hud.showToast('No signal!');
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
      this.hud.showToast('No repeats left!');
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

/** The facing after the current one, chosen and remembered on this device. */
export function nextFacing(): MapFacing {
  const facing = MAP_FACINGS[(MAP_FACINGS.indexOf(loadFacing()) + 1) % MAP_FACINGS.length] as MapFacing;
  try {
    window.localStorage.setItem(FACING_KEY, facing);
  } catch {
    // storage unavailable: the choice lasts for this visit only
  }
  chosenFacing = facing;
  return facing;
}

/** The map facing: the player's latest choice, else `?facing=north` (or foot, always), else remembered. */
export function loadFacing(): MapFacing {
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
