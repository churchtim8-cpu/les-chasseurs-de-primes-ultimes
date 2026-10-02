/**
 * Graph-based movement for the player (and later the suspect).
 *
 * Movers always travel along roads or paths; there is no steering and no
 * crashing. They move forward on their own at a cruising speed. The player
 * chooses LEFT, RIGHT or STRAIGHT ahead of time; the choice is held until the
 * next junction where it is possible, so understanding the French ("la
 * deuxième rue à gauche") matters and quick reflexes do not.
 *
 * At a junction with no straight-on option and no choice made yet (a
 * T-junction), or at a dead end, the mover slows down and waits.
 */

import { lerp, type Point } from '../world/geometry';
import type { TownGraph, TravelMode } from '../world/graph';
import type { MapEdge } from '../world/types';
import { MOVEMENT } from './settings';
import { exitsAt, type Exit, type TurnIntent } from './turns';

export type Throttle = 'CRUISE' | 'ACCELERATE' | 'BRAKE';
export type WaitReason = 'JUNCTION' | 'DEAD_END' | 'ARRIVED';

export interface MoverStart {
  edgeId: string;
  /** Position along the edge from its `from` node, 0 to 1. */
  t: number;
  /** The end of the edge the mover is heading towards. */
  towards: string;
  mode: TravelMode;
}

export interface MoverSnapshot extends Point {
  /** Heading in radians (0 = east, positive = clockwise). */
  heading: number;
  speed: number;
  mode: TravelMode;
  edgeId: string;
  /** Node the mover is heading towards. */
  towards: string;
  queued: TurnIntent | null;
  waiting: WaitReason | null;
}

export class Mover {
  private edge: MapEdge;
  /** Node we are travelling away from and towards along `edge`. */
  private origin: string;
  private target: string;
  /** Distance travelled from `origin`. */
  private offset: number;
  private speed = 0;
  private throttle: Throttle = 'CRUISE';
  private queuedIntent: TurnIntent | null = null;
  private waitingReason: WaitReason | null = null;
  private currentMode: TravelMode;
  /** Planned route (node IDs) for computer-driven movers; index of the next node to reach. */
  private plan: string[] | null = null;
  private aim: { node: string; to: string } | null = null;
  private planIndex = 0;
  /** Multiplies cruise and top speed (the suspect uses this to be slower or faster). */
  speedFactor = 1;
  /**
   * The chase's pace (1 = normal): it slows everyone a little while a late
   * direction is still being heard (CALL_TIMING).
   */
  callAssist = 1;

  constructor(
    private readonly graph: TownGraph,
    start: MoverStart,
  ) {
    this.edge = graph.edge(start.edgeId);
    if (start.towards !== this.edge.from && start.towards !== this.edge.to) {
      throw new Error(`Node ${start.towards} is not an end of ${start.edgeId}`);
    }
    this.target = start.towards;
    this.origin = graph.other(this.edge, start.towards);
    const length = graph.edgeLength(this.edge);
    this.offset = (this.origin === this.edge.from ? start.t : 1 - start.t) * length;
    this.currentMode = start.mode;
    if (!this.canUse(this.edge, this.origin)) throw new Error(`Cannot start ${start.mode} on ${start.edgeId} this way`);
  }

  get mode(): TravelMode {
    return this.currentMode;
  }

  snapshot(): MoverSnapshot {
    const a = this.graph.node(this.origin);
    const b = this.graph.node(this.target);
    const length = this.graph.edgeLength(this.edge);
    const p = lerp(a, b, length === 0 ? 0 : this.offset / length);
    return {
      x: p.x,
      y: p.y,
      heading: Math.atan2(b.y - a.y, b.x - a.x),
      speed: this.speed,
      mode: this.currentMode,
      edgeId: this.edge.id,
      towards: this.target,
      queued: this.queuedIntent,
      waiting: this.waitingReason,
    };
  }

