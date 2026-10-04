/**
 * Escape Mode: the roles switched (Mr Henry, 2026-10-03). The player is the
 * suspect, fleeing to the hideout ("la planque") in a car or on foot, guided
 * by their partner on the radio; a police car (then an officer on foot)
 * follows by the shortest way, a little slower than the player.
 *
 *   right turns → the police stay behind, the hideout comes closer
 *   wrong turn, detour or hesitation → the police close in
 *   police within reach for long enough → "Vous êtes arrêté !" (the chase is lost)
 *   the end of the route reached → "Bravo ! Vous avez semé la police !"
 *   out of time → a roadblock: arrested
 *
 * The directions are the same recorded French as the chase: the partner tells
 * the player where to go ("vous"), from the same generated route; only the
 * recoveries plan the shortest way to the hideout rather than onto a moving
 * suspect. Changes of transport are the player's own ("Descendez de la
 * voiture !" at the end of a car stage, "Montez dans la voiture !" where a
 * getaway car waits); the police change where the player did.
 *
 * It reports through the chase's event and status types so the same HUD,
 * controls, listener bot and scoring serve both: CAPTURED means the player
 * was arrested, ESCAPED (reason HIDEOUT) that they got away.
 */

import { ESCAPE_LINES, TRANSPORT_LINES } from '../audio/script';
import { RepeatCounter, type RepeatResult } from '../audio/repeat';
import { DIFFICULTY_SETTINGS } from '../difficulty';
import { describable, type AudioCheck } from '../language/generate';
import { Navigator, planEscapeGuide, type Transmission } from '../language/navigator';
import { Mover, type MoverStart } from '../movement/mover';
import { MOVEMENT } from '../movement/settings';
import { exitsAt } from '../movement/turns';
import { Rng } from '../rng/prng';
import { distance } from '../world/geometry';
import { canTravel, type TownGraph, type TravelMode } from '../world/graph';
import { pointOf, type ChaseEvent, type ChaseStatus, type ModeChangeResult, type SpokenText } from './chase';
import { roadDistance } from './distance';
import { pathLength, placeOnRoute } from './route';
import { callSeconds } from '../language/timing';
import type { ChaseScenario, ChaseStage } from './scenario';
import { CALL_TIMING, CHASE_SETTINGS, ESCAPE, TRANSFER, type ChaseSettings } from './settings';

export class Escape {
  /** The player: the suspect on the run. */
  player: Mover;
  /** The police on their tail. */
  police: Mover;
  navigator: Navigator;
  /** The getaway car waiting for the player (a foot stage ending in a car), or the one they left. */
  parkedCar: MoverStart | null = null;
  abandonedCar: MoverStart | null = null;
  /** The police car, left where the officer got out to follow on foot. */
  policeParked: MoverStart | null = null;
  /** Which stage the player and the police are on. */
  stage = 0;
  policeStage = 0;
  readonly stages: ChaseStage[];
  readonly destination: string;
  readonly timeLimit: number;
  private timeLeft: number;
  private elapsed = 0;
  private phase: ChaseStatus['phase'] = 'PURSUIT';
  private readonly settings: ChaseSettings;
  private readonly repeats: RepeatCounter;
  private readonly hasAudio: AudioCheck | undefined;
  private started = false;
  private distance: number;
  private closeFor = 0;
  private seen = false;
  private near = false;
  private lost = false;
  /** "Juste derrière vous" is not said again until they have fallen back. */
  private closeSaid = false;
  /** News of the police waiting for a quiet moment on the radio (see report). */
  private closeNews = false;
  /** After a change of transport the police wait until the new stage's first direction has been heard (see waitForFirstCall). */
  private policeWait: { firstCall: boolean; until: number } | null = null;
  private lostNews: SpokenText | null = null;
  /** The player must change to this mode; `announced` once the order has been given. */
  private pending: { mode: TravelMode; announced: boolean } | null = null;
  /** When the order to change transport was last said (elapsed seconds), and how long the player has been stopped at a junction. */
  private orderSaidAt = 0;
  private stoppedFor = 0;
  /** When a direction was last given, and when the partner last spoke up for a stuck player (elapsed seconds). */
  private heardAt = 0;
  private promptedAt = -Infinity;
  /** Set while the player is being taken to the start of this stage. */
  private autoStage: number | null = null;
  /** Where the player last changed transport, for the police to do the same. */
  private changePoint: { at: MoverStart; mode: TravelMode } | null = null;
  /**
   * The police follow the player's trail: from where the player was last seen
   * (or changed transport), the junctions they passed, in order. Only with the
   * player in sight do they take the shortest way and cut corners, so a route
   * that loops round a block never hands them the player; out of sight again
   * (beyond the level's warningDistance) they pick up the trail from where
   * they last saw them. The trail starts with the street the player was on.
   */
  private trail: string[] = [];
  private trailing = true;
  /** How far behind the player the police are on the player's own street (Infinity elsewhere): an arrest comes from behind. */
  private behind = Infinity;
  /** The furthest node of the stage route the player has reached (index). */
  private furthest = 0;
  /** When the radio is next free (elapsed seconds); see Chase.radioFreeAt. */
  private radioFreeAt = 0;
  private radioCounted = 0;
  /**
   * Metres of head start the police still have to make up before they are on
   * the map: the streets behind the start are too short for all of it, so
   * "La police arrive" from off the edge of town, this far back.
   */
  private policeBehind = 0;
  private escapeReason?: ChaseStatus['escapeReason'];
  /** The police's speed as a share of the player's: the level's, or the officer's in the escape campaign. */
  private readonly policeSpeed: number;

