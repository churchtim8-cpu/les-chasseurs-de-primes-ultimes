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

import { DIFFICULTIES, type Difficulty } from '../difficulty';
import { isDecision, scanAhead } from '../language/analysis';
import { describe, positionLeaving, readsAs } from '../language/generate';
import { makeInstruction, type Clause, type TemplateId } from '../language/instructions';
import { LANGUAGE_SETTINGS } from '../language/settings';
import { canTravel, type TownGraph, type TravelMode } from '../world/graph';

/** Two voices (blueprint section 17): the calm dispatcher and the officer in the car. */
export type Voice = 'DISPATCHER' | 'OFFICER';
export type LineCategory = 'DIRECTION' | 'RECOVERY' | 'REPEAT' | 'OUTCOME';

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

type Collected = Map<string, ScriptLine>;

function addLine(out: Collected, line: Omit<ScriptLine, 'levels'>, level: Difficulty): void {
  const existing = out.get(line.audioId);
  if (existing) {
    if (!existing.levels.includes(level)) existing.levels.push(level);
    return;
  }
  out.set(line.audioId, { ...line, levels: [level] });
}

function addClauses(out: Collected, clauses: Clause[], level: Difficulty): void {
  const instruction = makeInstruction(clauses, level);
  if ((LANGUAGE_SETTINGS[level].weights[instruction.template] ?? 0) <= 0 && instruction.template !== 'R') return;
  addLine(
    out,
    {
      audioId: instruction.audioId,
      text: instruction.text,
      voice: 'DISPATCHER',
      category: instruction.template === 'R' ? 'RECOVERY' : 'DIRECTION',
      template: instruction.template,
    },
    level,
  );
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

/** Direction sentences the generator can produce and accept anywhere on the map, for one level. */
function directionLines(graph: TownGraph, level: Difficulty, out: Collected, mode: TravelMode): void {
  const settings = LANGUAGE_SETTINGS[level];
  for (const start of starts(graph, mode)) {
    const pos = positionLeaving(graph, start.from, start.to, mode);
    const ahead = scanAhead(graph, pos, mode);
    for (const node of ahead.nodes.filter(isDecision)) {
      for (const exit of node.exits) {
        if (exit.kind !== 'LEFT' && exit.kind !== 'RIGHT') continue;
        const valid = describe(graph, pos, node.node, exit.step.to, level, false).filter((c) =>
          readsAs(graph, pos, c, node.node, exit.step.to),
        );
        for (const clause of valid) addClauses(out, [clause], level);

        // "…, puis …" pairs: a second action shortly after this one.
        if ((settings.weights.I3 ?? 0) <= 0) continue;
        const firsts = valid.filter((c) => !('landmark' in c && c.landmark));
        if (firsts.length === 0) continue;
        const pos2 = positionLeaving(graph, node.node, exit.step.to, mode);
        const ahead2 = scanAhead(graph, pos2, mode, settings.pairWithin);
        for (const node2 of ahead2.nodes.filter(isDecision)) {
          if (node2.s > settings.pairWithin) break;
          for (const exit2 of node2.exits) {
            if (exit2.kind !== 'LEFT' && exit2.kind !== 'RIGHT') continue;
            const seconds = describe(graph, pos2, node2.node, exit2.step.to, level, true).filter((c) =>
              readsAs(graph, pos2, c, node2.node, exit2.step.to),
            );
            for (const c1 of firsts) for (const c2 of seconds) addClauses(out, [c1, c2], level);
          }
        }
      }
    }
  }
}

/** The complete recording script, sorted by category then text. */
export function buildScript(graph: TownGraph, mode: TravelMode = 'CAR'): ScriptLine[] {
  const out: Collected = new Map();
  for (const level of DIFFICULTIES) {
    directionLines(graph, level, out, mode);
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
  }
  const order: LineCategory[] = ['DIRECTION', 'RECOVERY', 'REPEAT', 'OUTCOME'];
  return [...out.values()].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.text.localeCompare(b.text, 'fr'),
  );
}
