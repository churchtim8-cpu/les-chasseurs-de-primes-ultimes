/**
 * The running chase: moves the suspect along its route, measures the road
 * distance to the player, and decides capture and escape.
 *
 * Changes of direction: at higher levels the scanner first guides the player
 * along the route it predicts; when the suspect turns off it, the scanner
 * says "Attention ! Le suspect a changé de direction." and gives corrected
 * directions from where the player is (template X3).
 *
 * Changes of transport: when the suspect reaches the end of a stage it gets
 * out of (or into) a car and carries on. The scanner says so; the player is
 * told "Descendez de la voiture !" on reaching that spot, or "Montez dans la
 * voiture !" when a colleague brings the police car. Once the player is in the
 * suspect's new mode, directions start again for the new stage.
 *
 *   correct navigation → the player (faster than the suspect) closes in
 *   wrong turn or hesitation → the suspect gains road distance
 *   recovery → the gap closes again
 *   out of time → escape (warnings first when the suspect is far away)
 *   close enough for long enough → capture (no need to ram the suspect)
 *
 * Sightings: as the suspect passes a planned place, the scanner reports it
 * ("La voiture verte est près de la bibliothèque.") and the chase pauses
 * while the player picks the matching suspect. The right choice adds time
 * and shows the suspect on the map for a moment; a wrong one costs time.
 *
 * Last-second escapes (NEAR_CAPTURE): at most once a chase, just as the
 * arrest is about to happen, the suspect crashes and runs on foot (a new
 * stage, planned from where it crashed) or turns round (a new route; the
 * scanner corrects itself with "Faites demi-tour."). The routes come from the
 * seed and the crash point, and pass the same checks as the planned ones.
 *
 * Lost signal (Expert): right after a call with several turns, "Nous avons
 * perdu le signal." The scanner goes quiet and the suspect is hidden until the
 * player has used those directions (or goes wrong, or a time limit); then
 * directions resume, with the usual correction if the player went wrong.
 */

import { EVENT_LINES, TRANSPORT_LINES } from '../audio/script';
import { sightingLine, vehicleLine } from '../language/sightings';
import type { SightingCard } from './sightings';
import { DIFFICULTY_SETTINGS } from '../difficulty';
import { describable, type AudioCheck } from '../language/generate';
import { Navigator, planGuide, type Transmission } from '../language/navigator';
import { Mover, type MoverStart } from '../movement/mover';
import { BOARDING_DISTANCE, MOVEMENT } from '../movement/settings';
import { Rng } from '../rng/prng';
import { distance, lerp, type Point } from '../world/geometry';
import { canTravel, type TownGraph, type TravelMode } from '../world/graph';
import { roadDistance } from './distance';
import { followProblem, generateRoute, placeOnRoute, turnsOftenEnough } from './route';
import type { ChaseScenario, ChaseStage, NearCapture } from './scenario';
import { RepeatCounter, type RepeatResult } from '../audio/repeat';
import {
  CALL_TIMING,
  CHASE_SETTINGS,
  CRASH,
  DODGE,
  LOST_SIGNAL,
  NEAR_CAPTURE_MIN_SECONDS,
  SIGHTING,
  TRANSFER,
  TURN_OFF,
  type ChaseSettings,
  type Vehicle,
} from './settings';
import { isDecision, scanAhead } from '../language/analysis';

/** A fixed scanner line (not a route instruction): an event or an order. */
export interface SpokenText {
  audioId: string;
  text: string;
}

export type ModeChangeResult = { ok: true } | { ok: false; reason: 'NO_CAR' | 'TOO_FAR' | 'NOT_HERE' };

export type ChasePhase = 'PURSUIT' | 'CAPTURED' | 'ESCAPED';
export type Proximity = 'CLOSE' | 'NEAR' | 'FAR' | 'LOSING';
/** The suspect only ever escapes when the clock runs out. */
export type EscapeReason = 'TIME';

export type ChaseEvent =
  | { type: 'CAPTURED' }
  | { type: 'ESCAPED'; reason: EscapeReason }
  | { type: 'WARNING'; on: boolean }
  | { type: 'SIGHTED'; on: boolean }
  | { type: 'SUSPECT_ARRIVED' }
  /** The police scanner speaks (directions, corrections). */
  | { type: 'TRANSMISSION'; transmission: Transmission }
  /**
   * The scanner announces an event or gives an order, such as "Il est à pied !".
   * `after`: spoken straight after the call just before it ("Nous avons perdu le signal.").
   */
  | { type: 'ANNOUNCE'; lines: SpokenText[]; after?: boolean }
  /** A sighting: the chase pauses while the player picks one of `cards` (`seconds` to answer). */
  | { type: 'SIGHTING'; line: SpokenText; cards: SightingCard[]; seconds: number }
  | { type: 'SIGHTING_RESULT'; correct: boolean; answer: number; chosen: number | null }
  /** The signal was lost, or is back. */
  | { type: 'SIGNAL'; lost: boolean }
  /** The suspect got out of or into a car. */
  | { type: 'SUSPECT_MODE'; mode: TravelMode }
  /** The suspect crashed its car (it gets out and runs). */
  | { type: 'SUSPECT_CRASH' }
  /** The suspect turned round just before the arrest: the police car skids past, or the officer falls. */
  | { type: 'SUSPECT_DODGE'; mode: TravelMode };

export interface ChaseStatus {
  phase: ChasePhase;
  /** Road distance to the suspect in metres. */
  distance: number;
  /** 1 = right on the suspect, 0 = about to lose them. */
  signal: number;
  proximity: Proximity;
  timeLeft: number;
  elapsed: number;
  suspectVisible: boolean;
  warning: boolean;
  /** 0..1 while closing in for the capture. */
  captureProgress: number;
  /** Repeats asked for so far (for scoring), and how many are left (null = no limit). */
  repeatsUsed: number;
  repeatsLeft: number | null;
  escapeReason?: EscapeReason;
  /** The mode the player has been told to switch to, once the order has been given. */
  switchTo: TravelMode | null;
  /** The player is being taken to where the suspect changed transport (controls do nothing). */
  followingTracks: boolean;
  /** An open sighting question: the choices and the seconds left to answer. */
  sighting: { cards: SightingCard[]; secondsLeft: number } | null;
  /** Sightings answered so far, and how many were right (for scoring). */
  sightingsAsked: number;
  sightingsRight: number;
  /** The scanner has lost the signal: no directions, suspect hidden. */
  signalLost: boolean;
}