  constructor(
    private readonly graph: TownGraph,
    readonly scenario: ChaseScenario,
    options: { hasAudio?: AudioCheck; policeSpeed?: number } = {},
  ) {
    this.hasAudio = options.hasAudio;
    this.policeSpeed = options.policeSpeed ?? ESCAPE.policeSpeed[scenario.difficulty];
    this.settings = CHASE_SETTINGS[scenario.difficulty];
    this.stages = scenario.stages.map((st) => ({ ...st, route: [...st.route] }));
    this.destination = scenario.destination;
    const travel = this.stages.reduce((s, st) => s + st.length / MOVEMENT[st.mode].cruise, 0);
    // The clock is the roadblocks going up: enough for the route with time to spare, not for wandering.
    this.timeLimit = Math.round(travel * ESCAPE.timeFactor[scenario.difficulty] + (this.stages.length - 1) * TRANSFER.extraSeconds);
    this.timeLeft = this.timeLimit;
    this.repeats = new RepeatCounter(DIFFICULTY_SETTINGS[scenario.difficulty].repeat);
    // The player starts where the police would in a chase (the first call has
    // room to be heard); the police start the same head start back, on the
    // streets behind the start of the route.
    this.player = new Mover(graph, scenario.playerStart);
    this.startTrail();
    this.police = this.policeAtStart();
    this.navigator = this.navigatorFor(0);
    this.distance = this.measure();
  }

  private get lastStage(): number {
    return this.stages.length - 1;
  }

  /**
   * The police, the level's head start behind the player: back along the
   * streets that lead into the start of the route (keeping as straight as the
   * town allows, never along the route itself), with a plan to the start.
   * Where those streets run out, the rest of the head start is time off the
   * map (`policeBehind`).
   */
  private policeAtStart(): Mover {
    const { route, mode } = this.stages[0]!;
    const headStart = this.settings.headStart[mode];
    const tail: string[] = [route[0] as string];
    let node = route[0] as string;
    let ahead = route[1] as string;
    let length = 0;
    while (length < headStart) {
      let best: { node: string; edge: ReturnType<TownGraph['edge']>; straightness: number } | null = null;
      for (const edge of this.graph.edgesAt(node)) {
        const from = this.graph.other(edge, node);
        // Never a junction of the route itself: the player must not drive back into the police.
        if (from === ahead || tail.includes(from) || route.includes(from) || !canTravel(edge, mode, from)) continue;
        const a = this.graph.node(from);
        const b = this.graph.node(node);
        const c = this.graph.node(ahead);
        const straightness = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
        if (!best || straightness > best.straightness) best = { node: from, edge, straightness };
      }
      if (!best) break;
      length += this.graph.edgeLength(best.edge);
      tail.unshift(best.node);
      ahead = node;
      node = best.node;
    }
    this.policeBehind = Math.max(0, headStart - length);
    const police = new Mover(this.graph, tail.length > 1 ? placeOnRoute(this.graph, tail, length - headStart + this.policeBehind, mode).start : this.player.location());
    police.speedFactor = this.policeSpeed;
    if (tail.length > 2) {
      try {
        police.followPlan(tail.slice(tail.indexOf(police.snapshot().towards)));
      } catch {
        /* the pursuit plans from here */
      }
    }
    return police;
  }

