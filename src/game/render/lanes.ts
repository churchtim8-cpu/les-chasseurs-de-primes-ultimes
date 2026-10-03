import { HALF_WIDTH, laneOffset, PAVEMENT } from '../../engine/world/geometry';
import type { TownGraph, TravelMode } from '../../engine/world/graph';
import { CAR_SCALE } from './actors';

/**
 * Where on the road the police and the suspect are drawn (drawing only: the
 * chase still measures along each road's centre line).
 *
 * Cars keep to the right-hand lane and pull out into the other lane to get
 * past slower traffic, or down the middle when both lanes are taken (traffic
 * pulls over to the kerb for the chase), then pull back in once they are by.
 * Runners keep to the pavement on their right.
 */
const LANES = {
  /** Traffic closer than this ahead (metres) in the same lane makes a car pull out. */
  lookAhead: 70,
  /** Before pulling back in, the right-hand lane must be clear from this far behind (metres)... */
  clearBehind: 28,
  /** ...to this far ahead. */
  clearAhead: 45,
  /** Another car within this distance sideways (metres) is in the way: a car's width. */
  clearance: 9.6 * CAR_SCALE,
  /** Once a car changes lane it stays in it at least this long (s), so it never weaves. */
  holdSeconds: 0.8,
  /** How quickly the drawing eases across (ms): about half a second for a lane change. */
  easeMs: 220,
};

export interface Placed {
  x: number;
  y: number;
  heading: number;
  mode: TravelMode;
  edgeId: string;
}

/** One driver's or runner's place across the road, eased from frame to frame. */
export class LanePosition {
  /** 1: the right-hand lane; -1: pulled out into the other lane; 0: down the middle. */
  private lane = 1;
  private hold = 0;
  private shift = { x: 0, y: 0 };

  constructor(private readonly graph: TownGraph) {}

  /** How far to draw `who` from the road's centre line, given the traffic around (drawn positions). */
  update(who: Placed, traffic: readonly { x: number; y: number }[], delta: number): { x: number; y: number } {
    const edge = this.graph.edge(who.edgeId);
    let side = 0;
    if (who.mode === 'FOOT' && edge.car) side = HALF_WIDTH[edge.kind] + PAVEMENT / 2;
    if (who.mode === 'CAR' && edge.car) {
      // Round a roundabout everyone keeps to the one lane.
      if (edge.kind === 'ROUNDABOUT_RING') this.lane = 1;
      else this.chooseLane(who, traffic, laneOffset(edge.kind), delta);
      side = laneOffset(edge.kind) * this.lane;
    }
    const k = Math.min(1, delta / LANES.easeMs);
    this.shift.x += (-Math.sin(who.heading) * side - this.shift.x) * k;
    this.shift.y += (Math.cos(who.heading) * side - this.shift.y) * k;
    return this.shift;
  }

  private chooseLane(who: Placed, traffic: readonly { x: number; y: number }[], lane: number, delta: number): void {
    this.hold = Math.max(0, this.hold - delta / 1000);
    if (this.hold > 0) return;
    const cos = Math.cos(who.heading);
    const sin = Math.sin(who.heading);
    // Is there a car in that lane between `from` and `to` metres ahead (negative: behind)?
    const taken = (inLane: number, from: number, to: number) =>
      traffic.some((car) => {
        const dx = car.x - who.x;
        const dy = car.y - who.y;
        const ahead = dx * cos + dy * sin;
        const across = -dx * sin + dy * cos;
        return ahead > from && ahead < to && Math.abs(across - inLane * lane) < LANES.clearance;
      });
    let next = this.lane;
    if (this.lane === 1 && taken(1, 0, LANES.lookAhead)) next = taken(-1, -LANES.clearBehind, LANES.lookAhead) ? 0 : -1;
    else if (this.lane !== 1 && !taken(1, -LANES.clearBehind, LANES.clearAhead)) next = 1;
    else if (this.lane === -1 && taken(-1, 0, LANES.lookAhead)) next = 0;
    if (next !== this.lane) {
      this.lane = next;
      this.hold = LANES.holdSeconds;
    }
  }
}
