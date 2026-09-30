/**
 * The running chase: moves the suspect along its route, measures the road
 * distance to the player, and decides capture and escape.
 *
 *   correct navigation → the player (faster than the suspect) closes in
 *   wrong turn or hesitation → the suspect gains road distance
 *   recovery → the gap closes again
 *   far away for too long, or out of time → escape (with warnings first)
 *   close enough for long enough → capture (no need to ram the suspect)
 */

import { DIFFICULTY_SETTINGS } from '../difficulty';
import { Navigator, type Transmission } from '../language/navigator';
import { Mover } from '../movement/mover';
import { Rng } from '../rng/prng';
import type { TownGraph } from '../world/graph';
import { roadDistance } from './distance';
import type { ChaseScenario } from './scenario';
import { CHASE_SETTINGS, type ChaseSettings } from './settings';

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
  | { type: 'TRANSMISSION'; transmission: Transmission };

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
  escapeReason?: EscapeReason;
}

export class Chase {
  player: Mover;
  readonly suspect: Mover;
  readonly navigator: Navigator;
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
  private escapeReason?: EscapeReason;

  constructor(
    private readonly graph: TownGraph,
    readonly scenario: ChaseScenario,
  ) {
    this.settings = CHASE_SETTINGS[scenario.difficulty];
    this.timeLeft = DIFFICULTY_SETTINGS[scenario.difficulty].timeLimitSeconds;
    this.player = new Mover(graph, scenario.playerStart);
    this.suspect = new Mover(graph, scenario.suspectStart);
    this.suspect.followPlan(scenario.suspectPlan);
    this.suspect.speedFactor = this.settings.suspectSpeed;
    this.navigator = new Navigator(
      graph,
      scenario.difficulty,
      Rng.fromSeed(scenario.seed).fork('language'),
      scenario.route,
      scenario.destination,
    );
    this.distance = this.measure();
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
      this.suspectArrived = true;
      events.push({ type: 'SUSPECT_ARRIVED' });
    }

    this.distance = this.measure();
    for (const transmission of this.navigator.update(this.player.location(), this.suspect.remainingPlan())) {
      events.push({ type: 'TRANSMISSION', transmission });
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

    // A moving car cannot be caught on foot; a stopped suspect can.
    const canCapture = this.player.mode === 'CAR' || this.suspectArrived;
    this.closeFor = this.distance <= s.captureDistance && canCapture ? this.closeFor + dt : 0;
    this.farFor = this.distance >= s.escapeDistance ? this.farFor + dt : 0;

    // A stopped suspect is caught as soon as the player reaches it: an auto-driving
    // car would otherwise roll straight past before the hold time is up.
    const hold = this.suspectArrived ? 0 : s.captureHold;
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

  /** Debug tools: end the chase now with a given outcome. */
  forceOutcome(outcome: 'CAPTURED' | 'ESCAPED'): ChaseEvent[] {
    if (this.phase !== 'PURSUIT') return [];
    this.phase = outcome;
    if (outcome === 'ESCAPED') this.escapeReason = 'DISTANCE';
    return [outcome === 'CAPTURED' ? { type: 'CAPTURED' } : { type: 'ESCAPED', reason: 'DISTANCE' }];
  }

  /** Debug tools: put the player right on the suspect (tests the capture rules). */
  teleportPlayerToSuspect(): void {
    this.player = new Mover(this.graph, { ...this.suspect.location(), mode: this.player.mode });
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
      ...(this.escapeReason ? { escapeReason: this.escapeReason } : {}),
    };
  }

  private measure(): number {
    return roadDistance(this.graph, this.player.location(), this.suspect.location(), this.player.mode);
  }
}
