/**
 * A test player who knows nothing about the suspect's route: it only hears
 * the scanner's French (as structured clauses) and looks at the map, like a
 * student would. It acts on each clause live, counting streets and watching
 * for landmarks as it drives, so it checks the generator independently.
 */

import type { Chase, ChaseEvent } from '../../src/engine/chase/chase';
import { isAt, isDecision, locationById, opensOn, passPoint, scanAhead } from '../../src/engine/language/analysis';
import type { Clause } from '../../src/engine/language/instructions';
import type { Transmission } from '../../src/engine/language/navigator';
import { exitsAt } from '../../src/engine/movement/turns';
import type { TownGraph } from '../../src/engine/world/graph';

interface Task {
  clause: Clause;
  count: number;
  travelled: number;
  target?: number;
  queued: boolean;
}

export class ListenerBot {
  private heard: { at: number; transmission: Transmission }[] = [];
  private tasks: Task[] = [];
  private time = 0;
  private lastEdge = '';
  private lastTowards = '';
  private lastPos: { x: number; y: number } | null = null;
  readonly log: Transmission[] = [];

  constructor(
    private readonly graph: TownGraph,
    /** Seconds between hearing a call and acting on it (listening + thinking time). */
    private readonly reaction = 1.2,
  ) {}

  hear(events: ChaseEvent[]): void {
    for (const e of events) {
      if (e.type === 'TRANSMISSION') {
        this.heard.push({ at: this.time + this.reaction, transmission: e.transmission });
        this.log.push(e.transmission);
      }
    }
  }

  /** Act, then advance the chase by dt. */
  step(chase: Chase, dt: number): ChaseEvent[] {
    this.time += dt;
    const player = chase.player;
    while (this.heard.length > 0 && (this.heard[0]?.at ?? Infinity) <= this.time) {
      const { transmission } = this.heard.shift()!;
      for (const instruction of transmission.instructions) {
        for (const clause of instruction.clauses) {
          if (clause.action === 'WRONG_STREET') {
            this.tasks = [];
            player.clearQueue();
          } else if (clause.action === 'U_TURN') {
            player.uTurn();
          } else if (clause.action !== 'STRAIGHT' && clause.action !== 'CONTINUE_UNTIL') {
            this.tasks.push({ clause, count: 0, travelled: 0, queued: false });
          }
        }
      }
    }

    const me = player.snapshot();
    const moved = this.lastPos ? Math.hypot(me.x - this.lastPos.x, me.y - this.lastPos.y) : 0;
    this.lastPos = { x: me.x, y: me.y };
    const passedNode = me.edgeId !== this.lastEdge && this.lastEdge !== '' ? this.lastTowards : null;
    const arrivedBy = this.lastEdge;
    this.lastEdge = me.edgeId;
    this.lastTowards = me.towards;

    const task = this.tasks[0];
    if (task) {
      task.travelled += moved;
      if (task.queued) {
        if (me.queued === null) this.tasks.shift(); // the turn has been made
      } else if (this.ready(task, chase, passedNode, arrivedBy)) {
        const side = task.clause.action === 'ROUNDABOUT_EXIT' ? 'RIGHT' : (task.clause as { side: 'LEFT' | 'RIGHT' }).side;
        player.queue(side);
        task.queued = true;
      }
    }
    const events = chase.update(dt);
    this.hear(events);
    return events;
  }

  /** Is it time to press the arrow for this clause? */
  private ready(task: Task, chase: Chase, passedNode: string | null, arrivedBy: string): boolean {
    const clause = task.clause;
    const pos = chase.player.location();
    const mode = chase.player.mode;
    const passedExits = passedNode ? exitsAt(this.graph, this.graph.edge(arrivedBy), passedNode, mode) : [];
    switch (clause.action) {
      case 'TURN': {
        if (!clause.landmark) return true;
        const location = locationById(this.graph, clause.landmark)!;
        const ahead = scanAhead(this.graph, pos, mode);
        if (clause.relation === 'DEVANT') {
          const next = ahead.nodes.find(isDecision);
          return next !== undefined && isAt(this.graph, location, next.node);
        }
        if (clause.relation === 'APRES') {
          if (task.target === undefined) task.target = passPoint(ahead, location) ?? 0;
          return task.travelled > task.target;
        }
        // AVANT: the next street on that side is the last one before the place.
        const s = passPoint(ahead, location);
        const streets = ahead.nodes.filter((n) => opensOn(n, clause.side));
        return s !== undefined && streets[0] !== undefined && streets[0].s < s && !(streets[1] && streets[1].s < s);
      }
      case 'TAKE_STREET': {
        const onRing = passedNode !== null && this.graph.node(passedNode).roundaboutId !== undefined;
        if (passedNode && !onRing && passedExits.length > 1 && passedExits.some((e) => e.kind === clause.side)) {
          task.count++;
        }
        return task.count >= clause.ordinal - 1;
      }
      case 'ROUNDABOUT_EXIT': {
        const onRingEdge = this.graph.edge(pos.edgeId).kind === 'ROUNDABOUT_RING';
        if (passedNode && onRingEdge && passedExits.some((e) => e.kind === 'RIGHT')) task.count++;
        return onRingEdge && task.count >= clause.ordinal - 1;
      }
      default:
        return true;
    }
  }
}
