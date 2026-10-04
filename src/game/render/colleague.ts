import { pointOf } from '../../engine/chase/chase';
import type { MoverStart } from '../../engine/movement/mover';
import { canTravel, type TownGraph } from '../../engine/world/graph';

/**
 * A colleague brings the police car when the suspect jumps into a car
 * (Mr Henry, 2026-10-03): instead of appearing on the spot, it races up the
 * road behind where it will park, brakes hard and screeches to a halt beside
 * the officer while the radio says "Montez dans la voiture !".
 */
export const COLLEAGUE = {
  /** Road driven before pulling up (metres). */
  metres: 150,
  /** Time from appearing to stopping (ms): about as long as the radio line. */
  ms: 2600,
  /** The tyres squeal over this last share of the drive (braking hard). */
  brakeShare: 0.45,
};

interface Point {
  x: number;
  y: number;
}

/** The colleague's drive up to `parked`: a path from far back along the roads to the spot. */
export class ColleagueArrival {
  private readonly path: Point[];
  private readonly lengths: number[];
  private readonly total: number;
  private elapsed = 0;
  private screeched = false;

  constructor(
    graph: TownGraph,
    readonly parked: MoverStart,
  ) {
    this.path = backPath(graph, parked, COLLEAGUE.metres);
    this.lengths = [0];
    for (let i = 1; i < this.path.length; i++) {
      const a = this.path[i - 1]!;
      const b = this.path[i]!;
      this.lengths.push(this.lengths[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.total = this.lengths[this.lengths.length - 1]!;
  }

  get done(): boolean {
    return this.elapsed >= COLLEAGUE.ms;
  }

  /**
   * Advance by `deltaMs`. Returns where the car is and which way it faces,
   * whether it is braking hard (tyre marks), and `screech` once as the
   * braking starts.
   */
  update(deltaMs: number): { x: number; y: number; rotation: number; braking: boolean; screech: boolean } {
    this.elapsed = Math.min(COLLEAGUE.ms, this.elapsed + deltaMs);
    const u = this.elapsed / COLLEAGUE.ms;
    // Fast at first, then braking hard: the distance still to go shrinks with (1 - u)².
    const left = this.total * (1 - u) ** 2;
    const at = this.pointBack(left);
    const ahead = this.pointBack(Math.max(0, left - 2));
    const behind = this.pointBack(left + 2);
    const rotation = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
    const braking = u >= 1 - COLLEAGUE.brakeShare && u < 1;
    const screech = braking && !this.screeched;
    if (screech) this.screeched = true;
    return { x: at.x, y: at.y, rotation, braking, screech };
  }

  /** The point `metres` back along the path from the parking spot. */
  private pointBack(metres: number): Point {
    const d = Math.min(this.total, Math.max(0, metres));
    for (let i = 1; i < this.path.length; i++) {
      if (this.lengths[i]! >= d) {
        const a = this.path[i - 1]!;
        const b = this.path[i]!;
        const span = this.lengths[i]! - this.lengths[i - 1]!;
        const k = span > 0 ? (d - this.lengths[i - 1]!) / span : 0;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return this.path[this.path.length - 1]!;
  }
}

/**
 * Points from the parking spot back along the road the car arrives by
 * (against its parked direction), carrying on as straight as the roads allow
 * at each junction, until `metres` of road.
 */
function backPath(graph: TownGraph, parked: MoverStart, metres: number): Point[] {
  const points: Point[] = [pointOf(graph, parked)];
  let edge = graph.edge(parked.edgeId);
  let ahead = parked.towards;
  let node = graph.other(edge, ahead);
  let length = Math.hypot(graph.node(node).x - points[0]!.x, graph.node(node).y - points[0]!.y);
  points.push(graph.node(node));
  while (length < metres) {
    const here = graph.node(node);
    const came = graph.node(ahead);
    const back = Math.atan2(here.y - came.y, here.x - came.x);
    let best: { edge: typeof edge; next: string; turn: number } | null = null;
    for (const e of graph.edgesAt(node)) {
      if (e.id === edge.id || e.kind === 'ROUNDABOUT_RING') continue;
      const next = graph.other(e, node);
      // The car must be allowed to drive this street towards the junction.
      if (!canTravel(e, 'CAR', next)) continue;
      const there = graph.node(next);
      const dir = Math.atan2(there.y - here.y, there.x - here.x);
      const turn = Math.abs(Math.atan2(Math.sin(dir - back), Math.cos(dir - back)));
      if (!best || turn < best.turn) best = { edge: e, next, turn };
    }
    if (!best || best.turn > Math.PI / 2) break;
    const there = graph.node(best.next);
    length += Math.hypot(there.x - here.x, there.y - here.y);
    points.push(there);
    ahead = node;
    node = best.next;
    edge = best.edge;
  }
  return points;
}
