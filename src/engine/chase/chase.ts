/**
 * The running chase: moves the suspect along its route, measures the road
 * distance to the player, and decides capture and escape.
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
 *   far away for too long, or out of time → escape (with warnings first)
 *   close enough for long enough → capture (no need to ram the suspect)
 */

import { TRANSPORT_LINES } from '../audio/script';
import { DIFFICULTY_SETTINGS } from '../difficulty';
import type { AudioCheck } from '../language/generate';
import { Navigator, type Transmission } from '../language/navigator';
import { Mover, type MoverStart } from '../movement/mover';
import { BOARDING_DISTANCE } from '../movement/settings';
import { Rng } from '../rng/prng';
import { distance, lerp, type Point } from '../world/geometry';
import { canTravel, type TownGraph, type TravelMode } from '../world/graph';
import { roadDistance } from './distance';
import { placeOnRoute } from './route';
import type { ChaseScenario } from './scenario';
import { RepeatCounter, type RepeatResult } from '../audio/repeat';
import { CHASE_SETTINGS, TRANSFER, type ChaseSettings } from './settings';

/** A fixed scanner line (not a route instruction): an event or an order. */
export interface SpokenText {
  audioId: string;
  text: string;
}

export type ModeChangeResult = { ok: true } | { ok: false; reason: 'NO_CAR' | 'TOO_FAR' | 'NOT_HERE' };

export type ChasePhase = 'PURSUIT' | 'CAPTURED' | 'ESCAPED';
export type Proximity = 'CLOSE' | 'NEAR' | 'FAR' | 'LOSING';
export type EscapeReason = 'DISTANCE' | 'TIME';