  /** Debug tools and tests: set the current speed directly (e.g. to match another mover). */
  setSpeed(speed: number): void {
    this.speed = Math.max(0, speed);
  }

  /** Where the mover is, in the form the constructor takes (to park or restart it). */
  location(): MoverStart {
    const length = this.graph.edgeLength(this.edge);
    const along = length === 0 ? 0 : this.offset / length;
    return {
      edgeId: this.edge.id,
      t: this.origin === this.edge.from ? along : 1 - along,
      towards: this.target,
      mode: this.currentMode,
    };
  }

  /**
   * Follow a fixed list of nodes (the suspect's route). `nodes` must start with
   * the node this mover is heading towards; each later node must be a legal
   * next step. The mover stops with reason ARRIVED at the last node.
   */
  followPlan(nodes: string[]): void {
    if (nodes[0] !== this.target) throw new Error(`Plan must start at ${this.target}, not ${nodes[0]}`);
    this.plan = nodes;
    this.planIndex = 0;
  }

  /** The rest of the planned route, starting with the node the mover is heading to. */
  remainingPlan(): string[] {
    if (!this.plan) return [this.target];
    return [this.target, ...this.plan.slice(this.planIndex + 1)];
  }

  /** How many planned nodes have been reached (0 when not following a plan). */
  get planProgress(): number {
    return this.planIndex;
  }

  setThrottle(throttle: Throttle): void {
    this.throttle = throttle;
  }

  /** Choose a direction for the next junction where it is possible. */
  queue(intent: TurnIntent): void {
    this.queuedIntent = intent;
    if (this.waitingReason === 'JUNCTION') this.tryLeaveJunction();
  }

  clearQueue(): void {
    this.queuedIntent = null;
    this.aim = null;
  }

  /**
   * Leave a roundabout by one exit: keep going round until reaching `node`,
   * then take the way to `to`. Null keeps going round (or straight on).
   */
  aimExit(exit: { node: string; to: string } | null): void {
    this.aim = exit;
    this.queuedIntent = null;
    if (exit && this.waitingReason === 'JUNCTION') this.tryLeaveJunction();
  }

  /** The roundabout exit chosen with `aimExit`, until it is taken. */
  get aimedExit(): { node: string; to: string } | null {
    return this.aim;
  }

  /** Turn around on the spot (faire demi-tour). Not allowed against one-way traffic. */
  uTurn(): boolean {
    if (!this.canUse(this.edge, this.target)) return false;
    [this.origin, this.target] = [this.target, this.origin];
    this.offset = this.graph.edgeLength(this.edge) - this.offset;
    this.speed = 0;
    this.waitingReason = null;
    this.queuedIntent = null;
    this.aim = null;
    return true;
  }

  /** Switch between car and foot. Fails if the current way cannot be used in the new mode. */
  setMode(mode: TravelMode): boolean {
    if (mode === this.currentMode) return true;
    if (mode === 'FOOT' && !this.edge.foot) return false;
    if (mode === 'CAR') {
      if (!this.edge.car) return false;
      // Getting back in on a one-way road: drive the legal way.
      if (this.edge.oneWay && this.edge.from !== this.origin) {
        [this.origin, this.target] = [this.target, this.origin];
        this.offset = this.graph.edgeLength(this.edge) - this.offset;
      }
    }
    this.currentMode = mode;
    this.speed = Math.min(this.speed, MOVEMENT[mode].cruise);
    if (this.waitingReason) {
      // The ways out depend on the mode (footpaths, one-way rules): look again.
      this.waitingReason = null;
      if (this.offset >= this.graph.edgeLength(this.edge)) this.chooseNext();
    }
    return true;
  }