  private navigatorFor(stage: number): Navigator {
    const { scenario } = this;
    const st = this.stages[stage]!;
    const navigator = new Navigator(
      this.graph,
      scenario.difficulty,
      Rng.fromSeed(scenario.seed).fork(stage === 0 ? 'language' : `language-${stage}`),
      st.route,
      stage === this.lastStage ? this.destination : null,
      st.mode,
      this.hasAudio,
    );
    navigator.planner = planEscapeGuide;
    return navigator;
  }

  /** Where the getaway car waits for a car stage. */
  stageStart(stage: number): MoverStart {
    const st = this.stages[stage]!;
    return placeOnRoute(this.graph, st.route, ESCAPE.carAheadMetres, st.mode).start;
  }

  /** The partner's opening call: "Allez à la planque ! La police arrive." then the first direction. */
  openingCall(): ChaseEvent[] {
    const events: ChaseEvent[] = [];
    if (this.started || this.phase !== 'PURSUIT') return events;
    this.started = true;
    events.push({ type: 'ANNOUNCE', lines: [ESCAPE_LINES.OPENING] });
    this.navigator.firstCallBeforeStart = true;
    this.navigator.radioFreeIn = 0;
    const transmissions = this.navigator.update(this.player.location(), this.remainingRoute());
    for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
    this.navigator.firstCallBeforeStart = false; // any later call is timed as usual
    // Heard in full before anything moves.
    this.radioFreeAt = 0;
    return events;
  }

  /** Count the lines in `events` not yet counted into `radioFreeAt`. */
  private hearRadio(events: readonly ChaseEvent[]): void {
    for (let i = this.radioCounted; i < events.length; i++) {
      const e = events[i] as ChaseEvent;
      let texts: string[] = [];
      if (e.type === 'TRANSMISSION') texts = e.transmission.instructions.flatMap((ins) => ins.clips.map((c) => c.text));
      else if (e.type === 'ANNOUNCE') texts = e.lines.map((l) => l.text);
      // A way back cuts off whatever the radio was still saying (the scene interrupts it): it does not queue behind it.
      const fresh = e.type === 'TRANSMISSION' && e.transmission.kind === 'RECOVERY' && !['TRANSMISSION', 'ANNOUNCE'].includes(events[i - 1]?.type ?? '');
      if (texts.length > 0) this.radioFreeAt = (fresh ? this.elapsed : Math.max(this.elapsed, this.radioFreeAt)) + callSeconds(texts);
    }
    this.radioCounted = events.length;
  }

  /** The navigator, told how soon the radio is free and how fast the player is going. */
  private nav(events: readonly ChaseEvent[]): Navigator {
    this.hearRadio(events);
    this.navigator.radioFreeIn = this.radioFreeAt - this.elapsed;
    this.navigator.speed = Math.max(MOVEMENT[this.player.mode].cruise, this.player.snapshot().speed);
    return this.navigator;
  }

  /** Is the player on their stage route, going the right way? */
  private onRoute(): boolean {
    const here = this.player.location();
    const route = this.stages[this.stage]!.route;
    const k = route.indexOf(here.towards);
    return k > 0 && this.graph.edgeBetween(route[k - 1] as string, here.towards)?.id === here.edgeId;
  }

  /** The rest of the stage route from the furthest node reached (starting with the next node). */
  private remainingRoute(): string[] {
    return this.stages[this.stage]!.route.slice(this.furthest + 1);
  }

  /** Where the player changes transport at the end of their stage. */
  private get transferNode(): string {
    const route = this.stages[this.stage]!.route;
    return route[route.length - 1] as string;
  }

  /** Advance by `dt` seconds. The caller moves nothing itself. */
  update(dt: number): ChaseEvent[] {
    this.radioCounted = 0;
    const events = this.advance(dt);
    this.hearRadio(events);
    return events;
  }

