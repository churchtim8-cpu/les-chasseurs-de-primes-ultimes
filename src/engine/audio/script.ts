/**
 * The recording script: every French line the game can play, so the whole
 * set can be recorded with ElevenLabs in one batch (and nothing is ever
 * generated live during a chase).
 *
 * Direction sentences are found by asking the generator itself, from every
 * road on the map, which sentences it could produce and accept there. So the
 * script contains exactly what the game can say, and the game can only say
 * what is in the script: at run time, a sentence without a recording is
 * never chosen (see `AudioCheck`).
 */

import { CHASE_SETTINGS, CHASE_TYPE_MODES, CHASE_TYPE_WEIGHTS, CHASE_TYPES, type ChaseType } from '../chase/settings';
import { DIFFICULTIES, type Difficulty } from '../difficulty';
import { isDecision, scanAhead } from '../language/analysis';
import { describe, positionLeaving, readsAs, weightOf } from '../language/generate';
import {
  linkedClip,
  linkWords,
  makeInstruction,
  templateFor,
  type Clause,
  type Form,
  type LinkWord,
  type TemplateId,
} from '../language/instructions';
import { LANGUAGE_SETTINGS } from '../language/settings';
import type { MoverStart } from '../movement/mover';
import { canTravel, type TownGraph, type TravelMode } from '../world/graph';

/** Two voices (blueprint section 17): the calm dispatcher and the officer in the car. */
export type Voice = 'DISPATCHER' | 'OFFICER';
export type LineCategory = 'DIRECTION' | 'RECOVERY' | 'EVENT' | 'REPEAT' | 'OUTCOME';

export interface ScriptLine {
  audioId: string;
  text: string;
  voice: Voice;
  category: LineCategory;
  template: TemplateId | null;
  /** Levels that can use this line. */
  levels: Difficulty[];
}

/**
 * The officer asks for a repeat, more urgently as the suspect gets away
 * (blueprint section 16). The dispatcher then replays the original clip.
 */
export const REPEAT_LINES = {
  CALM: { audioId: 'repeat.calm', text: "Pouvez-vous répéter, s'il vous plaît ?" },
  URGENT: { audioId: 'repeat.urgent', text: "Répétez, s'il vous plaît !" },
  FRANTIC: { audioId: 'repeat.frantic', text: 'Répétez ! Vite !' },
} as const;

/** End-of-chase lines from the approved success/failure vocabulary. */
export const OUTCOME_LINES = {
  CAPTURED: { audioId: 'outcome.captured', text: 'Le suspect est arrêté !' },
  ESCAPED: { audioId: 'outcome.escaped', text: "Le suspect s'est échappé." },
  WARNING: { audioId: 'event.moving_away', text: "Le suspect s'éloigne." },
} as const;

/**
 * Changes of transport mid-chase (blueprint sections 11 and 18). All from the
 * approved Events and Foot chase lists; "Montez dans la voiture !" completes
 * the approved "Montez…".
 */
export const TRANSPORT_LINES = {
  SUSPECT_LEFT_CAR: { audioId: 'event.suspect_left_car', text: 'Le suspect est sorti de la voiture.' },
  ON_FOOT: { audioId: 'event.on_foot', text: 'Il est à pied !' },
  GET_OUT: { audioId: 'event.get_out', text: 'Descendez de la voiture !' },
  SUSPECT_BOARDS: { audioId: 'event.suspect_boards', text: 'Il monte dans une voiture !' },
  GET_IN: { audioId: 'event.get_in', text: 'Montez dans la voiture !' },
} as const;

/** Chase events from the approved Events list (blueprint sections 11 and 18). */
export const EVENT_LINES = {
  ATTENTION: { audioId: 'event.attention', text: 'Attention !' },
  CHANGED_DIRECTION: { audioId: 'event.changed_direction', text: 'Le suspect a changé de direction.' },
} as const;