export type ChaseEvent =
  | { type: 'CAPTURED' }
  | { type: 'ESCAPED'; reason: EscapeReason }
  | { type: 'WARNING'; on: boolean }
  | { type: 'SIGHTED'; on: boolean }
  | { type: 'SUSPECT_ARRIVED' }
  /** The police scanner speaks (directions, corrections). */
  | { type: 'TRANSMISSION'; transmission: Transmission }
  /** The scanner announces an event or gives an order, such as "Il est à pied !". */
  | { type: 'ANNOUNCE'; lines: SpokenText[] }
  /** The suspect got out of or into a car. */
  | { type: 'SUSPECT_MODE'; mode: TravelMode };

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
  private readonly repeats: RepeatCounter;
  private readonly settings: ChaseSettings;
  private phase: ChasePhase = 'PURSUIT';
  private elapsed = 0;
  private timeLeft: number;
  private closeFor = 0;
  private farFor = 0;
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
  private readonly hasAudio: AudioCheck | undefined;

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
    this.player = new Mover(graph, scenario.playerStart);
    this.suspect = new Mover(graph, scenario.suspectStart);
    this.suspect.followPlan(scenario.suspectPlan);
    this.suspect.speedFactor = this.settings.suspectSpeed;
    this.navigator = this.navigatorFor(0, scenario.route);
    this.distance = this.measure();
  }

  private get lastStage(): number {
    return this.scenario.stages.length - 1;
  }

  /** Directions for one stage. The first stage keeps the original language stream. */
  private navigatorFor(stage: number, guide: readonly string[]): Navigator {
    const { scenario } = this;
    return new Navigator(
      this.graph,
      scenario.difficulty,
      Rng.fromSeed(scenario.seed).fork(stage === 0 ? 'language' : `language-${stage}`),
      guide,
      stage === this.lastStage ? scenario.destination : null,
      scenario.stages[stage]?.mode ?? 'CAR',
      this.hasAudio,
    );
  }

  /** Where the suspect changes transport at the end of the player's current stage. */
  private get transferNode(): string {
    const route = this.scenario.stages[this.playerStage]?.route ?? [];
    return route[route.length - 1] as string;
  }

  /** Advance the chase by `dt` seconds. The caller moves nothing itself. */
  update(dt: number): ChaseEvent[] {
    const events: ChaseEvent[] = [];
    if (this.phase !== 'PURSUIT') return events;

    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.player.update(dt);
    this.suspect.speedFactor =
      this.distance < this.settings.fleeDistance ? this.settings.suspectFleeSpeed : this.settings.suspectSpeed;
    this.suspect.update(dt);
    if (!this.suspectArrived && this.suspect.snapshot().waiting === 'ARRIVED') {
      if (this.suspectStage < this.lastStage) this.changeSuspectTransport(events);
      else {
        this.suspectArrived = true;
        events.push({ type: 'SUSPECT_ARRIVED' });
      }
    }
    this.orderGetOut(events);
    if (this.autoStage !== null && this.player.snapshot().waiting === 'ARRIVED') this.beginStage(this.autoStage, events);

    this.distance = this.measure();
    if (!this.pending?.announced && this.autoStage === null) {
      // Until the player changes transport, guide them to where the suspect did.
      const ahead = this.playerStage < this.suspectStage ? [this.transferNode] : this.suspect.remainingPlan();
      for (const transmission of this.navigator.update(this.player.location(), ahead)) {
        events.push({ type: 'TRANSMISSION', transmission });
      }
    }
    const s = this.settings;

    const sighted = this.distance <= s.sightingDistance;
    if (sighted !== this.sighted) {
      this.sighted = sighted;
      events.push({ type: 'SIGHTED', on: sighted });
    }
    const warning = this.distance >= s.warningDistance;
    if (warning !== this.warning) {
      this.warning = warning;
      events.push({ type: 'WARNING', on: warning });
    }

    // A moving car cannot be caught on foot, nor a runner from the car; a stopped suspect can.
    const stopped = this.suspectArrived || this.transferUntil !== null;
    const canCapture = this.player.mode === this.suspect.mode || stopped;
    this.closeFor = this.distance <= s.captureDistance && canCapture ? this.closeFor + dt : 0;
    this.farFor = this.distance >= s.escapeDistance ? this.farFor + dt : 0;

    // A stopped suspect is caught as soon as the player reaches it: an auto-driving
    // car would otherwise roll straight past before the hold time is up.
    const hold = stopped ? 0 : s.captureHold;
    if (this.closeFor > 0 && this.closeFor >= hold) {
      this.phase = 'CAPTURED';
      events.push({ type: 'CAPTURED' });
    } else if (this.farFor >= s.escapeHold || this.timeLeft <= 0) {
      this.phase = 'ESCAPED';
      this.escapeReason = this.timeLeft <= 0 ? 'TIME' : 'DISTANCE';
      events.push({ type: 'ESCAPED', reason: this.escapeReason });
    }
    return events;
  }

  /**
   * The suspect has reached the end of a stage: it stops while it gets out of
   * (or into) a car, then carries on in the next stage's mode.
   */
  private changeSuspectTransport(events: ChaseEvent[]): void {
    if (this.transferUntil === null) {
      this.transferUntil = this.elapsed + TRANSFER.suspectSeconds;
      return;
    }
    if (this.elapsed < this.transferUntil) return;
    this.transferUntil = null;
    const from = this.suspect.mode;
    this.suspectStage++;
    const stage = this.scenario.stages[this.suspectStage]!;
    if (from === 'CAR') this.abandonedCar = this.suspect.location();
    const placed = placeOnRoute(this.graph, stage.route, 2, stage.mode);
    this.suspect = new Mover(this.graph, placed.start);
    this.suspect.followPlan(placed.plan);
    this.suspect.speedFactor = this.settings.suspectSpeed;
    events.push({ type: 'SUSPECT_MODE', mode: stage.mode });

    const lines: SpokenText[] =
      stage.mode === 'FOOT' ? [TRANSPORT_LINES.SUSPECT_LEFT_CAR, TRANSPORT_LINES.ON_FOOT] : [TRANSPORT_LINES.SUSPECT_BOARDS];
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
    const path = this.pathTo(this.scenario.stages[stage]!.route[0] as string);
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
    const { route, mode } = this.scenario.stages[stage]!;
    const speed = this.player.snapshot().speed;
    this.player = new Mover(this.graph, placeOnRoute(this.graph, route, 1, mode).start);
    this.player.setSpeed(speed);
    this.navigator = this.navigatorFor(stage, route);
    for (const transmission of this.navigator.update(this.player.location(), this.suspect.remainingPlan())) {
      events.push({ type: 'TRANSMISSION', transmission });
    }
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
    if (this.phase !== 'PURSUIT' || !this.navigator.last) return null;
    const status = this.status;
    const result = this.repeats.request(status.signal, status.warning);
    if (result.allowed) this.timeLeft = Math.max(0, this.timeLeft - result.penaltySeconds);
    return result;
  }

  /** Debug tools: end the chase now with a given outcome. */
  forceOutcome(outcome: 'CAPTURED' | 'ESCAPED'): ChaseEvent[] {
    if (this.phase !== 'PURSUIT') return [];
    this.phase = outcome;
    if (outcome === 'ESCAPED') this.escapeReason = 'DISTANCE';
    return [outcome === 'CAPTURED' ? { type: 'CAPTURED' } : { type: 'ESCAPED', reason: 'DISTANCE' }];
  }

  /**
   * Debug tools: put the player right on the suspect (tests the capture rules).
   * On a footpath a driver cannot follow, the player arrives on foot.
   */
  teleportPlayerToSuspect(): void {
    const at = this.suspect.location();
    const edge = this.graph.edge(at.edgeId);
    const mode = this.player.mode === 'CAR' && !edge.car ? 'FOOT' : this.player.mode;
    if (mode !== this.player.mode) this.parkedCar = this.player.location();
    const start = { ...at, mode };
    // A car on a one-way street faces the legal way.
    if (mode === 'CAR' && edge.oneWay && at.towards !== edge.to) start.towards = edge.to;
    this.player = new Mover(this.graph, start);
    this.player.setSpeed(this.suspect.snapshot().speed);
    this.distance = this.measure();
  }

  get status(): ChaseStatus {
    const s = this.settings;
    const signal = 1 - (this.distance - s.captureDistance) / (s.escapeDistance - s.captureDistance);
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
      ...(this.escapeReason ? { escapeReason: this.escapeReason } : {}),
    };
  }

  /** Road distance; on foot when the two are in different modes (the player can always get out and run). */
  private measure(): number {
    const mode = this.player.mode === this.suspect.mode ? this.player.mode : 'FOOT';
    return roadDistance(this.graph, this.player.location(), this.suspect.location(), mode);
  }
}