  private advance(dt: number): ChaseEvent[] {
    const events: ChaseEvent[] = [];
    if (this.phase !== 'PURSUIT') return events;
    if (!this.started) {
      this.started = true;
      events.push({ type: 'ANNOUNCE', lines: [ESCAPE_LINES.OPENING] });
    }
    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    const wasOn = this.player.location().edgeId;
    const passed = this.player.update(dt);
    // Progress along the route counts only when driven along it: crossing a later
    // junction of the route from a side street must not skip the rest of it
    // (the way back is planned onto what is left).
    const route = this.stages[this.stage]!.route;
    let from = passed.length > 0 ? this.graph.other(this.graph.edge(wasOn), passed[0] as string) : '';
    for (const node of passed) {
      const i = route.indexOf(node, this.furthest + 1);
      if (i === this.furthest + 1 && route[i - 1] === from) this.furthest = i;
      from = node;
    }
    if (this.trailing) this.trail.push(...passed);
    this.movePolice(dt, passed.length > 0);
    this.switchPolice();

    if (this.autoStage !== null && this.player.snapshot().waiting === 'ARRIVED') this.beginStage(this.autoStage, events);
    this.orderChange(events);
    if (!this.pending?.announced && this.autoStage === null) {
      const here = this.player.location();
      const foot = here.mode === 'FOOT';
      this.navigator.leadDistance = foot ? CALL_TIMING.footLeadSeconds[this.scenario.difficulty] * MOVEMENT.FOOT.cruise : Infinity;
      this.navigator.minLeadDistance = foot ? CALL_TIMING.footMinLeadSeconds * MOVEMENT.FOOT.cruise : 0;
      const transmissions = this.nav(events).update(here, this.remainingRoute());
      for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
    }
    this.waitForFirstCall(events);
    this.neverQuiet(dt, events);

    this.distance = this.measure();
    this.report(events);

    if (this.stage === this.lastStage && this.atHideout(passed, wasOn)) {
      this.phase = 'ESCAPED';
      this.escapeReason = 'HIDEOUT';
      events.push({ type: 'ESCAPED', reason: 'HIDEOUT' });
      return events;
    }
    const s = this.settings;
    const canCapture = this.player.mode === this.police.mode && this.policeBehind <= 0;
    this.closeFor = this.behind <= s.captureDistance && canCapture ? this.closeFor + dt : 0;
    if (this.closeFor > 0 && this.closeFor >= s.captureHold) {
      this.phase = 'CAPTURED';
      events.push({ type: 'CAPTURED' });
    } else if (this.timeLeft <= 0) {
      // Out of time: the roadblocks are up.
      this.phase = 'CAPTURED';
      this.escapeReason = 'TIME';
      events.push({ type: 'CAPTURED' });
    }
    return events;
  }

  /**
   * The partner never leaves a stuck player in silence: the order to change
   * transport is said again while it has not been done, and a player stopped
   * at a junction, or lost off the way with nothing said for a while, hears
   * the way on from where they are (again every so often while it lasts).
   */
  private neverQuiet(dt: number, events: ChaseEvent[]): void {
    if (events.some((e) => e.type === 'TRANSMISSION')) this.heardAt = this.elapsed;
    if (this.autoStage !== null || this.elapsed < this.radioFreeAt) return;
    if (this.pending?.announced) {
      if (this.elapsed - this.orderSaidAt < ESCAPE.orderAgainSeconds) return;
      this.orderSaidAt = this.elapsed;
      events.push({ type: 'ANNOUNCE', lines: [this.pending.mode === 'CAR' ? TRANSPORT_LINES.GET_IN : TRANSPORT_LINES.GET_OUT] });
      return;
    }
    const here = this.player.location();
    const stopped = this.player.snapshot().waiting === 'JUNCTION';
    this.stoppedFor = stopped ? this.stoppedFor + dt : 0;
    const due = stopped
      ? this.stoppedFor >= ESCAPE.stoppedSeconds
      : this.navigator.isOffGuide(here) && this.elapsed - this.heardAt >= ESCAPE.offGuideSeconds;
    if (!due || this.elapsed - this.promptedAt < ESCAPE.orderAgainSeconds) return;
    this.promptedAt = this.elapsed;
    const transmissions = this.nav(events).prompt(here, this.remainingRoute());
    for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
    if (transmissions.length > 0) this.heardAt = this.elapsed;
  }

  /** Once the new stage's first direction has been given, the police wait only until it has been heard. */
  private waitForFirstCall(events: readonly ChaseEvent[]): void {
    if (!this.policeWait?.firstCall || this.autoStage !== null || !events.some((e) => e.type === 'TRANSMISSION')) return;
    this.hearRadio(events);
    this.policeWait = { firstCall: false, until: Math.min(this.policeWait.until, this.radioFreeAt) };
  }