/** The transport lines a chase type can need. */
function transportLinesFor(type: ChaseType): (keyof typeof TRANSPORT_LINES)[] {
  const modes = CHASE_TYPE_MODES[type];
  const out = new Set<keyof typeof TRANSPORT_LINES>();
  for (let i = 1; i < modes.length; i++) {
    if (modes[i] === 'FOOT') ['SUSPECT_LEFT_CAR', 'ON_FOOT', 'GET_OUT'].forEach((k) => out.add(k as keyof typeof TRANSPORT_LINES));
    else ['SUSPECT_BOARDS', 'GET_IN'].forEach((k) => out.add(k as keyof typeof TRANSPORT_LINES));
  }
  return [...out];
}

type Collected = Map<string, ScriptLine>;

function addLine(out: Collected, line: Omit<ScriptLine, 'levels'>, level: Difficulty): void {
  const existing = out.get(line.audioId);
  if (existing) {
    if (!existing.levels.includes(level)) existing.levels.push(level);
    return;
  }
  out.set(line.audioId, { ...line, levels: [level] });
}

function addClauses(out: Collected, clauses: Clause[], level: Difficulty, form: Form = 'SENTENCE'): void {
  const template = templateFor(clauses, level, form);
  if (!template || (template !== 'R' && weightOf(clauses, level, form) <= 0)) return;
  const instruction = makeInstruction(clauses, level, [], form);
  for (const clip of instruction.clips) {
    addLine(
      out,
      {
        audioId: clip.audioId,
        text: clip.text,
        voice: 'DISPATCHER',
        category: template === 'R' ? 'RECOVERY' : 'DIRECTION',
        // A clause clip ("Ensuite, …") can be shared by several multi-step templates.
        template: instruction.clips.length === 1 ? template : null,
      },
      level,
    );
  }
}

/** Adds the clips of every multi-step instruction whose clauses come from these per-step choices. */
function addSteps(out: Collected, steps: Clause[][], level: Difficulty, form: Form): void {
  if (form === 'SENTENCE') {
    for (const combo of product(steps)) addClauses(out, combo, level, form);
    return;
  }
  // Linked clips hold one clause each, and X1/X2 accept any two or three clauses:
  // record each step's clauses once with that step's linking word.
  const weights = LANGUAGE_SETTINGS[level].weights;
  if ((weights.X1 ?? 0) <= 0 && (weights.X2 ?? 0) <= 0) return;
  const words = linkWords(steps.length);
  for (const [k, choices] of steps.entries()) {
    for (const c of choices) {
      addLine(out, { ...linkedClip(words[k] as LinkWord, c), voice: 'DISPATCHER', category: 'DIRECTION', template: null }, level);
    }
  }
}

function* product(steps: Clause[][]): Generator<Clause[]> {
  if (steps.length === 0) {
    yield [];
    return;
  }
  const [head, ...rest] = steps as [Clause[], ...Clause[][]];
  for (const c of head) for (const tail of product(rest)) yield [c, ...tail];
}

/** Every directed road start: a position just after leaving each node along each legal edge. */
function starts(graph: TownGraph, mode: TravelMode): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const edge of graph.map.edges) {
    if (canTravel(edge, mode, edge.from)) out.push({ from: edge.from, to: edge.to });
    if (canTravel(edge, mode, edge.to)) out.push({ from: edge.to, to: edge.from });
  }
  return out;
}

/**
 * Direction lines the generator can produce and accept anywhere on the map,
 * for one level: single sentences, and the multi-step instructions it can
 * build from two or three actions close together (each clause valid from
 * just after the turn before it, exactly as `instructionFor` checks).
 */
