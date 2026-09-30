/**
 * Structured scanner instructions (blueprint section 14) and their French.
 *
 * An instruction is a list of clauses built from the approved templates. The
 * French sentence and the audio ID are both derived from the clauses, so the
 * text on screen, the recording played and the route on the map can never
 * disagree. Words are never joined freely: every sentence shape below is a
 * fixed template with slots for a side, an ordinal or an approved location.
 */

import type { Difficulty } from '../difficulty';
import { LOCATION_WORD_BY_ID, withArticle, withPreposition } from './locations';

export type Side = 'LEFT' | 'RIGHT';
/** Where a turn is, relative to a place: devant (at), après (after), avant (before). */
export type Relation = 'DEVANT' | 'APRES' | 'AVANT';
/** "la prochaine" and "la première" mean the same street; both are approved. */
export type OrdinalWord = 'PROCHAINE' | 'PREMIERE' | 'DEUXIEME' | 'TROISIEME';

export type Clause =
  /** Tournez à gauche. / Tournez à gauche après la banque. */
  | { action: 'TURN'; side: Side; landmark?: string; relation?: Relation }
  /** Prenez la deuxième rue à droite. */
  | { action: 'TAKE_STREET'; side: Side; ordinal: number; word: OrdinalWord }
  /** Au rond-point, prenez la deuxième sortie. */
  | { action: 'ROUNDABOUT_EXIT'; ordinal: number; word: OrdinalWord }
  /** Continuez tout droit. */
  | { action: 'STRAIGHT' }
  /** Continuez jusqu'à la banque. / Allez jusqu'au cinéma. */
  | { action: 'CONTINUE_UNTIL'; landmark: string; verb: 'CONTINUEZ' | 'ALLEZ' }
  /** Ce n'est pas la bonne rue. */
  | { action: 'WRONG_STREET' }
  /** Faites demi-tour. */
  | { action: 'U_TURN' };

/**
 * Template families from blueprint section 12, plus RB (roundabout exits with
 * "la sortie", approved) and R (recovery lines).
 */
export type TemplateId = 'E1' | 'E2' | 'E3' | 'I1' | 'I2' | 'I3' | 'RB' | 'R';

export interface Instruction {
  template: TemplateId;
  clauses: Clause[];
  /** The full French sentence, exactly as it will be recorded. */
  text: string;
  /** One recording per sentence (the approved hybrid audio plan for 1- and 2-step instructions). */
  audioId: string;
  /** For route instructions: the junctions (node IDs) the clauses refer to, in order. For debug and tests. */
  atNodes: string[];
}

const SIDE_FR: Record<Side, string> = { LEFT: 'à gauche', RIGHT: 'à droite' };
const RELATION_FR: Record<Relation, string> = { DEVANT: 'devant', APRES: 'après', AVANT: 'avant' };
const ORDINAL_FR: Record<OrdinalWord, string> = {
  PROCHAINE: 'prochaine',
  PREMIERE: 'première',
  DEUXIEME: 'deuxième',
  TROISIEME: 'troisième',
};

export const ORDINAL_WORDS: readonly OrdinalWord[] = ['PREMIERE', 'DEUXIEME', 'TROISIEME'];

function place(id: string) {
  const word = LOCATION_WORD_BY_ID.get(id);
  if (!word) throw new Error(`Unknown location ${id}`);
  return word;
}

/** A clause as French words, starting with a capital letter and with no final full stop. */
export function clauseText(clause: Clause): string {
  switch (clause.action) {
    case 'TURN': {
      const base = `Tournez ${SIDE_FR[clause.side]}`;
      if (!clause.landmark || !clause.relation) return base;
      return `${base} ${RELATION_FR[clause.relation]} ${withArticle(place(clause.landmark))}`;
    }
    case 'TAKE_STREET':
      return `Prenez la ${ORDINAL_FR[clause.word]} rue ${SIDE_FR[clause.side]}`;
    case 'ROUNDABOUT_EXIT':
      return `Au rond-point, prenez la ${ORDINAL_FR[clause.word]} sortie`;
    case 'STRAIGHT':
      return 'Continuez tout droit';
    case 'CONTINUE_UNTIL':
      return `${clause.verb === 'ALLEZ' ? 'Allez' : 'Continuez'} ${withPreposition("jusqu'à", place(clause.landmark))}`;
    case 'WRONG_STREET':
      return "Ce n'est pas la bonne rue";
    case 'U_TURN':
      return 'Faites demi-tour';
  }
}