  /**
   * Advance by `dt` seconds. Returns the IDs of nodes passed through, in order,
   * so the chase can track progress.
   */
  update(dt: number): string[] {
    const passed: string[] = [];
    const settings = MOVEMENT[this.currentMode];
    if (this.waitingReason) {
      this.speed = 0;
      return passed;
    }

    const top = (this.throttle === 'ACCELERATE' ? settings.max : settings.cruise) * this.speedFactor * this.callAssist;
    const targetSpeed = this.throttle === 'BRAKE' ? 0 : top;
    if (this.speed < targetSpeed) this.speed = Math.min(targetSpeed, this.speed + settings.acceleration * dt);
    else this.speed = Math.max(targetSpeed, this.speed - settings.braking * dt);

    // Slow down in time for a junction or dead end where we will have to wait.
    const remaining = this.graph.edgeLength(this.edge) - this.offset;
    if (this.mustWaitAt(this.target)) {
      const safe = Math.sqrt(2 * settings.braking * Math.max(0, remaining)) + 2;
      this.speed = Math.min(this.speed, safe);
    }

    let travel = this.speed * dt;
    // Loop because one frame can pass through several short edges.
    for (let guard = 0; travel > 0 && guard < 16; guard++) {
      const length = this.graph.edgeLength(this.edge);
      const left = length - this.offset;
      if (travel < left) {
        this.offset += travel;
        break;
      }
      travel -= left;
      this.offset = length;
      passed.push(this.target);
      if (!this.chooseNext()) break;
    }
    return passed;
  }

  /** At the end of the current edge: pick the next edge or start waiting. */
  private chooseNext(): boolean {
    if (this.plan) {
      this.planIndex++;
      const nextNode = this.plan[this.planIndex];
      const exit =
        nextNode === undefined
          ? undefined
          : exitsAt(this.graph, this.edge, this.target, this.currentMode).find((e) => e.step.to === nextNode);
      if (!exit) {
        this.waitingReason = 'ARRIVED';
        this.speed = 0;
        return false;
      }
      this.enter(exit);
      return true;
    }
    const exits = exitsAt(this.graph, this.edge, this.target, this.currentMode);
    const next = this.pickExit(exits);
    if (!next) {
      this.waitingReason = exits.length === 0 ? 'DEAD_END' : 'JUNCTION';
      this.speed = 0;
      return false;
    }
    this.enter(next);
    return true;
  }

  private pickExit(exits: Exit[]): Exit | undefined {
    if (this.aim && this.target === this.aim.node) {
      const aimed = exits.find((e) => e.step.to === this.aim?.to);
      if (aimed) {
        this.aim = null;
        return aimed;
      }
    }
    if (exits.length === 1) return exits[0]; // a bend is not a choice; keep any queued turn
    if (this.queuedIntent) {
      const chosen = exits.find((e) => e.kind === this.queuedIntent);
      if (chosen) {
        this.queuedIntent = null;
        return chosen;
      }
    }
    return exits.find((e) => e.kind === 'STRAIGHT');
  }

  private mustWaitAt(nodeId: string): boolean {
    if (this.plan) return this.planIndex >= this.plan.length - 1;
    const exits = exitsAt(this.graph, this.edge, nodeId, this.currentMode);
    if (exits.length === 0) return true;
    if (exits.length === 1) return false;
    if (this.aim?.node === nodeId && exits.some((e) => e.step.to === this.aim?.to)) return false;
    if (this.queuedIntent && exits.some((e) => e.kind === this.queuedIntent)) return false;
    return !exits.some((e) => e.kind === 'STRAIGHT');
  }

  private tryLeaveJunction(): void {
    const exits = exitsAt(this.graph, this.edge, this.target, this.currentMode);
    const next = this.pickExit(exits);
    if (next) {
      this.waitingReason = null;
      this.enter(next);
    }
  }

  private enter(exit: Exit): void {
    this.origin = this.target;
    this.edge = exit.step.edge;
    this.target = exit.step.to;
    this.offset = 0;
  }

  private canUse(edge: MapEdge, from: string): boolean {
    if (this.currentMode === 'FOOT') return edge.foot;
    return edge.car && (!edge.oneWay || edge.from === from);
  }
}