function directionLines(graph: TownGraph, level: Difficulty, out: Collected, mode: TravelMode): void {
  const settings = LANGUAGE_SETTINGS[level];
  const memo = new Map<string, Clause[]>();
  const validAt = (pos: MoverStart, node: string, to: string): Clause[] => {
    const key = `${pos.edgeId}|${pos.towards}|${node}|${to}`;
    let found = memo.get(key);
    if (!found) {
      found = describe(graph, pos, node, to, level, false).filter((c) => readsAs(graph, pos, c, node, to));
      memo.set(key, found);
    }
    return found;
  };
  /** Turns (node, exit, clauses) reachable straight on from `pos` within `within` metres. */
  const turnsAhead = (pos: MoverStart, within: number) => {
    const out2: { node: string; to: string; s: number; clauses: Clause[] }[] = [];
    for (const node of scanAhead(graph, pos, mode, within).nodes.filter(isDecision)) {
      if (node.s > within) break;
      for (const exit of node.exits) {
        if (exit.kind !== 'LEFT' && exit.kind !== 'RIGHT') continue;
        const clauses = validAt(pos, node.node, exit.step.to);
        if (clauses.length > 0) out2.push({ node: node.node, to: exit.step.to, s: node.s, clauses });
      }
    }
    return out2;
  };

  const forms: Form[] = ['SENTENCE', 'LINKED'];
  for (const start of starts(graph, mode)) {
    const pos = positionLeaving(graph, start.from, start.to, mode);
    for (const first of turnsAhead(pos, Infinity)) {
      for (const clause of first.clauses) addClauses(out, [clause], level);
      if (settings.pairWithin <= 0) continue;
      const pos1 = positionLeaving(graph, first.node, first.to, mode);
      for (const second of turnsAhead(pos1, settings.pairWithin)) {
        for (const form of forms) addSteps(out, [first.clauses, second.clauses], level, form);
        if (second.s >= settings.tripleWithin) continue;
        const pos2 = positionLeaving(graph, second.node, second.to, mode);
        for (const third of turnsAhead(pos2, settings.tripleWithin - second.s)) {
          for (const form of forms) addSteps(out, [first.clauses, second.clauses, third.clauses], level, form);
        }
      }
    }
  }
}

/** The complete recording script (driving and on foot), sorted by category then text. */
export function buildScript(graph: TownGraph, modes: readonly TravelMode[] = ['CAR', 'FOOT']): ScriptLine[] {
  const out: Collected = new Map();
  for (const level of DIFFICULTIES) {
    for (const mode of modes) directionLines(graph, level, out, mode);
    addClauses(out, [{ action: 'STRAIGHT' }], level);
    for (const location of graph.map.locations) {
      for (const verb of ['CONTINUEZ', 'ALLEZ'] as const) {
        addClauses(out, [{ action: 'CONTINUE_UNTIL', landmark: location.id, verb }], level);
      }
    }
    addClauses(out, [{ action: 'WRONG_STREET' }], level);
    addClauses(out, [{ action: 'U_TURN' }], level);
    for (const line of Object.values(REPEAT_LINES)) {
      addLine(out, { ...line, voice: 'OFFICER', category: 'REPEAT', template: null }, level);
    }
    for (const line of Object.values(OUTCOME_LINES)) {
      addLine(out, { ...line, voice: 'DISPATCHER', category: 'OUTCOME', template: null }, level);
    }
    if (CHASE_SETTINGS[level].directionChange > 0) {
      for (const line of [EVENT_LINES.ATTENTION, EVENT_LINES.CHANGED_DIRECTION]) {
        addLine(out, { ...line, voice: 'DISPATCHER', category: 'EVENT', template: null }, level);
      }
    }
    const types = CHASE_TYPES.filter((t) => (CHASE_TYPE_WEIGHTS[level][t] ?? 0) > 0);
    for (const key of new Set(types.flatMap(transportLinesFor))) {
      addLine(out, { ...TRANSPORT_LINES[key], voice: 'DISPATCHER', category: 'EVENT', template: null }, level);
    }
  }
  const order: LineCategory[] = ['DIRECTION', 'RECOVERY', 'EVENT', 'REPEAT', 'OUTCOME'];
  return [...out.values()].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.text.localeCompare(b.text, 'fr'),
  );
}