  /** The police follow the player by the shortest way, choosing again at every junction. */
  private movePolice(dt: number, playerTurned = false): void {
    if (this.policeWait) {
      if (this.elapsed < this.policeWait.until) return;
      this.policeWait = null;
    }
    if (this.policeBehind > 0) {
      // Still on their way from off the map: not moving yet, but closing.
      this.policeBehind -= dt * MOVEMENT[this.police.mode].cruise * this.police.speedFactor;
      if (this.policeBehind > 0) return;
      this.policeBehind = 0;
      this.pursue();
    }
    const cop = this.police.snapshot();
    if (cop.waiting) {
      // Boxed in, or a plan it could not take: start again from here, turning round if there is no other way.
      this.police = new Mover(this.graph, this.police.location());
      this.police.speedFactor = this.policeSpeed;
      if (!this.pursue()) {
        this.police.uTurn();
        this.pursue();
      }
    }
    const passed = this.police.update(dt);
    // The trail is used up in order: a junction of it passed on the way to join it is not a short cut.
    for (const node of passed) if (node === this.trail[0]) this.trail.shift();
    // Plan again at every junction the police pass, and whenever the player passes one (a turn to follow).
    if (passed.length > 0 || playerTurned) this.pursue();
  }

  /**
   * Plan the police's way: along the player's trail while they are out of
   * sight (to where they were last seen, then the junctions they passed), or
   * the shortest way onto their street with the player in sight, or to the
   * spot where the player changed transport while the police are still in the
   * other mode. The plan runs on past the target (one more node) so the
   * pursuit never brakes for the end of its plan. Never straight back the way
   * it came: a plan that needs a U-turn is refused (false), and the chase
   * turns the police round itself.
   */
  private pursue(): boolean {
    const cop = this.police.snapshot();
    const mode = this.police.mode;
    const blocked = new Set([cop.edgeId]);
    const change = this.changePoint;
    const toChange = change !== null && mode !== change.mode;
    if (!toChange) {
      if (this.distance <= ESCAPE.seeWithin[this.player.mode]) this.trailing = false;
      else if (!this.trailing && this.distance >= this.settings.warningDistance) this.startTrail();
    }
    const here = this.player.location();
    const me = toChange ? change.at : here;
    const myEdge = this.graph.edge(me.edgeId);
    const behind = this.graph.other(myEdge, me.towards);
    let nodes: string[] | null = null;
    if (cop.edgeId === me.edgeId && cop.towards === me.towards) {
      nodes = [me.towards];
    } else if (!toChange && this.trailing && this.trail.length > 0) {
      const along = this.alongTrail(cop, blocked);
      if (along) {
        const last = along[along.length - 1] as string;
        const onto = this.graph.other(this.graph.edge(here.edgeId), here.towards);
        if (last === onto && this.graph.edgeBetween(onto, here.towards)) nodes = [...along, here.towards];
        else {
          const rest = this.path(last, onto, mode, blocked);
          nodes = rest ? [...along, ...rest.slice(1), ...(rest.includes(here.towards) ? [] : [here.towards])] : along;
        }
      }
    }
    if (!nodes) {
      const way = this.path(cop.towards, behind, mode, blocked);
      if (way && !way.includes(me.towards) && this.graph.edgeBetween(behind, me.towards)) nodes = [...way, me.towards];
      else nodes = this.path(cop.towards, me.towards, mode, blocked);
    }
    if (!nodes) return false;
    const last = nodes[nodes.length - 1] as string;
    const before = nodes.length >= 2 ? (nodes[nodes.length - 2] as string) : this.graph.other(this.graph.edge(cop.edgeId), cop.towards);
    const lastEdge = this.graph.edgeBetween(before, last);
    if (lastEdge) {
      const exits = exitsAt(this.graph, lastEdge, last, mode);
      const onward = exits.find((e) => e.kind === 'STRAIGHT') ?? exits[0];
      if (onward) nodes.push(onward.step.to);
    }
    try {
      this.police.followPlan(nodes);
      return true;
    } catch {
      return false;
    }
  }

  /** The trail begins where the player is now: the street they are on, then the junctions they pass. */
  private startTrail(): void {
    const here = this.player.location();
    this.trailing = true;
    this.trail = [this.graph.other(this.graph.edge(here.edgeId), here.towards), here.towards];
  }