function vehicleLines(vehicle: Vehicle | null | undefined): SpokenText[] {
  return vehicle ? [vehicleLine(vehicle)] : [];
}

/** Roughly how long a line takes to say (slow, clear French). */
function speechSeconds(text: string): number {
  return text ? CALL_TIMING.speechBaseSeconds + text.length / CALL_TIMING.speechCharsPerSecond : 0;
}

/** The first step of a call: "…, puis …" and "D'abord … Ensuite …" calls go on while the player moves. */
function firstStep(text: string): string {
  return text.split(/(?<=\.)\s|,\s*puis\s/)[0] ?? text;
}

/** Where a mover position is on the map. */
export function pointOf(graph: TownGraph, at: MoverStart): Point {
  const edge = graph.edge(at.edgeId);
  return lerp(graph.node(edge.from), graph.node(edge.to), at.t);
}

/** The nearest spot on a road a car can use, for the colleague who brings the police car. */
function nearestRoad(graph: TownGraph, p: Point): MoverStart {
  let best: { at: MoverStart; d: number } | null = null;
  for (const edge of graph.map.edges) {
    if (!edge.car || !edge.foot || edge.kind === 'ROUNDABOUT_RING') continue;
    const a = graph.node(edge.from);
    const b = graph.node(edge.to);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0.1, Math.min(0.9, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = distance(p, lerp(a, b, t));
    if (!best || d < best.d) best = { at: { edgeId: edge.id, t, towards: edge.to, mode: 'CAR' }, d };
  }
  if (!best) throw new Error('The map has no roads');
  return best.at;
}

export class Chase {
  player: Mover;
  suspect: Mover;
  navigator: Navigator;
  /** Where the police car is parked while the player is on foot (null when in it, or none). */
  parkedCar: MoverStart | null = null;
  /** Where the suspect left its car, if it did. */
  abandonedCar: MoverStart | null = null;
  /** Which stage the suspect and the player are on (they differ while the player catches up with a change). */
  suspectStage = 0;
  playerStage = 0;
  /** The stages, with any added during the chase (running on after a last-second crash). */
  readonly stages: ChaseStage[];
  /** Where the suspect is heading (a last-second escape can change it). */
  destination: string;
  /** The last-second escape still to come. */
  private nearCapture: NearCapture | null;
  /** Routes planned during the chase (last-second escapes) come from this stream. */
  private readonly escapeRng: Rng;
  /** No capture before this (elapsed seconds): the suspect has just got away. */
  private noCaptureBefore = 0;
  /**
   * The player is held still after a dodge (the police car skids to a stop, the
   * officer falls) until they turn round, between these times (elapsed seconds).
   */
  private held: { edgeId: string; towards: string; minUntil: number; maxUntil: number } | null = null;
  /** After a last-second crash the police car stops until the player gets out. */
  private crashHold = false;
  /** After a dodge: corrected directions are due once the player has stopped. */
  private correctionDue = false;
  /** After a dodge: the police car is stopped, or the officer on the ground, until then (elapsed seconds). */
  private downUntil = 0;
  /** After "Faites demi-tour.": once turned round, wait to hear the next direction before setting off. */
  private holdForNextCall = false;
  /** After a last-second crash the suspect sprints until it is this far ahead (metres). */
  private sprintUntil: number | null = null;
  private readonly repeats: RepeatCounter;
  private readonly settings: ChaseSettings;
  private phase: ChasePhase = 'PURSUIT';
  private elapsed = 0;
  private timeLeft: number;
  private closeFor = 0;
  private distance: number;
  private warning = false;
  private sighted = false;
  private suspectArrived = false;
  /** Elapsed time when the suspect finishes getting out of or into a car. */
  private transferUntil: number | null = null;
  /** The player must change to this mode; `announced` once the order has been given. */
  private pending: { mode: TravelMode; announced: boolean } | null = null;
  private carBrought = false;
  /** Set while the player is being taken to the start of this stage. */
  private autoStage: number | null = null;
  private escapeReason?: EscapeReason;
  /** The change of direction is still to come (it is dropped if the player is not on that stage yet). */
  private turnOffPending: boolean;
  private readonly hasAudio: AudioCheck | undefined;
  private started = false;
  private nextSighting = 0;
  private check: { index: number; secondsLeft: number } | null = null;
  private revealUntil = -Infinity;
  /** The suspect is in view while changing transport, and until this time (elapsed seconds) afterwards. */
  private transferRevealUntil = -Infinity;
  private sightingsAsked = 0;
  private sightingsRight = 0;
  private lostSignalPending: boolean;
  /** Elapsed time when the signal was lost, while it is. */
  private lostSince: number | null = null;
  /** The latest direction: its junction and when it finishes being spoken (elapsed seconds). */
  private call: { at: string; spokenBy: number } | null = null;

  constructor(
    private readonly graph: TownGraph,
    readonly scenario: ChaseScenario,
    options: { hasAudio?: AudioCheck } = {},
  ) {
    this.hasAudio = options.hasAudio;
    this.settings = CHASE_SETTINGS[scenario.difficulty];
    this.timeLeft =
      DIFFICULTY_SETTINGS[scenario.difficulty].timeLimitSeconds + (scenario.stages.length - 1) * TRANSFER.extraSeconds;
    this.repeats = new RepeatCounter(DIFFICULTY_SETTINGS[scenario.difficulty].repeat);
    this.turnOffPending = scenario.turnOff !== null;
    this.lostSignalPending = scenario.lostSignal;
    this.stages = scenario.stages.map((st) => ({ ...st, route: [...st.route] }));
    this.destination = scenario.destination;
    this.nearCapture = scenario.nearCapture;
    this.escapeRng = Rng.fromSeed(scenario.seed).fork('escape-routes');
    this.player = new Mover(graph, scenario.playerStart);
    this.suspect = new Mover(graph, scenario.suspectStart);
    this.suspect.followPlan(scenario.suspectPlan);
    this.suspect.speedFactor = this.suspectSpeedFor(0);
    this.navigator = this.navigatorFor(0);
    this.distance = this.measure();
  }

  /** The suspect keeps pace until its last stage, where the police slowly close in. */
  private suspectSpeedFor(stage: number): number {
    const mode = this.stages[stage]!.mode;
    return stage === this.lastStage ? this.settings.suspectSpeed[mode] : TRANSFER.suspectSpeedBeforeLastStage;
  }

  private get lastStage(): number {
    return this.stages.length - 1;
  }

  /**
   * Directions for one stage. The first stage keeps the original language
   * stream. Before a change of direction, the scanner guides along the route
   * it predicts.
   */
  private navigatorFor(stage: number): Navigator {
    const { scenario } = this;
    const route = this.stages[stage]?.route ?? scenario.route;
    const turnOff = this.turnOffPending && scenario.turnOff?.stage === stage ? scenario.turnOff : null;
    return new Navigator(
      this.graph,
      scenario.difficulty,
      Rng.fromSeed(scenario.seed).fork(stage === 0 ? 'language' : `language-${stage}`),
      turnOff ? [...route.slice(0, turnOff.at), ...turnOff.decoy] : route,
      turnOff ? turnOff.decoyDestination : stage === this.lastStage ? this.destination : null,
      this.stages[stage]?.mode ?? 'CAR',
      this.hasAudio,
    );
  }

  /**
   * The suspect has turned off the predicted route: announce it and correct
   * the directions from where the player is. Dropped if the player has not
   * reached that stage yet (its directions will follow the real route).
   */
  private checkTurnOff(events: ChaseEvent[]): void {
    const turnOff = this.scenario.turnOff;
    if (!this.turnOffPending || !turnOff || this.suspectStage !== turnOff.stage || this.lostSince !== null) return;
    const route = this.stages[turnOff.stage]!.route;
    const junction = route[turnOff.at] as string;
    const plan = this.suspect.remainingPlan();
    // Seen turning off: about to reach the junction, or past it.
    const seen =
      !plan.includes(junction) ||
      (plan[0] === junction &&
        distance(this.suspect.snapshot(), this.graph.node(junction)) <= TURN_OFF.seenWithin[this.suspect.mode]);
    if (!seen) return;
    if (this.playerStage !== turnOff.stage || this.pending || this.autoStage !== null) {
      this.turnOffPending = false;
      return;
    }
    if (!this.clearOfJunctions()) return; // wait until there is time to take the correction in
    this.turnOffPending = false;
    events.push({ type: 'ANNOUNCE', lines: [EVENT_LINES.ATTENTION, EVENT_LINES.CHANGED_DIRECTION] });
    // Still on the shared part of the route: the real route from here. Otherwise a way onto it.
    const here = this.player.location();
    const i = route.findIndex(
      (n, k) =>
        k < turnOff.at &&
        here.towards === route[k + 1] &&
        this.graph.edgeBetween(n, route[k + 1] as string)?.id === here.edgeId,
    );
    const transmissions =
      i === -1
        ? this.navigator.redirect(here, plan, this.destination)
        : this.navigator.redirect(here, plan, this.destination, route.slice(i));
    for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
  }

  /** Is the player stopped, or far enough (in seconds) from the next junction to act on new directions? */
  private clearOfJunctions(): boolean {
    const me = this.player.snapshot();
    if (me.waiting) return true;
    const here = this.player.location();
    if (this.graph.edge(here.edgeId).kind === 'ROUNDABOUT_RING') return false;
    const next = scanAhead(this.graph, here, me.mode).nodes.find(isDecision);
    return !next || next.s >= TURN_OFF.clearSeconds * Math.max(me.speed, 1);
  }

  /**
   * While the suspect is changing transport at the end of a stage: the mode it
   * is changing to and how far through the change it is (0 to 1), so the game
   * can draw it running up to its getaway car and getting in. Null otherwise.
   */
  get transfer(): { to: TravelMode; progress: number } | null {
    if (this.transferUntil === null || this.suspectStage >= this.lastStage) return null;
    const to = this.stages[this.suspectStage + 1]!.mode;
    const left = (this.transferUntil - this.elapsed) / TRANSFER.suspectSeconds[to];
    return { to, progress: Math.min(1, Math.max(0, 1 - left)) };
  }

  /** Where the suspect starts a stage (its getaway car waits here before a change into a car). */
  stageStart(stage: number): MoverStart {
    const st = this.stages[stage]!;
    return placeOnRoute(this.graph, st.route, TRANSFER.stageStartMetres[st.mode], st.mode).start;
  }

  /**
   * The dispatcher's opening call (the suspect's vehicle, then the first
   * direction), given before anything moves: the game plays it in full and
   * only then starts the chase. Without it, the first `update` gives the same
   * call as the chase starts.
   */
  openingCall(): ChaseEvent[] {
    const events: ChaseEvent[] = [];
    if (this.started || this.phase !== 'PURSUIT') return events;
    this.started = true;
    const vehicle = this.scenario.vehicles[0];
    if (vehicle) events.push({ type: 'ANNOUNCE', lines: [vehicleLine(vehicle)] });
    const transmissions = this.navigator.update(this.player.location(), this.suspect.remainingPlan());
    for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
    return events;
  }

  /** Where the suspect changes transport at the end of the player's current stage. */
  private get transferNode(): string {
    const route = this.stages[this.playerStage]?.route ?? [];
    return route[route.length - 1] as string;
  }

  /** Advance the chase by `dt` seconds. The caller moves nothing itself. */
  update(dt: number): ChaseEvent[] {
    const events: ChaseEvent[] = [];
    if (this.phase !== 'PURSUIT') return events;
    if (this.check) {
      // Paused while the player answers a sighting.
      this.check.secondsLeft -= dt;
      if (this.check.secondsLeft <= 0) this.resolveSighting(null, events);
      return events;
    }
    if (!this.started) {
      this.started = true;
      // "Le suspect est dans une voiture verte.", spoken before the first direction.
      const vehicle = this.scenario.vehicles[0];
      if (vehicle) events.push({ type: 'ANNOUNCE', lines: [vehicleLine(vehicle)] });
    }

    const pace = this.callPace();
    this.player.callAssist = pace;
    this.suspect.callAssist = pace;
    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt * pace);
    this.player.speedFactor = this.playerHeld() ? 0 : 1;
    this.player.update(dt);
    this.suspect.update(dt);
    if (!this.suspectArrived && this.suspect.snapshot().waiting === 'ARRIVED') {
      if (this.suspectStage < this.lastStage) this.changeSuspectTransport(events);
      else this.keepGoing(events);
    }

    this.checkTurnOff(events);
    this.orderGetOut(events);
    if (this.autoStage !== null && this.player.snapshot().waiting === 'ARRIVED') this.beginStage(this.autoStage, events);

    this.distance = this.measure();
    if (this.correctionDue && this.player.snapshot().speed < 1) this.correctAfterDodge(events);
    if (!this.pending?.announced && this.autoStage === null && !this.correctionDue) {
      // Until the player changes transport, guide them to where the suspect did.
      const ahead = this.playerStage < this.suspectStage ? [this.transferNode] : this.suspect.remainingPlan();
      const here = this.player.location();
      if (this.lostSince !== null) this.whileSignalLost(here, ahead, events);
      else {
        this.navigator.preferSteps = this.lostSignalSteps;
        const foot = here.mode === 'FOOT';
        this.navigator.leadDistance = foot ? CALL_TIMING.footLeadSeconds[this.scenario.difficulty] * MOVEMENT.FOOT.cruise : Infinity;
        this.navigator.minLeadDistance = foot ? CALL_TIMING.footMinLeadSeconds * MOVEMENT.FOOT.cruise : 0;
        const transmissions = this.navigator.update(here, ahead);
        for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
        this.noteCall(transmissions);
        if (this.holdForNextCall && this.turnedRound()) this.waitForCall(transmissions);
        this.maybeLoseSignal(transmissions, events);
      }
    }
    this.checkSighting(events);
    const s = this.settings;
    const lost = this.lostSince !== null;

    const changing = this.transferUntil !== null || this.elapsed < this.transferRevealUntil;
    const sighted = !lost && (this.distance <= s.sightingDistance || this.elapsed < this.revealUntil || changing);
    if (sighted !== this.sighted) {
      this.sighted = sighted;
      events.push({ type: 'SIGHTED', on: sighted });
    }
    const warning = !lost && this.distance >= s.warningDistance;
    if (warning !== this.warning) {
      this.warning = warning;
      events.push({ type: 'WARNING', on: warning });
    }

    if (this.sprintUntil !== null && this.distance >= this.sprintUntil) {
      this.sprintUntil = null;
      this.suspect.speedFactor = this.suspectSpeedFor(this.suspectStage);
    }

    // A moving car cannot be caught on foot, nor a runner from the car; a suspect changing transport can.
    const stopped = this.transferUntil !== null;
    const canCapture = (this.player.mode === this.suspect.mode || stopped) && this.elapsed >= this.noCaptureBefore;
    this.closeFor = this.distance <= s.captureDistance && canCapture ? this.closeFor + dt : 0;

    // A stopped suspect is caught as soon as the player reaches it: an auto-driving
    // car would otherwise roll straight past before the hold time is up.
    const hold = stopped || this.suspectArrived ? 0 : s.captureHold;
    const caught = this.closeFor > 0 && this.closeFor >= hold;
    if (caught && this.escapeAtLastSecond(events)) {
      this.closeFor = 0;
    } else if (caught) {
      this.phase = 'CAPTURED';
      events.push({ type: 'CAPTURED' });
    } else if (this.timeLeft <= 0) {
      // Losing the suspect costs time, never the chase: only the clock ends it.
      this.phase = 'ESCAPED';
      this.escapeReason = 'TIME';
      events.push({ type: 'ESCAPED', reason: 'TIME' });
    }
    return events;
  }

  /**
   * The suspect reaches the end of its route before it is caught. It never
   * stops or waits, so it drives (or runs) on along a fresh route from here,
   * and the scanner's directions follow it: the chase only ends when the
   * clock runs out, however far behind the player falls. Boxed in with no way
   * on (a dead end with no route back), it stops where it is and can be caught.
   */
  private keepGoing(events: ChaseEvent[]): void {
    const planFrom = (at: MoverStart) => {
      const length = this.settings.stageLength[at.mode];
      return (
        this.escapeRoute(at.towards, at.edgeId, at.mode, length) ??
        this.escapeRoute(at.towards, at.edgeId, at.mode, [length[0] / 2, length[1]])
      );
    };
    let at = this.suspect.location();
    let route = planFrom(at);
    if (!route && this.suspect.uTurn()) {
      at = this.suspect.location();
      route = planFrom(at);
    }
    if (!route) {
      this.suspectArrived = true;
      events.push({ type: 'SUSPECT_ARRIVED' });
      return;
    }
    const stage = this.stages[this.suspectStage]!;
    this.stages[this.suspectStage] = { ...stage, route: [...stage.route, ...route.nodes.slice(1)], length: stage.length + route.length };
    this.destination = route.destination;
    this.suspect = new Mover(this.graph, at);
    this.suspect.followPlan(route.nodes);
    this.suspect.speedFactor = this.suspectSpeedFor(this.suspectStage);
    if (this.playerStage !== this.suspectStage) return; // the next stage's directions already follow the longer route
    const transmissions = this.navigator.redirect(this.player.location(), this.suspect.remainingPlan(), this.destination);
    for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
  }

  /**
   * The suspect has reached the end of a stage: it stops while it gets out of
   * (or into) a car, then carries on in the next stage's mode.
   */
  private changeSuspectTransport(events: ChaseEvent[]): void {
    if (this.transferUntil === null) {
      this.transferUntil = this.elapsed + TRANSFER.suspectSeconds[this.stages[this.suspectStage + 1]!.mode];
      if (this.scenario.transferCrashes[this.suspectStage]) events.push({ type: 'SUSPECT_CRASH' });
      return;
    }
    if (this.elapsed < this.transferUntil) return;
    this.transferUntil = null;
    this.transferRevealUntil = this.elapsed + TRANSFER.revealSeconds;
    if (this.lostSince !== null) this.restoreSignal(events);
    const from = this.suspect.mode;
    this.suspectStage++;
    const stage = this.stages[this.suspectStage]!;
    if (from === 'CAR') this.abandonedCar = this.suspect.location();
    const placed = placeOnRoute(this.graph, stage.route, TRANSFER.stageStartMetres[stage.mode], stage.mode);
    this.suspect = new Mover(this.graph, placed.start);
    this.suspect.followPlan(placed.plan);
    this.suspect.speedFactor = this.suspectSpeedFor(this.suspectStage);
    events.push({ type: 'SUSPECT_MODE', mode: stage.mode });

    const crashed = stage.mode === 'FOOT' && this.scenario.transferCrashes[this.suspectStage - 1];
    const lines: SpokenText[] =
      stage.mode === 'FOOT'
        ? [...(crashed ? [EVENT_LINES.CRASHED] : []), TRANSPORT_LINES.SUSPECT_LEFT_CAR, TRANSPORT_LINES.ON_FOOT]
        : [TRANSPORT_LINES.SUSPECT_BOARDS, ...vehicleLines(this.scenario.vehicles[this.suspectStage])];
    if (this.player.mode === stage.mode) {
      events.push({ type: 'ANNOUNCE', lines });
      this.startPlayerStage(events);
      return;
    }
    this.pending = { mode: stage.mode, announced: false };
    if (stage.mode === 'CAR') {
      // A colleague brings the police car to the nearest road.
      this.parkedCar = nearestRoad(this.graph, this.player.snapshot());
      this.carBrought = true;
      this.pending.announced = true;
      lines.push(TRANSPORT_LINES.GET_IN);
    }
    events.push({ type: 'ANNOUNCE', lines });
  }

  /** Held still after a dodge or a crash (see `held` and `crashHold`). */
  private playerHeld(): boolean {
    if (this.crashHold) {
      if (this.player.mode === 'CAR' && this.pending?.mode === 'FOOT') return true;
      this.crashHold = false;
    }
    const held = this.held;
    if (!held) return false;
    if (this.elapsed < held.minUntil) return true;
    // Still where they were told to turn round, or turned round and waiting for the next direction.
    if ((!this.turnedRound() || this.holdForNextCall) && this.elapsed < held.maxUntil) return true;
    this.held = null;
    this.holdForNextCall = false;
    return false;
  }

  /** Has the player moved on from (or turned round at) the spot where they are held? */
  private turnedRound(): boolean {
    if (!this.held) return false;
    const here = this.player.location();
    return here.edgeId !== this.held.edgeId || here.towards !== this.held.towards;
  }

  /**
   * The arrest is about to happen: if this chase has a last-second escape
   * still to come and it can happen here, the suspect gets away once more.
   */
  private escapeAtLastSecond(events: ChaseEvent[]): boolean {
    const kind = this.nearCapture;
    if (!kind || this.transferUntil !== null || this.suspectArrived || this.check) return false;
    if (this.suspectStage !== this.lastStage || this.playerStage !== this.suspectStage) return false;
    if (this.pending || this.autoStage !== null || this.turnOffPending || this.player.mode !== this.suspect.mode) return false;
    if (this.timeLeft < NEAR_CAPTURE_MIN_SECONDS[this.player.mode]) return false;
    // The scanner comes back to report it (the signal was lost).
    const lost = this.lostSince;
    if (lost !== null) this.restoreSignal(events);
    const done = kind === 'CRASH' ? this.crash(events) : this.dodge(events);
    if (done) this.nearCapture = null;
    else if (lost !== null) {
      this.lostSince = lost;
      events.pop();
    }
    return done;
  }

  /** A route for the suspect from `from` (leaving by any way but `avoidEdge`), or null. */
  private escapeRoute(
    from: string,
    avoidEdge: string,
    mode: TravelMode,
    length: [number, number],
    extra: (nodes: readonly string[]) => boolean = () => true,
  ): { nodes: string[]; length: number; destination: string } | null {
    const { difficulty } = this.scenario;
    try {
      const route = generateRoute(
        this.graph,
        this.escapeRng,
        {
          length,
          mode,
          from,
          avoidEdge,
          accept: (nodes) =>
            turnsOftenEnough(this.graph, nodes, mode) && describable(this.graph, nodes, mode, difficulty) && extra(nodes),
        },
        300,
      );
      return route.destination ? { nodes: route.nodes, length: route.length, destination: route.destination } : null;
    } catch {
      return null;
    }
  }

  /**
   * Driving, the suspect swerves off the road and crashes, jumps out and runs:
   * a new foot stage from the junction ahead. The police car stops; the player
   * must get out ("Descendez de la voiture !") while the suspect sprints away.
   */
  private crash(events: ChaseEvent[]): boolean {
    const at = this.suspect.location();
    const edge = this.graph.edge(at.edgeId);
    if (at.mode !== 'CAR' || !edge.foot || edge.kind === 'ROUNDABOUT_RING') return false;
    const [shortest, longest] = this.settings.stageLength.FOOT;
    const route = this.escapeRoute(at.towards, edge.id, 'FOOT', [shortest * CRASH.routeShare[0], longest * CRASH.routeShare[1]]);
    if (!route) return false;
    this.abandonedCar = at;
    this.stages.push({ mode: 'FOOT', route: route.nodes, length: route.length });
    this.destination = route.destination;
    this.suspectStage++;
    this.suspect = new Mover(this.graph, { ...at, mode: 'FOOT' });
    this.suspect.followPlan(route.nodes);
    this.suspect.speedFactor = this.suspectSpeedFor(this.suspectStage) * CRASH.sprintFactor;
    this.sprintUntil = CRASH.headStartShare * this.settings.headStart.FOOT;
    this.timeLeft += TRANSFER.extraSeconds;
    this.pending = { mode: 'FOOT', announced: true };
    this.crashHold = true;
    events.push({ type: 'SUSPECT_CRASH' }, { type: 'SUSPECT_MODE', mode: 'FOOT' });
    events.push({
      type: 'ANNOUNCE',
      lines: [EVENT_LINES.CRASHED, TRANSPORT_LINES.SUSPECT_LEFT_CAR, TRANSPORT_LINES.ON_FOOT, TRANSPORT_LINES.GET_OUT],
    });
    return true;
  }

  /**
   * The suspect turns round and heads off on a new route. The police car skids
   * to a stop (or the officer falls over) until the player turns round too; the
   * scanner corrects itself as for any change of direction.
   */
  private dodge(events: ChaseEvent[]): boolean {
    const at = this.suspect.location();
    const edge = this.graph.edge(at.edgeId);
    const back = this.graph.other(edge, at.towards);
    if (edge.kind === 'ROUNDABOUT_RING' || !canTravel(edge, at.mode, back)) return false;
    // A way the scanner can guide the player straight onto, right behind the suspect (not a shortcut to its end).
    const here = this.player.location();
    // It heads away from the police and does not loop back past them (they may skid on through the next junction).
    const near = new Set([here.towards, this.graph.other(this.graph.edge(here.edgeId), here.towards)]);
    const around = new Set(this.graph.steps(here.towards, here.mode).map((st) => st.to));
    const followable = (strict: boolean) => (nodes: readonly string[]) =>
      nodes.every((n, i) => i === 0 || (!near.has(n) && (i === 1 || !strict || !around.has(n)))) &&
      (planGuide(this.graph, here, nodes, this.scenario.difficulty)?.guide.slice(1).includes(nodes[1] as string) ?? false);
    const length = DODGE.routeLength[at.mode];
    const route =
      this.escapeRoute(back, edge.id, at.mode, length, followable(true)) ??
      this.escapeRoute(back, edge.id, at.mode, length, followable(false));
    if (!route || !this.suspect.uTurn()) return false;
    this.suspect.followPlan(route.nodes);
    this.destination = route.destination;
    this.timeLeft += DODGE.extraSeconds[at.mode];
    this.noCaptureBefore = this.elapsed + DODGE.graceSeconds;
    // Turns it was about to take no longer lead to the suspect.
    this.player.clearQueue();
    // The police car skids to a stop, or the officer falls; the correction follows once they have stopped.
    this.held = { edgeId: '', towards: '', minUntil: this.elapsed + DODGE.holdSeconds, maxUntil: 0 };
    this.correctionDue = true;
    this.downUntil = this.elapsed + DODGE.downSeconds[at.mode];
    events.push({ type: 'SUSPECT_DODGE', mode: at.mode });
    events.push({ type: 'ANNOUNCE', lines: [EVENT_LINES.ATTENTION, EVENT_LINES.CHANGED_DIRECTION] });
    return true;
  }

  /**
   * After a dodge, once the player has stopped: directions onto the suspect's
   * new route ("Faites demi-tour." when the quickest way is back). The player
   * stays put until the correction has been heard or, when told to turn round,
   * until they do.
   */
  private correctAfterDodge(events: ChaseEvent[]): void {
    this.correctionDue = false;
    // Stopped means stopped: no creeping on through the junction the correction is about.
    this.player.setSpeed(0);
    const here = this.player.location();
    const plan = this.suspect.remainingPlan();
    // Follow its tracks: onto the street it is on now, not a short cut to further along its route.
    const them = this.suspect.location();
    const tracks = [this.graph.other(this.graph.edge(them.edgeId), them.towards), plan[0] as string];
    const onto = planGuide(this.graph, here, tracks, this.scenario.difficulty);
    const guide = onto ? [...onto.guide, ...plan.slice(1)] : null;
    const fair =
      guide !== null &&
      new Set(guide).size === guide.length &&
      followProblem(this.graph, guide, here.mode) === null &&
      describable(this.graph, guide, here.mode, this.scenario.difficulty);
    const corrections = fair
      ? this.navigator.redirect(here, plan, this.destination, guide, onto!.uTurn)
      : this.navigator.redirect(here, plan, this.destination);
    for (const transmission of corrections) events.push({ type: 'TRANSMISSION', transmission });
    const turnRound = corrections.some((t) => t.instructions.some((i) => i.clauses.some((c) => c.action === 'U_TURN')));
    const heard = speechSeconds(firstStep(corrections[0]?.text ?? '')) + CALL_TIMING.reactSeconds;
    this.holdForNextCall = turnRound;
    this.held = {
      edgeId: here.edgeId,
      towards: here.towards,
      minUntil: Math.max(this.downUntil, this.elapsed + (turnRound ? 0 : heard)),
      maxUntil: this.elapsed + (turnRound ? DODGE.holdSeconds : 0),
    };
  }

  /** Turned round after a dodge: stay put until the first call from here has been said. */
  private waitForCall(transmissions: readonly Transmission[]): void {
    const call = transmissions.find((t) => t.kind === 'DIRECTION' || t.kind === 'FILLER');
    if (!call) return;
    this.holdForNextCall = false;
    const here = this.player.location();
    const until = this.elapsed + speechSeconds(firstStep(call.text)) + CALL_TIMING.reactSeconds;
    this.held = { edgeId: here.edgeId, towards: here.towards, minUntil: until, maxUntil: 0 };
  }

  /** Remember the junction a new direction is about, and roughly when it will have been heard. */
  private noteCall(transmissions: Transmission[]): void {
    for (const t of transmissions) {
      if (t.kind !== 'DIRECTION' || !t.at) continue;
      // Only the first step has to be heard before the first junction ("…, puis …" and
      // "D'abord … Ensuite …" calls go on while the player drives).
      const speech = speechSeconds(firstStep(t.text));
      this.call = { at: t.at, spokenBy: this.elapsed + speech };
    }
  }

  /**
   * Slow the chase just enough to hear the latest direction out and react
   * before its junction (CALL_TIMING); 1 when there is time, or no call.
   */
  private callPace(): number {
    if (!this.call || this.phase !== 'PURSUIT') return 1;
    const here = this.player.location();
    const toJunction = this.navigator.distanceTo(here, this.call.at);
    if (!Number.isFinite(toJunction)) {
      this.call = null;
      return 1;
    }
    const needed = Math.max(0, this.call.spokenBy - this.elapsed) + CALL_TIMING.reactSeconds;
    const cruise = MOVEMENT[here.mode].cruise * this.player.speedFactor;
    return Math.min(1, Math.max(CALL_TIMING.minPace, toJunction / needed / cruise));
  }

  /**
   * The suspect has just passed the next planned sighting's place: report it
   * and pause for the answer.
   * The suspect may already be in view: the question is then easier. Skipped
   * if the signal is lost or the player is being moved between stages. Waits a
   * frame if the scanner is already speaking in this one.
   */
  private checkSighting(events: ChaseEvent[]): void {
    const sighting = this.scenario.sightings[this.nextSighting];
    if (!sighting) return;
    if (this.suspectStage > sighting.stage) {
      this.nextSighting++;
      return;
    }
    if (this.suspectStage !== sighting.stage || this.transferUntil !== null) return;
    const node = this.stages[sighting.stage]!.route[sighting.at] as string;
    if (this.suspect.remainingPlan().includes(node)) return;
    if (events.some((e) => e.type === 'TRANSMISSION' || e.type === 'ANNOUNCE')) return;
    const index = this.nextSighting++;
    if (this.lostSince !== null || this.autoStage !== null) return;
    const seconds = this.settings.sightings.pickSeconds;
    this.check = { index, secondsLeft: seconds };
    events.push({ type: 'SIGHTING', line: sightingLine(sighting.named, sighting.place), cards: sighting.cards, seconds });
  }

  /** The player picks a sighting choice (index into the cards). Returns what follows. */
  answerSighting(choice: number): ChaseEvent[] {
    const events: ChaseEvent[] = [];
    if (this.phase === 'PURSUIT' && this.check) this.resolveSighting(choice, events);
    return events;
  }

  private resolveSighting(chosen: number | null, events: ChaseEvent[]): void {
    const { answer } = this.scenario.sightings[this.check!.index]!;
    this.check = null;
    const correct = chosen === answer;
    this.sightingsAsked++;
    if (correct) {
      this.sightingsRight++;
      this.timeLeft += SIGHTING.bonusSeconds;
      this.revealUntil = this.elapsed + SIGHTING.revealSeconds;
    } else {
      this.timeLeft = Math.max(0, this.timeLeft - SIGHTING.penaltySeconds);
    }
    events.push({ type: 'SIGHTING_RESULT', correct, answer, chosen });
  }

  /** While a lost signal is due, the scanner prefers calls with several turns. */
  private get lostSignalSteps(): number {
    return this.lostSignalPending && this.elapsed >= LOST_SIGNAL.minElapsed ? LOST_SIGNAL.minSteps : 0;
  }

  /**
   * Expert: lose the signal straight after a call with several turns in it,
   * so the player has to remember them.
   */
  private maybeLoseSignal(transmissions: readonly Transmission[], events: ChaseEvent[]): void {
    if (!this.lostSignalPending || this.elapsed < LOST_SIGNAL.minElapsed) return;
    if (this.playerStage !== this.suspectStage || this.pending || this.transferUntil !== null) return;
    const call = transmissions.find((t) => t.kind === 'DIRECTION');
    const nodes = call?.instructions.flatMap((i) => i.atNodes) ?? [];
    if (nodes.length < LOST_SIGNAL.minSteps) return;
    // Before a change of direction, only for turns the predicted and real routes share:
    // the player is then still on the real route when the correction comes.
    const turnOff = this.turnOffPending ? this.scenario.turnOff : null;
    if (turnOff?.stage === this.playerStage) {
      const shared = this.stages[turnOff.stage]!.route.slice(0, turnOff.at);
      if (!nodes.every((n) => shared.includes(n))) return;
    }
    this.lostSignalPending = false;
    this.lostSince = this.elapsed;
    events.push({ type: 'ANNOUNCE', lines: [EVENT_LINES.LOST_SIGNAL], after: true });
    events.push({ type: 'SIGNAL', lost: true });
  }

  /** While the signal is lost: follow the player silently, and restore it once there is news. */
  private whileSignalLost(here: MoverStart, ahead: readonly string[], events: ChaseEvent[]): void {
    this.navigator.track(here);
    const lostFor = this.elapsed - (this.lostSince as number);
    if (!this.navigator.hasNews(here) && lostFor < LOST_SIGNAL.maxSeconds) return;
    this.restoreSignal(events);
    for (const transmission of this.navigator.resume(here, ahead)) events.push({ type: 'TRANSMISSION', transmission });
  }

  private restoreSignal(events: ChaseEvent[]): void {
    this.lostSince = null;
    events.push({ type: 'SIGNAL', lost: false });
  }

  /** "Descendez de la voiture !" once the player has driven up to where the suspect got out. */
  private orderGetOut(events: ChaseEvent[]): void {
    if (!this.pending || this.pending.announced || this.pending.mode !== 'FOOT') return;
    const near = distance(this.player.snapshot(), this.graph.node(this.transferNode)) <= TRANSFER.getOutWithin;
    if (!near) return;
    this.pending.announced = true;
    events.push({ type: 'ANNOUNCE', lines: [TRANSPORT_LINES.GET_OUT] });
  }

  /**
   * The player gets out of the car, or back in (within reach of it). Returns
   * the events that follow, such as the first direction of a new stage.
   */
  toggleMode(): { result: ModeChangeResult; events: ChaseEvent[] } {
    const events: ChaseEvent[] = [];
    if (this.phase !== 'PURSUIT' || this.autoStage !== null) return { result: { ok: false, reason: 'NOT_HERE' }, events };
    if (this.player.mode === 'CAR') {
      const parked = this.player.location();
      if (!this.player.setMode('FOOT')) return { result: { ok: false, reason: 'NOT_HERE' }, events };
      this.parkedCar = parked;
      this.carBrought = false;
    } else {
      if (!this.parkedCar) return { result: { ok: false, reason: 'NO_CAR' }, events };
      const reach = this.carBrought ? TRANSFER.pickupWithin : BOARDING_DISTANCE;
      if (distance(this.player.snapshot(), pointOf(this.graph, this.parkedCar)) > reach) {
        return { result: { ok: false, reason: 'TOO_FAR' }, events };
      }
      this.player = new Mover(this.graph, { ...this.parkedCar, mode: 'CAR' });
      this.parkedCar = null;
      this.carBrought = false;
    }
    if (this.pending && this.player.mode === this.suspect.mode) this.startPlayerStage(events);
    this.distance = this.measure();
    return { result: { ok: true }, events };
  }

  /**
   * The player is now in the suspect's mode. They first go (automatically) to
   * where the suspect changed transport, following its tracks; directions for
   * the new stage start from there, where every turn has been checked.
   */
  private startPlayerStage(events: ChaseEvent[]): void {
    this.pending = null;
    const stage = this.suspectStage;
    const path = this.pathTo(this.stages[stage]!.route[0] as string);
    if (!path) {
      this.beginStage(stage, events);
      return;
    }
    this.player.followPlan(path);
    this.autoStage = stage;
  }

  /** Directions for a stage, with the player at its start. */
  private beginStage(stage: number, events: ChaseEvent[]): void {
    this.autoStage = null;
    this.playerStage = stage;
    const { route, mode } = this.stages[stage]!;
    const speed = this.player.snapshot().speed;
    this.player = new Mover(this.graph, placeOnRoute(this.graph, route, 1, mode).start);
    this.player.setSpeed(speed);
    this.navigator = this.navigatorFor(stage);
    this.navigator.preferSteps = this.lostSignalSteps;
    const transmissions = this.navigator.update(this.player.location(), this.suspect.remainingPlan());
    for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
    this.maybeLoseSignal(transmissions, events);
  }

  /**
   * A plan for the player's mover from where it is to `node` (starting with
   * the node it is heading to), turning round first if that is shorter.
   */
  private pathTo(node: string): string[] | null {
    const player = this.player;
    const here = player.location();
    const edge = this.graph.edge(here.edgeId);
    const origin = this.graph.other(edge, here.towards);
    const length = this.graph.edgeLength(edge);
    const fromOrigin = (origin === edge.from ? here.t : 1 - here.t) * length;
    const blocked = new Set([edge.id]);
    const via = (start: string) =>
      start === node ? { nodes: [node], length: 0 } : this.graph.shortestPath(start, node, player.mode, blocked);
    const ahead = via(here.towards);
    const back = canTravel(edge, player.mode, here.towards) ? via(origin) : null;
    const aheadCost = ahead ? length - fromOrigin + ahead.length : Infinity;
    const backCost = back ? fromOrigin + back.length : Infinity;
    if (back && backCost < aheadCost) {
      player.uTurn();
      return back.nodes;
    }
    return ahead?.nodes ?? null;
  }

  /**
   * The player asks for the last call again. Returns what the officer should
   * say (by urgency) or that no repeats are left; the caller replays
   * `navigator.last`. On Hard a repeat costs time.
   */
  requestRepeat(): RepeatResult | null {
    if (this.phase !== 'PURSUIT' || !this.navigator.last || this.lostSince !== null || this.check) return null;
    const status = this.status;
    const result = this.repeats.request(status.signal, status.warning);
    if (result.allowed) this.timeLeft = Math.max(0, this.timeLeft - result.penaltySeconds);
    return result;
  }

  /** Debug tools: end the chase now with a given outcome. */
  forceOutcome(outcome: 'CAPTURED' | 'ESCAPED'): ChaseEvent[] {
    if (this.phase !== 'PURSUIT') return [];
    this.phase = outcome;
    if (outcome === 'ESCAPED') this.escapeReason = 'TIME';
    return [outcome === 'CAPTURED' ? { type: 'CAPTURED' } : { type: 'ESCAPED', reason: 'TIME' }];
  }

  /**
   * Debug tools: put the player right on the suspect, or `behind` metres back (tests the capture rules).
   * On a footpath a driver cannot follow, the player arrives on foot.
   */
  teleportPlayerToSuspect(behind = 0): void {
    const at = { ...this.suspect.location() };
    const edge = this.graph.edge(at.edgeId);
    // `behind` metres back along the suspect's street (as far as its start).
    const back = behind / Math.max(1, this.graph.edgeLength(edge));
    at.t = Math.min(1, Math.max(0, at.towards === edge.to ? at.t - back : at.t + back));
    const mode = this.player.mode === 'CAR' && !edge.car ? 'FOOT' : this.player.mode;
    if (mode !== this.player.mode) this.parkedCar = this.player.location();
    const start = { ...at, mode };
    // A car on a one-way street faces the legal way.
    if (mode === 'CAR' && edge.oneWay && at.towards !== edge.to) start.towards = edge.to;
    this.player = new Mover(this.graph, start);
    // Stay on the suspect's tail through the next junctions until the capture completes.
    if (start.towards === at.towards) this.player.followPlan(this.suspect.remainingPlan());
    this.player.setSpeed(this.suspect.snapshot().speed);
    this.distance = this.measure();
  }

  get status(): ChaseStatus {
    const s = this.settings;
    const signal = 1 - (this.distance - s.captureDistance) / (s.farDistance - s.captureDistance);
    return {
      phase: this.phase,
      distance: this.distance,
      signal: Math.max(0, Math.min(1, signal)),
      proximity:
        this.distance <= s.sightingDistance
          ? 'CLOSE'
          : this.distance < s.warningDistance / 2
            ? 'NEAR'
            : this.distance < s.warningDistance
              ? 'FAR'
              : 'LOSING',
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      suspectVisible: this.sighted,
      warning: this.warning,
      captureProgress: Math.min(1, this.closeFor / s.captureHold),
      repeatsUsed: this.repeats.used,
      repeatsLeft: this.repeats.left,
      switchTo: this.pending?.announced ? this.pending.mode : null,
      followingTracks: this.autoStage !== null,
      sighting: this.check
        ? { cards: this.scenario.sightings[this.check.index]!.cards, secondsLeft: Math.max(0, this.check.secondsLeft) }
        : null,
      sightingsAsked: this.sightingsAsked,
      sightingsRight: this.sightingsRight,
      signalLost: this.lostSince !== null,
      ...(this.escapeReason ? { escapeReason: this.escapeReason } : {}),
    };
  }

  /** Road distance; on foot when the two are in different modes (the player can always get out and run). */
  private measure(): number {
    const mode = this.player.mode === this.suspect.mode ? this.player.mode : 'FOOT';
    return roadDistance(this.graph, this.player.location(), this.suspect.location(), mode);
  }
}
