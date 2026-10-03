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

import { EVENT_LINES, OUTCOME_LINES, TRANSPORT_LINES } from '../audio/script';
import { callSeconds, speechSeconds } from '../language/timing';
import { SPEECH } from '../language/settings';
import { sightingLine, vehicleLine } from '../language/sightings';
import type { SightingCard } from './sightings';
import { DIFFICULTY_SETTINGS } from '../difficulty';
import { actionIndices, describable, type AudioCheck } from '../language/generate';
import { callable, planCalls, type CallContext } from '../language/callPlan';
import { Navigator, planGuide, type Transmission } from '../language/navigator';
import { Mover, type MoverStart } from '../movement/mover';
import { BOARDING_DISTANCE, MOVEMENT } from '../movement/settings';
import { Rng } from '../rng/prng';
import { distance, lerp, type Point } from '../world/geometry';
import { canTravel, type TownGraph, type TravelMode } from '../world/graph';
import { roadDistance } from './distance';
import { followProblem, generateRoute, pathLength, placeOnRoute, turnsOftenEnough } from './route';
import { correctionPoint, stageCallContext, type ChaseScenario, type ChaseStage, type NearCapture } from './scenario';
import { RepeatCounter, type RepeatResult } from '../audio/repeat';
import {
  CALL_ROUTES,
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
  KEEP_GOING,
} from './settings';
import { isDecision, scanAhead } from '../language/analysis';
import { exitsAt, type Exit } from '../movement/turns';

/** A fixed scanner line (not a route instruction): an event or an order. */
export interface SpokenText {
  audioId: string;
  text: string;
}

export type ModeChangeResult = { ok: true } | { ok: false; reason: 'NO_CAR' | 'TOO_FAR' | 'NOT_HERE' };

export type ChasePhase = 'PURSUIT' | 'CAPTURED' | 'ESCAPED';
export type Proximity = 'CLOSE' | 'NEAR' | 'FAR' | 'LOSING';
/** The suspect only ever escapes when the clock runs out; in Escape Mode the player gets away by reaching the hideout. */
export type EscapeReason = 'TIME' | 'HIDEOUT';

export type ChaseEvent =
  | { type: 'CAPTURED' }
  | { type: 'ESCAPED'; reason: EscapeReason }
  /** `speak`: the radio is free for a "Vite !" line (it never holds up a direction). */
  | { type: 'WARNING'; on: boolean; speak?: boolean }
  | { type: 'SIGHTED'; on: boolean }
  | { type: 'SUSPECT_ARRIVED' }
  /** The police scanner speaks (directions, corrections). */
  | { type: 'TRANSMISSION'; transmission: Transmission }
  /**
   * The scanner announces an event or gives an order, such as "Il est à pied !".
   * `after`: spoken straight after the call just before it ("Nous avons perdu le signal.").
   */
  /** `interrupt`: urgent news that cuts off whatever the scanner is saying (the directions no longer apply). */
  | { type: 'ANNOUNCE'; lines: SpokenText[]; after?: boolean; interrupt?: boolean }
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

/** Seconds between two "Vite ! Le suspect s'éloigne !" lines at least. */
const WARNING_LINE_GAP = 8;

