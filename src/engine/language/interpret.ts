/**
 * The interpreter (plan C4): reads a clause the way a listener with the map
 * would, and says where it sends them. It knows nothing about the suspect's
 * route, so the generator can use it as an independent check: an instruction
 * is only accepted when the interpreter's single reading is the real route.
 *
 * Returns null when the clause has no reading or more than one (ambiguous).
 */

import type { MoverStart } from '../movement/mover';
import type { TownGraph, TravelMode } from '../world/graph';
import {
  isAt,
  isDecision,
  locationById,
  opensOn,
  passPoint,
  scanAhead,
  uniqueExit,
  type Ahead,
  type AheadNode,
} from './analysis';
import type { Clause } from './instructions';

export interface Reading {
  /** The junction where the clause is carried out. */
  node: string;
  /** The node the listener drives towards when leaving it. */
  to: string;
  /** Distance ahead of the starting position. */
  s: number;
}

/** A landmark must be at least this far ahead to be "après" or "avant" (not already beside the car). */
export const MIN_AHEAD = 40;

/** Nodes before the first roundabout: street instructions never reach past one. */
function beforeRing(ahead: Ahead): AheadNode[] {
  const i = ahead.nodes.findIndex((n) => n.onRing);
  return i === -1 ? ahead.nodes : ahead.nodes.slice(0, i);
}

function take(n: AheadNode | undefined, kind: 'LEFT' | 'RIGHT' | 'STRAIGHT'): Reading | null {
  if (!n) return null;
  const exit = uniqueExit(n, kind);
  return exit ? { node: n.node, to: exit.step.to, s: n.s } : null;
}

export function interpret(graph: TownGraph, from: MoverStart, clause: Clause, mode: TravelMode): Reading | null {
  const ahead = scanAhead(graph, from, mode);
  switch (clause.action) {
    case 'STRAIGHT': {
      // "Continuez tout droit": carry straight on through the next junction.
      const next = ahead.nodes.find(isDecision);
      if (!next || next.onRing) return null;
      return take(next, 'STRAIGHT');
    }

    case 'TURN': {
      const streets = beforeRing(ahead).filter((n) => opensOn(n, clause.side));
      if (!clause.landmark) return take(streets[0], clause.side);

      const location = locationById(graph, clause.landmark);
      if (!location) return null;
      const decisions = ahead.nodes.filter(isDecision);

      if (clause.relation === 'DEVANT') {
        // The one junction ahead that stands at the place.
        const at = decisions.filter((n) => isAt(graph, location, n.node));
        if (at.length !== 1) return null;
        const junction = at[0] as AheadNode;
        return streets.includes(junction) ? take(junction, clause.side) : null;
      }

      // "après" / "avant": the place must be beside the road ahead, and not at
      // any junction where the turn could be made (that would read as "devant").
      const s = passPoint(ahead, location);
      if (s === undefined || s < MIN_AHEAD) return null;
      if (streets.some((n) => isAt(graph, location, n.node))) return null;
      if (clause.relation === 'APRES') return take(streets.find((n) => n.s > s), clause.side);
      if (clause.relation === 'AVANT') {
        const before = streets.filter((n) => n.s < s);
        return take(before[before.length - 1], clause.side);
      }
      return null;
    }

    case 'TAKE_STREET': {
      const streets = beforeRing(ahead).filter((n) => opensOn(n, clause.side));
      return take(streets[clause.ordinal - 1], clause.side);
    }

    case 'ROUNDABOUT_EXIT': {
      // Drive to the first roundabout, then count the exits around it.
      const first = ahead.nodes.findIndex((n) => n.onRing);
      if (first === -1) return null;
      const approach = ahead.nodes.slice(0, first);
      if (approach.some((n) => n.kind === 'T_JUNCTION' || n.kind === 'DEAD_END')) return null;
      const exits = ahead.nodes.slice(first).filter((n) => n.onRing && n.exits.some((e) => e.kind === 'RIGHT'));
      return take(exits[clause.ordinal - 1], 'RIGHT');
    }

    case 'CONTINUE_UNTIL': {
      // Keep going until level with the place; valid only if no choice comes first.
      const location = locationById(graph, clause.landmark);
      if (!location) return null;
      const s = passPoint(ahead, location);
      if (s === undefined) return null;
      if (ahead.nodes.some((n) => n.s < s && (n.kind === 'T_JUNCTION' || n.kind === 'DEAD_END'))) return null;
      // The reading is the last node reached before (or at) the place.
      const reached = ahead.nodes.filter((n) => n.s <= s + 1);
      const last = reached[reached.length - 1];
      return last ? { node: last.node, to: last.node, s } : null;
    }

    case 'WRONG_STREET':
    case 'U_TURN':
      return null;
  }
}