  /**
   * The police's way along the player's trail: the junctions the player passed
   * that the police have not reached yet (joined from where the police are),
   * or null if the trail cannot be joined.
   */
  private alongTrail(cop: { towards: string }, blocked: ReadonlySet<string>): string[] | null {
    // Already heading for the trail's second junction: the first is behind, not worth going back for.
    if (this.trail.length > 1 && cop.towards === this.trail[1]) this.trail.shift();
    const next = this.trail[0];
    if (!next) return null;
    if (next === cop.towards) return [...this.trail];
    const join = this.path(cop.towards, next, this.police.mode, blocked);
    return join ? [...join, ...this.trail.slice(1)] : null;
  }

  private path(from: string, to: string, mode: TravelMode, blocked: ReadonlySet<string>): string[] | null {
    if (from === to) return [from];
    return this.graph.shortestPath(from, to, mode, blocked)?.nodes ?? null;
  }

  /**
   * The police change transport where the player did: the officer jumps out
   * where the player left their car, or gets back in the car (brought up by
   * a colleague) where the player drove off.
   */
  private switchPolice(): void {
    const change = this.changePoint;
    if (!change || this.police.mode === change.mode) return;
    if (distance(this.police.snapshot(), pointOf(this.graph, change.at)) > ESCAPE.switchWithin) return;
    const left = this.police.location();
    if (!this.police.setMode(change.mode)) return;
    // The officer leaves the car to follow on foot; a colleague brings it up again when the player drives off.
    this.policeParked = change.mode === 'FOOT' ? left : null;
    this.policeStage = this.stage;
    this.police.speedFactor = this.policeSpeed;
    this.pursue();
  }

  /** "Descendez de la voiture !" or "Montez dans la voiture !" once the player nears the end of their stage. */
  private orderChange(events: ChaseEvent[]): void {
    if (this.stage >= this.lastStage || this.autoStage !== null) return;
    if (this.pending?.announced) return;
    const next = this.stages[this.stage + 1]!;
    const near = distance(this.player.snapshot(), this.graph.node(this.transferNode)) <= TRANSFER.getOutWithin;
    if (!near) return;
    this.pending = { mode: next.mode, announced: true };
    this.orderSaidAt = this.elapsed;
    if (next.mode === 'CAR') {
      this.parkedCar = this.stageStart(this.stage + 1);
      events.push({ type: 'ANNOUNCE', lines: [TRANSPORT_LINES.GET_IN] });
    } else {
      events.push({ type: 'ANNOUNCE', lines: [TRANSPORT_LINES.GET_OUT] });
    }
  }

  /**
   * The player gets out of the car, or into the getaway car (within reach of
   * it). Returns the events that follow, such as the first direction of the
   * next stage.
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
    if (!this.pending) return { result: { ok: false, reason: 'NOT_HERE' }, events };
    if (this.player.mode === 'CAR') {
      const left = this.player.location();
      if (!this.player.setMode('FOOT')) return { result: { ok: false, reason: 'NOT_HERE' }, events };
      this.abandonedCar = left;
    } else {
      if (!this.parkedCar) return { result: { ok: false, reason: 'NO_CAR' }, events };
      // Their own getaway car, waiting up the street: a sprint to it and off.
      if (distance(this.player.snapshot(), pointOf(this.graph, this.parkedCar)) > ESCAPE.boardWithin) {
        return { result: { ok: false, reason: 'TOO_FAR' }, events };
      }
      this.player = new Mover(this.graph, { ...this.parkedCar, mode: 'CAR' });
      this.parkedCar = null;
    }
    this.changePoint = { at: this.player.location(), mode: this.player.mode };
    this.startTrail();
    // As in a chase, the whole chase waits for the radio here: the police gain nothing while it speaks.
    this.policeWait = { firstCall: true, until: this.elapsed + ESCAPE.changeWaitSeconds };
    this.startStage(events);
    this.waitForFirstCall(events);
    this.distance = this.measure();
    return { result: { ok: true }, events };
  }

  /** The player is in the next stage's mode: to its start (following the way there), then its directions. */
  private startStage(events: ChaseEvent[]): void {
    this.pending = null;
    const stage = this.stage + 1;
    const path = this.pathTo(this.stages[stage]!.route[0] as string);
    if (!path) {
      this.beginStage(stage, events);
      return;
    }
    this.player.followPlan(path);
    this.autoStage = stage;
  }