function vehicleLines(vehicle: Vehicle | null | undefined): SpokenText[] {
  return vehicle ? [vehicleLine(vehicle)] : [];
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
  /** Seconds on the clock at the start (the level's limit, plus extra for each change of transport). */
  readonly timeLimit: number;
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
  /** When the suspect was seen turning off (the correction may wait until it can be heard in time). */
  private turnOffSeenAt: number | null = null;
  /** The route index just after which the change of direction is said (see correctionPoint). */
  private readonly turnOffCallAt: number | null;
  /** Held just after a change of transport until the first direction is heard (armed: not said yet). */
  private changeHold: { armed: boolean; until: number } | null = null;
  /** When keepGoingAhead may next try to plan a way on. */
  private nextAheadTry = 0;
  private aheadMisses = 0;
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
  /**
   * When the scanner's radio is next free (elapsed seconds), from every line
   * the chase has had it say. Directions wait for it, so each is heard from
   * where it was meant and in time (see Navigator.radioFreeIn).
   */
  private radioFreeAt = 0;
  /** No "Vite !" line before this (elapsed seconds). */
  private nextWarningLine = 0;
  /** Events of the current update already counted in `radioFreeAt`. */
  private radioCounted = 0;

  constructor(
    private readonly graph: TownGraph,
    readonly scenario: ChaseScenario,
    options: { hasAudio?: AudioCheck; extraSeconds?: number; suspectPace?: number } = {},
  ) {
    this.hasAudio = options.hasAudio;
    this.suspectPace = options.suspectPace ?? 1;
    this.settings = CHASE_SETTINGS[scenario.difficulty];
    this.timeLimit =
      DIFFICULTY_SETTINGS[scenario.difficulty].timeLimitSeconds +
      (scenario.stages.length - 1) * TRANSFER.extraSeconds +
      (options.extraSeconds ?? 0);
    this.timeLeft = this.timeLimit;
    this.repeats = new RepeatCounter(DIFFICULTY_SETTINGS[scenario.difficulty].repeat);
    this.turnOffPending = scenario.turnOff !== null;
    const turnOff = scenario.turnOff;
    const turnOffStage = turnOff ? scenario.stages[turnOff.stage] : undefined;
    this.turnOffCallAt =
      turnOff && turnOffStage
        ? correctionPoint(graph, turnOffStage.route, turnOff.at, turnOffStage.mode, scenario.difficulty, this.hasAudio)
        : null;
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

  /** The suspect's last-stage speed is scaled by this (a higher police rank meets quicker suspects). */
  private readonly suspectPace: number;

  /** The suspect keeps pace until its last stage, where the police slowly close in. */
  private suspectSpeedFor(stage: number): number {
    const mode = this.stages[stage]!.mode;
    return stage === this.lastStage ? Math.min(0.97, this.settings.suspectSpeed[mode] * this.suspectPace) : TRANSFER.suspectSpeedBeforeLastStage;
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
    const navigator = new Navigator(
      this.graph,
      scenario.difficulty,
      Rng.fromSeed(scenario.seed).fork(stage === 0 ? 'language' : `language-${stage}`),
      turnOff ? [...route.slice(0, turnOff.at), ...turnOff.decoy] : route,
      turnOff ? turnOff.decoyDestination : stage === this.lastStage ? this.destination : null,
      this.stages[stage]?.mode ?? 'CAR',
      this.hasAudio,
    );
    // The directions stop where the change of direction will be said (see correctionPoint).
    if (turnOff) navigator.holdAfter = this.turnOffCallAt;
    return navigator;
  }

  /**
   * The suspect has turned off the predicted route: announce it and correct
   * the directions from where the player is. Dropped if the player has not
   * reached that stage yet (its directions will follow the real route).
   */
  private checkTurnOff(events: ChaseEvent[]): void {
    const turnOff = this.scenario.turnOff;
    if (!this.turnOffPending || !turnOff || this.suspectStage !== turnOff.stage) return;
    const route = this.stages[turnOff.stage]!.route;
    const junction = route[turnOff.at] as string;
    let plan = this.suspect.remainingPlan();
    // Where the player is on the shared part of the route, if they are on it.
    const here = this.player.location();
    const i = route.findIndex(
      (n, k) =>
        k < turnOff.at &&
        here.towards === route[k + 1] &&
        this.graph.edgeBetween(n, route[k + 1] as string)?.id === here.edgeId,
    );
    // Said just after the last turn both routes share (see correctionPoint), so the new turn is heard in time.
    const callAt = this.turnOffCallAt;
    const atCallPoint = callAt !== null && i !== -1 && i >= callAt && this.playerStage === turnOff.stage;
    // Or once the suspect is seen turning off: about to reach the junction, or past it.
    const k = plan.indexOf(junction);
    const seen =
      k === -1 ||
      distance(this.suspect.snapshot(), this.graph.node(plan[0] as string)) + pathLength(this.graph, plan.slice(0, k + 1)) <=
        TURN_OFF.seenWithin[this.suspect.mode];
    if (!seen && !atCallPoint) return;
    // The scanner comes back to report it (the signal was lost).
    if (this.lostSince !== null) this.restoreSignal(events);
    if (this.playerStage !== turnOff.stage || this.pending || this.autoStage !== null) {
      this.turnOffPending = false;
      this.navigator.holdAfter = null;
      return;
    }
    if (callAt !== null && i !== -1 && i < callAt) return; // the directions up to there are right
    if (!atCallPoint && !this.clearOfJunctions()) return; // wait until there is time to take the correction in
    // Wait (a little) until the new directions can be heard before their first turn.
    const announce = callSeconds([EVENT_LINES.ATTENTION.text, EVENT_LINES.CHANGED_DIRECTION.text]);
    let navigator = this.nav(events);
    const onRoute = i !== -1 && navigator.canCallInTime(route.slice(i), here, announce);
    this.turnOffSeenAt ??= this.elapsed;
    const waited = this.elapsed - this.turnOffSeenAt;
    // ...but not past the end of the directions the player is following, nor for ever.
    const mustSay =
      waited >= TURN_OFF.maxWaitSeconds || navigator.toGuideEnd(here) < TURN_OFF.guideEndSeconds * navigator.speed;
    if (!onRoute && !mustSay && !navigator.canRedirectInTime(here, plan, announce)) return;
    // Near the end of its route, plan the way on first: the correction then leads on past the end.
    if (!onRoute) {
      this.keepGoingAhead(events, true);
      plan = this.suspect.remainingPlan();
    }
    this.turnOffPending = false;
    events.push({ type: 'ANNOUNCE', lines: [EVENT_LINES.ATTENTION, EVENT_LINES.CHANGED_DIRECTION] });
    navigator = this.nav(events);
    const transmissions = onRoute
      ? navigator.redirect(here, plan, this.destination, route.slice(i))
      : navigator.redirect(here, plan, this.destination);
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
    // Heard in full before anything moves: the first direction needs no hurry, and waits for nothing.
    this.navigator.firstCallBeforeStart = true;
    this.navigator.radioFreeIn = 0;
    const transmissions = this.navigator.update(this.player.location(), this.suspect.remainingPlan());
    for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
    this.navigator.firstCallBeforeStart = false; // any later call is timed as usual
    this.radioCounted = 0;
    this.hearRadio(events);
    // The chase starts when the call is over.
    this.radioFreeAt = 0;
    return events;
  }

  /** Count the lines in `events` not yet counted into `radioFreeAt` (the radio says them one after another). */
  private hearRadio(events: readonly ChaseEvent[]): void {
    for (let i = this.radioCounted; i < events.length; i++) {
      const e = events[i] as ChaseEvent;
      let texts: string[] = [];
      if (e.type === 'TRANSMISSION') texts = e.transmission.instructions.flatMap((ins) => ins.clips.map((c) => c.text));
      else if (e.type === 'ANNOUNCE') {
        texts = e.lines.map((l) => l.text);
        if (e.interrupt) this.radioFreeAt = Math.min(this.radioFreeAt, this.elapsed); // what was being said is cut off
      }
      else if (e.type === 'SIGHTING') texts = [e.line.text];
      // The game says one of these when the suspect pulls away: allow for the longer.
      else if (e.type === 'WARNING' && e.speak) texts = [OUTCOME_LINES.WARNING.text];
      if (texts.length > 0) this.radioFreeAt = Math.max(this.elapsed, this.radioFreeAt) + callSeconds(texts);
    }
    this.radioCounted = events.length;
  }

  /** The navigator, told how soon the radio is free and how fast the player is going. */
  private nav(events: readonly ChaseEvent[]): Navigator {
    this.hearRadio(events);
    this.navigator.radioFreeIn = this.radioFreeAt - this.elapsed;
    const mode = this.player.mode;
    this.navigator.speed = Math.max(MOVEMENT[mode].cruise, this.player.snapshot().speed);
    return this.navigator;
  }

  /** Where the suspect changes transport at the end of the player's current stage. */
  private get transferNode(): string {
    const route = this.stages[this.playerStage]?.route ?? [];
    return route[route.length - 1] as string;
  }

  /** Advance the chase by `dt` seconds. The caller moves nothing itself. */
  update(dt: number): ChaseEvent[] {
    this.radioCounted = 0;
    const events = this.advance(dt);
    this.hearRadio(events);
    return events;
  }

  private advance(dt: number): ChaseEvent[] {
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

    this.elapsed += dt;
    // The clock stops while the game holds the police still (waiting for the radio, a skid, a fall).
    const held = this.playerHeld();
    if (!held) this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.player.speedFactor = held ? 0 : 1;
    this.player.update(dt);
    // After a change of transport the whole chase waits for the first direction to be heard,
    // as it does for the opening call: the suspect gains nothing while the scanner speaks.
    this.suspect.update(this.changeHold ? 0 : dt);
    if (!this.suspectArrived && this.suspect.snapshot().waiting === 'ARRIVED') {
      if (this.suspectStage < this.lastStage) this.changeSuspectTransport(events);
      else this.keepGoing(events);
    } else if (this.suspectStage === this.lastStage && !this.suspectArrived) {
      this.keepGoingAhead(events);
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
        const transmissions = this.nav(events).update(here, ahead);
        for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
        if (this.holdForNextCall && this.turnedRound()) this.waitForCall(transmissions);
        this.holdForFirstCall(transmissions);
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
      // "Vite ! Le suspect s'éloigne !" only when the radio is free, and not again and again.
      this.hearRadio(events);
      // ...nor when a direction is due before it would be over: that comes first.
      const speak =
        warning &&
        this.radioFreeAt <= this.elapsed &&
        this.elapsed >= this.nextWarningLine &&
        this.nav(events).quietFor(this.player.location()) >= callSeconds([OUTCOME_LINES.WARNING.text]);
      if (speak) this.nextWarningLine = this.elapsed + WARNING_LINE_GAP;
      events.push({ type: 'WARNING', on: warning, ...(speak ? { speak } : {}) });
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
    let at = this.suspect.location();
    let route = this.routeOnwards(at.towards, at.edgeId, at.mode, this.stages[this.suspectStage]!.route);
    let turnedRound = false;
    if (!route && this.suspect.uTurn()) {
      at = this.suspect.location();
      route = this.routeOnwards(at.towards, at.edgeId, at.mode); // a new start: corrected like a change of direction
      turnedRound = true;
    }
    if (!route) {
      this.suspectArrived = true;
      events.push({ type: 'SUSPECT_ARRIVED' });
      return;
    }
    this.suspect = new Mover(this.graph, at);
    this.suspect.followPlan(route.nodes);
    this.suspect.speedFactor = this.suspectSpeedFor(this.suspectStage);
    this.goOn(route, turnedRound, events);
  }

  /**
   * Nearing the end of its route, the suspect plans the way on before it gets
   * there, so the scanner can give the next turn in good time (a turn planned
   * only on arrival would come too late for a player close behind).
   */
  private keepGoingAhead(events: ChaseEvent[], now = false): void {
    const plan = this.suspect.remainingPlan();
    const me = this.suspect.snapshot();
    let left = distance(me, this.graph.node(plan[0] as string)) + pathLength(this.graph, plan);
    // A player close behind (or level) may reach the end first: the way on must be called before they get there.
    if (this.playerStage === this.suspectStage && !this.guidedByPrediction) {
      left = Math.min(left, this.navigator.toGuideEnd(this.player.location()));
    }
    if (left > KEEP_GOING.aheadMetres[me.mode] * (now ? 2 : 1)) return;
    const end = plan[plan.length - 1] as string;
    const before = plan.length >= 2 ? (plan[plan.length - 2] as string) : this.graph.other(this.graph.edge(me.edgeId), me.towards);
    const lastEdge = this.graph.edgeBetween(before, end);
    if (!lastEdge || (!now && this.elapsed < this.nextAheadTry)) return;
    const route = this.routeOnwards(end, lastEdge.id, me.mode, this.stages[this.suspectStage]!.route, true);
    // Planning is costly: after a miss, wait a little longer each time before trying again.
    this.aheadMisses = route ? 0 : this.aheadMisses + 1;
    this.nextAheadTry = this.elapsed + Math.min(KEEP_GOING.retrySeconds * 2 ** this.aheadMisses, KEEP_GOING.maxRetrySeconds);
    if (!route) {
      // Boxed in for now: drive on straight one more block (no turn to call) and plan from there.
      const straight = exitsAt(this.graph, lastEdge, end, me.mode).find((e) => e.kind === 'STRAIGHT');
      const next = straight?.step.to;
      // (Not onto a roundabout: its exit would have to be called at once.)
      const ring = next !== undefined && me.mode === 'CAR' && this.graph.node(next).roundaboutId !== undefined;
      if (!next || ring || this.stages[this.suspectStage]!.route.includes(next)) {
        this.branchEarlier(plan, me, events); // or leave the route a little before its end
        return; // on arrival, `keepGoing` tries again (turning round if it must)
      }
      const block = { nodes: [end, next], length: this.graph.edgeLength(straight.step.edge), destination: this.destination };
      this.suspect.followPlan([...plan, next]);
      this.goOn(block, false, events);
      return;
    }
    this.suspect.followPlan([...plan, ...route.nodes.slice(1)]);
    this.goOn(route, false, events);
  }

  /** The player is still being guided along the route predicted before a change of direction. */
  private get guidedByPrediction(): boolean {
    return this.turnOffPending && this.scenario.turnOff?.stage === this.suspectStage;
  }

  /**
   * No callable way on from the end of the route: try leaving it at one of
   * the last few junctions before the end that no call has mentioned yet.
   */
  private branchEarlier(plan: readonly string[], me: { edgeId: string; towards: string; mode: TravelMode }, events: ChaseEvent[]): void {
    const stage = this.stages[this.suspectStage]!;
    const sameStage = this.playerStage === this.suspectStage;
    if (sameStage && this.guidedByPrediction) return; // the player's directions follow the predicted route
    for (let idx = plan.length - 2; idx >= Math.max(0, plan.length - 1 - KEEP_GOING.branchBackNodes); idx--) {
      const node = plan[idx] as string;
      if (sameStage && !this.navigator.canReroute(node)) continue;
      const prev = idx > 0 ? (plan[idx - 1] as string) : this.graph.other(this.graph.edge(me.edgeId), me.towards);
      const arrived = this.graph.edgeBetween(prev, node);
      const k = stage.route.lastIndexOf(node);
      if (!arrived || k === -1) continue;
      const before = stage.route.slice(0, k + 1);
      const route = this.routeOnwards(node, arrived.id, me.mode, before, true);
      if (!route) continue;
      const nodes = [...before, ...route.nodes.slice(1)];
      this.stages[this.suspectStage] = { ...stage, route: nodes, length: pathLength(this.graph, nodes) };
      this.destination = route.destination;
      this.suspect.followPlan([...plan.slice(0, idx + 1), ...route.nodes.slice(1)]);
      if (!sameStage) return;
      const transmissions = this.nav(events).reroute(this.player.location(), node, route.nodes, this.destination) ?? [];
      for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
      return;
    }
  }

  /** A fresh route on from `from` (not back along `avoidEdge`), away from the police: luck must not catch what listening would. */
  private routeOnwards(
    from: string,
    avoidEdge: string,
    mode: TravelMode,
    before: readonly string[] = [],
    /** Only ways on whose first turn can be called in time after the route so far. */
    strict = false,
  ) {
    const me = this.player.snapshot();
    const clear = this.settings.sightingDistance * KEEP_GOING.clearSightings;
    const away = (nodes: readonly string[]) => {
      const start = this.graph.node(nodes[0] as string);
      const end = this.graph.node(nodes[nodes.length - 1] as string);
      return distance(end, me) > distance(start, me) + clear && nodes.every((n) => distance(this.graph.node(n), me) > clear);
    };
    const length = this.settings.stageLength[mode];
    return (
      this.escapeRoute(from, avoidEdge, mode, length, away, before) ??
      this.escapeRoute(from, avoidEdge, mode, [length[0] / 2, length[1]], away, before) ??
      this.escapeRoute(from, avoidEdge, mode, [length[0] / 2, length[1]], undefined, before) ??
      this.escapeRoute(from, avoidEdge, mode, [length[0] / 6, length[1]], undefined, before) ??
      (strict ? null : this.looseRouteOnwards(from, avoidEdge, mode, length, before))
    );
  }

  /** On arrival with no better way on: better a first turn called a little late than turning round. */
  private looseRouteOnwards(from: string, avoidEdge: string, mode: TravelMode, length: [number, number], before: readonly string[]) {
    return (
      (before.length > 0 ? this.escapeRoute(from, avoidEdge, mode, [length[0] / 2, length[1]]) : null) ??
      // A short way on still beats turning round into the police (it carries on again at its end).
      this.escapeRoute(from, avoidEdge, mode, [length[0] / 6, length[1]])
    );
  }

  /** The suspect's route has grown by `route`: the stage, the destination and the directions follow. */
  private goOn(route: { nodes: string[]; length: number; destination: string }, turnedRound: boolean, events: ChaseEvent[]): void {
    const stage = this.stages[this.suspectStage]!;
    this.stages[this.suspectStage] = { ...stage, route: [...stage.route, ...route.nodes.slice(1)], length: stage.length + route.length };
    this.destination = route.destination;
    if (this.playerStage !== this.suspectStage) return; // the next stage's directions already follow the longer route
    if (this.guidedByPrediction) return; // the change of direction, still to come, redirects onto the longer route
    const here = this.player.location();
    // Driving on: the directions already given stand and the next ones follow the longer
    // route. Turned round: that is a change of direction, corrected like any other.
    const transmissions =
      (turnedRound ? null : this.nav(events).extend(here, route.nodes, this.destination)) ??
      this.nav(events).redirect(here, this.suspect.remainingPlan(), this.destination);
    if (turnedRound) events.push({ type: 'ANNOUNCE', lines: [EVENT_LINES.ATTENTION, EVENT_LINES.CHANGED_DIRECTION] });
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
      // A colleague brings the police car to the road the officer will have reached by the time
      // "Montez dans la voiture !" has been said: the chase does not stop for the radio.
      lines.push(TRANSPORT_LINES.GET_IN);
      this.hearRadio(events);
      const heard = Math.max(0, this.radioFreeAt - this.elapsed) + callSeconds(lines.map((l) => l.text)) + SPEECH.reactSeconds;
      const ahead = this.navigator.pointAhead(this.player.location(), heard * MOVEMENT.FOOT.cruise);
      this.parkedCar = nearestRoad(this.graph, ahead);
      this.carBrought = true;
      this.pending.announced = true;
    }
    events.push({ type: 'ANNOUNCE', lines });
  }

  /** Metres of road to where the suspect changed transport, along the directions (Infinity if off them). */
  private roadToTransfer(): number {
    const here = this.player.location();
    if (!this.navigator.track(here)) return Infinity;
    return this.navigator.distanceTo(here, this.transferNode);
  }

  /** Held still after a dodge or a crash (see `held` and `crashHold`). */
  private playerHeld(): boolean {
    // The police car pulls up where the suspect left its car, and waits there for the player to get out.
    if (this.player.mode === 'CAR' && this.pending?.mode === 'FOOT' && this.autoStage === null) {
      if (this.roadToTransfer() <= TRANSFER.pullUpWithin) return true;
    }
    if (this.changeHold) {
      if (this.elapsed < this.changeHold.until) return true;
      this.changeHold = null;
    }
    // On foot, the officer waits by the police car a colleague has brought ("Montez dans la voiture !").
    if (this.player.mode === 'FOOT' && this.pending?.mode === 'CAR' && this.carBrought && this.parkedCar) {
      if (distance(this.player.snapshot(), pointOf(this.graph, this.parkedCar)) <= TRANSFER.waitByCarWithin) return true;
    }
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
    /** The route so far, ending at `from`, when this one carries it on (its turns must be called in time together). */
    before: readonly string[] = [],
  ): { nodes: string[]; length: number; destination: string } | null {
    // (reassigned below when it does not end at `from`)
    const { difficulty } = this.scenario;
    // Every turn can be called in time at full speed (the chase never slows down for the French).
    const ctx = stageCallContext(mode, difficulty, this.hasAudio);
    if (before[before.length - 1] !== from) before = [];
    const lastTurn = before.length > 1 ? Math.max(0, ...actionIndices(this.graph, before, mode)) : 0;
    const tail = before.slice(lastTurn > 0 ? lastTurn - 1 : Math.max(0, before.length - 2));
    try {
      const route = generateRoute(
        this.graph,
        this.escapeRng,
        {
          length,
          mode,
          from,
          avoidEdge,
          // Cheapest checks first: describing a whole route is the costly part.
          accept: (nodes) =>
            extra(nodes) &&
            turnsOftenEnough(this.graph, nodes, mode) &&
            (tail.length > 1 ? carriesOnCallable(this.graph, [...tail, ...nodes.slice(1)], ctx) : callable(this.graph, nodes, ctx)) &&
            describable(this.graph, nodes, mode, difficulty),
          minTurnGap: CALL_ROUTES.minTurnGap[mode],
          ...(lastTurn > 0 ? { sinceTurn: pathLength(this.graph, before.slice(lastTurn)) } : {}),
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
      interrupt: true,
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
    // It heads away from the police and does not loop back past them: not through the junction ahead
    // of them, nor (ideally) any street out of it, or at least not the one they may skid on into.
    const playerEdge = this.graph.edge(here.edgeId);
    const near = new Set([here.towards, this.graph.other(playerEdge, here.towards)]);
    const exits = exitsAt(this.graph, playerEdge, here.towards, here.mode);
    const around = new Set(exits.map((e) => e.step.to));
    const skidOn = exits.reduce<Exit | null>((best, e) => (!best || Math.abs(e.relativeAngle) < Math.abs(best.relativeAngle) ? e : best), null);
    const beyond = new Set(skidOn ? [skidOn.step.to] : []);
    const followable = (avoid: ReadonlySet<string>) => (nodes: readonly string[]) =>
      nodes.every((n, i) => i === 0 || (!near.has(n) && (i === 1 || !avoid.has(n)))) &&
      (planGuide(this.graph, here, nodes, this.scenario.difficulty)?.guide.slice(1).includes(nodes[1] as string) ?? false);
    const length = DODGE.routeLength[at.mode];
    // Ideally every turn of it can be called in time (the player is held while the correction is said).
    // (A shorter route carries on like any other, at its end.)
    const route =
      this.escapeRoute(back, edge.id, at.mode, length, followable(around)) ??
      this.escapeRoute(back, edge.id, at.mode, length, followable(beyond)) ??
      this.escapeRoute(back, edge.id, at.mode, [length[0] / 2, length[1]], followable(around)) ??
      this.escapeRoute(back, edge.id, at.mode, [length[0] / 2, length[1]], followable(beyond));
    if (!route || !this.suspect.uTurn()) return false;
    this.suspect.followPlan(route.nodes);
    this.destination = route.destination;
    // Its route from here on (so a way on from its end carries on from this one).
    const nodes = [at.towards, ...route.nodes];
    this.stages[this.suspectStage] = { ...this.stages[this.suspectStage]!, route: nodes, length: pathLength(this.graph, nodes) };
    this.timeLeft += DODGE.extraSeconds[at.mode];
    this.noCaptureBefore = this.elapsed + DODGE.graceSeconds;
    // Turns it was about to take no longer lead to the suspect.
    this.player.clearQueue();
    // The police car skids to a stop, or the officer falls; the correction follows once they have stopped.
    this.held = { edgeId: '', towards: '', minUntil: this.elapsed + DODGE.holdSeconds, maxUntil: 0 };
    this.correctionDue = true;
    this.downUntil = this.elapsed + DODGE.downSeconds[at.mode];
    events.push({ type: 'SUSPECT_DODGE', mode: at.mode });
    events.push({ type: 'ANNOUNCE', lines: [EVENT_LINES.ATTENTION, EVENT_LINES.CHANGED_DIRECTION], interrupt: true });
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
      ? this.nav(events).redirect(here, plan, this.destination, guide, onto!.uTurn)
      : this.nav(events).redirect(here, plan, this.destination);
    for (const transmission of corrections) events.push({ type: 'TRANSMISSION', transmission });
    const turnRound = corrections.some((t) => t.instructions.some((i) => i.clauses.some((c) => c.action === 'U_TURN')));
    // The correction waits for anything the radio is still saying.
    const wait = Math.max(0, this.radioFreeAt - this.elapsed);
    const heard = wait + speechSeconds(firstStep(corrections[0]?.text ?? '')) + SPEECH.reactSeconds;
    this.holdForNextCall = turnRound;
    this.held = {
      edgeId: here.edgeId,
      towards: here.towards,
      minUntil: Math.max(this.downUntil, this.elapsed + (turnRound ? 0 : heard)),
      maxUntil: this.elapsed + (turnRound ? wait + DODGE.holdSeconds : 0),
    };
  }

  /** Turned round after a dodge: stay put until the first call from here has been said. */
  /** After a change of transport: stay put until the first direction (just said) has been heard. */
  private holdForFirstCall(transmissions: readonly Transmission[]): void {
    if (!this.changeHold?.armed) return;
    const call = transmissions.find((t) => t.kind === 'DIRECTION' || t.kind === 'FILLER' || t.kind === 'FINAL');
    if (!call) return;
    const wait = Math.max(0, this.navigator.radioFreeIn - callSeconds(call.instructions.flatMap((i) => i.clips.map((c) => c.text))));
    this.changeHold = { armed: false, until: this.elapsed + wait + speechSeconds(firstStep(call.text)) + SPEECH.reactSeconds };
  }

  private waitForCall(transmissions: readonly Transmission[]): void {
    const call = transmissions.find((t) => t.kind === 'DIRECTION' || t.kind === 'FILLER');
    if (!call) return;
    this.holdForNextCall = false;
    const here = this.player.location();
    const until = this.elapsed + speechSeconds(firstStep(call.text)) + SPEECH.reactSeconds;
    this.held = { edgeId: here.edgeId, towards: here.towards, minUntil: until, maxUntil: 0 };
  }

  /**
   * The suspect has just passed the next planned sighting's place: report it
   * and pause for the answer.
   * The suspect may already be in view: the question is then easier. Skipped
   * if the signal is lost or the player is being moved between stages. Waits
   * until the scanner has finished what it is saying.
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
    // Not over a call still being heard: the time to answer starts with the sighting line.
    if (this.radioFreeAt > this.elapsed) return;
    const index = this.nextSighting++;
    if (this.lostSince !== null || this.autoStage !== null) return;
    const seconds = this.settings.sightings.pickSeconds;
    this.check = { index, secondsLeft: seconds };
    events.push({ type: 'SIGHTING', line: sightingLine(sighting.named, sighting.place), cards: sighting.cards, seconds });
  }

  /** The player picks a sighting choice (index into the cards). Returns what follows. */
  answerSighting(choice: number): ChaseEvent[] {
    this.radioCounted = 0;
    const events = this.answerSightingNow(choice);
    this.hearRadio(events);
    return events;
  }

  private answerSightingNow(choice: number): ChaseEvent[] {
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
    for (const transmission of this.nav(events).resume(here, ahead)) events.push({ type: 'TRANSMISSION', transmission });
  }

  private restoreSignal(events: ChaseEvent[]): void {
    this.lostSince = null;
    events.push({ type: 'SIGNAL', lost: false });
  }

  /** "Descendez de la voiture !" once the player has driven up to where the suspect got out. */
  private orderGetOut(events: ChaseEvent[]): void {
    if (!this.pending || this.pending.announced || this.pending.mode !== 'FOOT') return;
    // Said so it is heard out, with time to react, as the car reaches the place (after anything
    // the radio is still saying), and not long before: it means "now".
    this.hearRadio(events);
    const road = this.roadToTransfer();
    const wait = Math.max(0, this.radioFreeAt - this.elapsed);
    const needed = (wait + callSeconds([TRANSPORT_LINES.GET_OUT.text]) + SPEECH.reactSeconds) * MOVEMENT.CAR.cruise;
    const near = Number.isFinite(road)
      ? road <= needed + TRANSFER.getOutWithin
      : distance(this.player.snapshot(), this.graph.node(this.transferNode)) <= TRANSFER.getOutWithin;
    if (!near) return;
    this.pending.announced = true;
    events.push({ type: 'ANNOUNCE', lines: [TRANSPORT_LINES.GET_OUT] });
  }

  /**
   * The player gets out of the car, or back in (within reach of it). Returns
   * the events that follow, such as the first direction of a new stage.
   */
  toggleMode(): { result: ModeChangeResult; events: ChaseEvent[] } {
    this.radioCounted = 0;
    const done = this.toggleModeNow();
    this.hearRadio(done.events);
    return done;
  }

  private toggleModeNow(): { result: ModeChangeResult; events: ChaseEvent[] } {
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
    // Just out of (or into) the car: wait for the first direction of the new stage to be heard.
    if (this.autoStage === null && !this.changeHold) {
      this.changeHold = { armed: true, until: this.elapsed + TRANSFER.firstCallWaitSeconds };
    }
    this.holdForFirstCall(events.flatMap((e) => (e.type === 'TRANSMISSION' ? [e.transmission] : [])));
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
    // A new stage: wait for its first direction to be heard.
    this.changeHold = { armed: true, until: this.elapsed + TRANSFER.firstCallWaitSeconds };
    const transmissions = this.nav(events).update(this.player.location(), this.suspect.remainingPlan());
    for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
    this.holdForFirstCall(transmissions);
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
    if (result.allowed) {
      this.timeLeft = Math.max(0, this.timeLeft - result.penaltySeconds);
      // The call is said again: the next direction waits for it.
      const last = this.navigator.last;
      if (last) this.radioFreeAt = Math.max(this.elapsed, this.radioFreeAt) + callSeconds(last.instructions.flatMap((i) => i.clips.map((c) => c.text)));
    }
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

/**
 * A route that carries on from the last turn of an earlier one (`nodes`
 * starts just before that turn, which has already been called): can every
 * turn after it be called in time?
 */
function carriesOnCallable(graph: TownGraph, nodes: readonly string[], ctx: CallContext): boolean {
  const plan = planCalls(graph, nodes, ctx);
  return plan.solvable(plan.actions[0] === 1 ? 1 : 0);
}