/** Stable audio key for one clause, e.g. "turn.left.apres.bank", "street.right.2", "roundabout.3". */
export function clauseKey(clause: Clause): string {
  const side = (s: Side) => s.toLowerCase();
  switch (clause.action) {
    case 'TURN':
      return clause.landmark && clause.relation
        ? `turn.${side(clause.side)}.${clause.relation.toLowerCase()}.${clause.landmark.toLowerCase()}`
        : `turn.${side(clause.side)}`;
    case 'TAKE_STREET':
      return `street.${side(clause.side)}.${clause.word.toLowerCase()}`;
    case 'ROUNDABOUT_EXIT':
      return `roundabout.${clause.word.toLowerCase()}`;
    case 'STRAIGHT':
      return 'straight';
    case 'CONTINUE_UNTIL':
      return `${clause.verb.toLowerCase()}_until.${clause.landmark.toLowerCase()}`;
    case 'WRONG_STREET':
      return 'wrong_street';
    case 'U_TURN':
      return 'u_turn';
  }
}

/** The sentence for one or two clauses: "Tournez à gauche, puis prenez la première rue à droite." */
export function sentence(clauses: readonly Clause[]): string {
  if (clauses.length === 1) return `${clauseText(clauses[0] as Clause)}.`;
  if (clauses.length === 2) {
    const second = clauseText(clauses[1] as Clause);
    const joined = second.startsWith('Au ') ? `puis, ${lowerFirst(second)}` : `puis ${lowerFirst(second)}`;
    return `${clauseText(clauses[0] as Clause)}, ${joined}.`;
  }
  throw new Error('Instructions have one or two clauses in this milestone');
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function audioIdFor(clauses: readonly Clause[]): string {
  return clauses.length === 1 ? `dir.${clauseKey(clauses[0] as Clause)}` : `seq.${clauses.map(clauseKey).join('+puis+')}`;
}

/** The template a clause (or pair of clauses) belongs to at a given difficulty. */
export function templateFor(clauses: readonly Clause[], difficulty: Difficulty): TemplateId {
  if (clauses.length === 2) return 'I3';
  const c = clauses[0] as Clause;
  switch (c.action) {
    case 'TURN':
      if (!c.relation) return 'E1';
      // "après" and "devant" are Easy landmark turns (E3); "avant" is Intermediate (I1).
      return c.relation === 'AVANT' || difficulty !== 'EASY' ? 'I1' : 'E3';
    case 'STRAIGHT':
      return 'E1';
    case 'CONTINUE_UNTIL':
      return 'E2';
    case 'TAKE_STREET':
      return 'I2';
    case 'ROUNDABOUT_EXIT':
      return 'RB';
    case 'WRONG_STREET':
    case 'U_TURN':
      return 'R';
  }
}

export function makeInstruction(clauses: Clause[], difficulty: Difficulty, atNodes: string[] = []): Instruction {
  return {
    template: templateFor(clauses, difficulty),
    clauses,
    text: sentence(clauses),
    audioId: audioIdFor(clauses),
    atNodes,
  };
}

/** Ordinal word for a count: 1 → PREMIERE (or PROCHAINE for streets), 2 → DEUXIEME, 3 → TROISIEME. */
export function ordinalWord(n: number, next = false): OrdinalWord {
  if (n === 1) return next ? 'PROCHAINE' : 'PREMIERE';
  const word = ORDINAL_WORDS[n - 1];
  if (!word) throw new RangeError(`No ordinal word for ${n}`);
  return word;
}