  private beginStage(stage: number, events: ChaseEvent[]): void {
    this.autoStage = null;
    this.stage = stage;
    this.furthest = 0;
    const { route, mode } = this.stages[stage]!;
    const speed = this.player.snapshot().speed;
    this.player = new Mover(this.graph, placeOnRoute(this.graph, route, 1, mode).start);
    this.player.setSpeed(speed);
    this.navigator = this.navigatorFor(stage);
    const transmissions = this.nav(events).update(this.player.location(), this.remainingRoute());
    for (const transmission of transmissions) events.push({ type: 'TRANSMISSION', transmission });
  }

  /** A plan from where the player is to `node`, turning round first if that is shorter. */
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
    const back = this.graph.edge(here.edgeId) && via(origin);
    const aheadCost = ahead ? length - fromOrigin + ahead.length : Infinity;
    const backCost = back ? fromOrigin + back.length : Infinity;
    if (back && backCost < aheadCost && player.uTurn()) return back.nodes;
    return ahead?.nodes ?? null;
  }

  /**
   * Has the player reached the hideout: the end of the last stage, arriving
   * along its last street (the one "Allez jusqu'à …" is about)? Passing that
   * junction from another street is not arriving: luck must not find it.
   */
  private atHideout(passed: readonly string[], wasOn: string): boolean {
    const route = this.stages[this.lastStage]!.route;
    const end = route[route.length - 1] as string;
    const lastEdge = this.graph.edgeBetween(route[route.length - 2] as string, end);
    if (!lastEdge) return false;
    if (passed.includes(end) && wasOn === lastEdge.id) return true;
    const here = this.player.location();
    if (here.towards !== end || here.edgeId !== lastEdge.id) return false;
    const along = here.towards === lastEdge.to ? here.t : 1 - here.t;
    return (1 - along) * this.graph.edgeLength(lastEdge) <= ESCAPE.arriveWithin;
  }

  /** Police in view, close behind, lost or found again: the events and lines that say so. */
  private report(events: ChaseEvent[]): void {
    const s = this.settings;
    const mode = this.player.mode;
    const seen = this.distance <= ESCAPE.seeWithin[mode];
    if (seen !== this.seen) {
      this.seen = seen;
      events.push({ type: 'SIGHTED', on: seen });
    }
    const near = this.distance <= ESCAPE.closeWithin[mode];
    if (near !== this.near) {
      this.near = near;
      events.push({ type: 'WARNING', on: near });
    }
    if (near && !this.closeSaid) {
      this.closeSaid = true;
      this.closeNews = true;
    } else if (!near) {
      this.closeNews = false; // no longer true: not worth saying
      if (this.closeSaid && this.distance > ESCAPE.closeWithin[mode] * ESCAPE.closeClear) this.closeSaid = false;
    }
    if (!this.lost && this.distance >= s.warningDistance) {
      this.lost = true;
      this.lostNews = this.lostNews === ESCAPE_LINES.POLICE_FOUND ? null : ESCAPE_LINES.POLICE_LOST;
    } else if (this.lost && this.distance <= s.warningDistance * ESCAPE.foundShare) {
      this.lost = false;
      this.lostNews = this.lostNews === ESCAPE_LINES.POLICE_LOST ? null : ESCAPE_LINES.POLICE_FOUND;
    }
    const lines: SpokenText[] = [];
    if (this.closeNews) lines.push(ESCAPE_LINES.POLICE_CLOSE);
    if (this.lostNews) lines.push(this.lostNews);
    if (lines.length === 0) return;
    // Said where it is over before the next direction is due, so that is not made late;
    // a player who has gone wrong (the directions already putting them right) hears it at once.
    // (On the way to a new stage's start the first direction is about to come: that waits too.)
    const quiet = this.nav(events).quietFor(this.player.location()) >= callSeconds(lines.map((l) => l.text));
    if (!quiet && (this.autoStage !== null || this.onRoute())) return;
    this.closeNews = false;
    this.lostNews = null;
    // Said after a direction given this frame, never over it.
    events.push({ type: 'ANNOUNCE', lines, ...(events.some((e) => e.type === 'TRANSMISSION') ? { after: true } : {}) });
  }

  /** The player asks the partner to say the last call again. */
  requestRepeat(): RepeatResult | null {
    if (this.phase !== 'PURSUIT' || !this.navigator.last) return null;
    const status = this.status;
    const result = this.repeats.request(status.signal, status.warning);
    if (result.allowed) {
      this.timeLeft = Math.max(0, this.timeLeft - result.penaltySeconds);
      const last = this.navigator.last;
      if (last) this.radioFreeAt = Math.max(this.elapsed, this.radioFreeAt) + callSeconds(last.instructions.flatMap((i) => i.clips.map((c) => c.text)));
    }
    return result;
  }

  /** Sightings do not happen in Escape Mode (the chase's bot and HUD may still ask). */
  answerSighting(_choice: number): ChaseEvent[] {
    return [];
  }

  /** Debug tools: end now, arrested or safe at the hideout. */
  forceOutcome(outcome: 'CAPTURED' | 'ESCAPED'): ChaseEvent[] {
    if (this.phase !== 'PURSUIT') return [];
    this.phase = outcome;
    if (outcome === 'ESCAPED') {
      this.escapeReason = 'HIDEOUT';
      return [{ type: 'ESCAPED', reason: 'HIDEOUT' }];
    }
    return [{ type: 'CAPTURED' }];
  }

  /** Road distance for the police to reach the player (on foot when their modes differ). */
  private measure(): number {
    const mode = this.player.mode === this.police.mode ? this.police.mode : 'FOOT';
    const police = this.police.location();
    const player = this.player.location();
    this.behind = this.policeBehind > 0 ? Infinity : this.gapBehind(police, player);
    return this.policeBehind + roadDistance(this.graph, police, player, mode);
  }

  /**
   * Metres from the police to the player along the player's street, with the
   * police behind them and going the same way; Infinity otherwise. Meeting
   * head on, or at a junction from another street, is not an arrest: the
   * police have to catch the player up.
   */
  private gapBehind(police: MoverStart, player: MoverStart): number {
    if (police.edgeId !== player.edgeId || police.towards !== player.towards) return Infinity;
    const edge = this.graph.edge(police.edgeId);
    const along = (t: number) => (player.towards === edge.to ? t : 1 - t) * this.graph.edgeLength(edge);
    const gap = along(player.t) - along(police.t);
    return gap >= 0 ? gap : Infinity;
  }

  /** The police are on the map (not still on their way to the start). */
  get policeOnMap(): boolean {
    return this.policeBehind <= 0;
  }

  /**
   * The police are close enough to be shown (Mr Henry, 2026-10-04): from far
   * off, so the player watches them drop back until they are lost, and sees
   * them come back after a mistake. Drawing only: how the police hunt depends
   * on seeWithin, not on this.
   */
  get policeInView(): boolean {
    return this.policeOnMap && this.distance <= ESCAPE.showWithin[this.player.mode];
  }

  /** Metres of route still to travel to the hideout (for the debug overlay and tests). */
  get routeLeft(): number {
    let left = 0;
    for (let i = this.stage; i < this.stages.length; i++) {
      const route = this.stages[i]!.route;
      left += pathLength(this.graph, i === this.stage ? route.slice(this.furthest) : route);
    }
    return left;
  }

  /** The hideout's route is describable from the start (true for every generated chase; a check for tests). */
  get describable(): boolean {
    return this.stages.every((st) => describable(this.graph, st.route, st.mode, this.scenario.difficulty));
  }

  get status(): ChaseStatus {
    const s = this.settings;
    const signal = 1 - (this.distance - s.captureDistance) / (s.farDistance - s.captureDistance);
    return {
      phase: this.phase,
      distance: this.distance,
      signal: Math.max(0, Math.min(1, signal)),
      proximity:
        this.distance <= ESCAPE.closeWithin[this.player.mode]
          ? 'CLOSE'
          : this.distance < s.warningDistance / 2
            ? 'NEAR'
            : this.distance < s.warningDistance
              ? 'FAR'
              : 'LOSING',
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      suspectVisible: this.seen,
      warning: this.near,
      captureProgress: Math.min(1, this.closeFor / s.captureHold),
      repeatsUsed: this.repeats.used,
      repeatsLeft: this.repeats.left,
      switchTo: this.pending?.announced ? this.pending.mode : null,
      followingTracks: this.autoStage !== null,
      sighting: null,
      sightingsAsked: 0,
      sightingsRight: 0,
      signalLost: false,
      ...(this.escapeReason ? { escapeReason: this.escapeReason } : {}),
    };
  }
}
