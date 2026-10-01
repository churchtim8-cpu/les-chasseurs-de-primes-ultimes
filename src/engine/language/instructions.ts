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
 *
 *   H1  Tournez à gauche devant la banque, puis prenez la première rue à droite.
 *   H2  Tournez à droite après le cinéma, puis tournez à gauche.
 *   H3  Tournez à gauche, puis tournez à droite. Ensuite, prenez la deuxième rue à gauche.
 *   H4  Prenez la troisième rue à droite. (third street, Hard and Expert)
 *   X1  D'abord, tournez à gauche. Ensuite, … Enfin, …
 *   X2  The same with more than one landmark in the one transmission.
 */
export type TemplateId = 'E1' | 'E2' | 'E3' | 'I1' | 'I2' | 'I3' | 'H1' | 'H2' | 'H3' | 'H4' | 'X1' | 'X2' | 'RB' | 'R';

/**
 * How several clauses are spoken. SENTENCE: "…, puis …" (plus "Ensuite, …"
 * for a third step at Hard). LINKED: Expert's "D'abord, … Ensuite, … Enfin, …".
 */
export type Form = 'SENTENCE' | 'LINKED';

/**
 * One recording. Single steps and plain "…, puis …" pairs are single
 * sentence clips. Longer instructions add whole clauses recorded with their
 * linking word ("Puis tournez à droite.", "Ensuite, tournez à gauche.") and
 * played back to back (approved Decision 1), so no new combinations of
 * landmarks and turns need recording.
 */
export interface Clip {
  audioId: string;
  text: string;
}

export interface Instruction {
  template: TemplateId;
  form: Form;
  clauses: Clause[];
  /** The full French, exactly as it will be heard. */
  text: string;
  /** The recordings played in order. */
  clips: Clip[];
  /** One stable ID for the whole instruction (the clip's own ID when there is one clip). */
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
  throw new Error('A sentence has one or two clauses; longer instructions are linked clauses');
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export type LinkWord = 'PUIS' | 'DABORD' | 'ENSUITE' | 'ENFIN';
const LINK_FR: Record<LinkWord, string> = { PUIS: 'Puis', DABORD: "D'abord,", ENSUITE: 'Ensuite,', ENFIN: 'Enfin,' };

/** A clause recorded with its linking word: "Ensuite, prenez la deuxième rue à gauche." / "Puis tournez à droite." */
export function linkedClip(word: LinkWord, clause: Clause): Clip {
  const text = lowerFirst(clauseText(clause));
  // As in the "…, puis …" sentences: "Puis, au rond-point, prenez la deuxième sortie."
  const link = word === 'PUIS' && text.startsWith('au ') ? 'Puis,' : LINK_FR[word];
  return { audioId: `link.${word.toLowerCase()}.${clauseKey(clause)}`, text: `${link} ${text}.` };
}

function sentenceClip(clauses: readonly Clause[]): Clip {
  return { audioId: audioIdFor(clauses), text: sentence(clauses) };
}

export function audioIdFor(clauses: readonly Clause[]): string {
  return clauses.length === 1 ? `dir.${clauseKey(clauses[0] as Clause)}` : `seq.${clauses.map(clauseKey).join('+puis+')}`;
}

/** The linking words for a linked instruction of n clauses: D'abord, Ensuite, (Enfin). */
export function linkWords(n: number): LinkWord[] {
  if (n === 2) return ['DABORD', 'ENSUITE'];
  if (n === 3) return ['DABORD', 'ENSUITE', 'ENFIN'];
  throw new Error('Linked instructions have two or three clauses');
}

const hasLandmark = (c: Clause) => c.action === 'TURN' && c.landmark !== undefined;

/** The recordings for these clauses spoken in this form. */
export function clipsFor(clauses: readonly Clause[], form: Form): Clip[] {
  if (form === 'LINKED') return linkWords(clauses.length).map((w, i) => linkedClip(w, clauses[i] as Clause));
  const [first, second, third] = clauses as [Clause, Clause?, Clause?];
  if (!second) return [sentenceClip(clauses)];
  // H1, H2: the landmark sentence already recorded, then "Puis …" (one clip per simple action).
  if (hasLandmark(first)) return [sentenceClip([first]), linkedClip('PUIS', second)];
  if (!third) return [sentenceClip(clauses)];
  // H3: the "…, puis …" sentence for the first two steps, then "Ensuite, …".
  return [sentenceClip([first, second]), linkedClip('ENSUITE', third)];
}

/** The template a set of clauses belongs to at a level, or null if no template has that shape. */
export function templateFor(clauses: readonly Clause[], difficulty: Difficulty, form: Form = 'SENTENCE'): TemplateId | null {
  const landmarks = clauses.filter(hasLandmark).length;
  if (form === 'LINKED') {
    if (clauses.length < 2 || clauses.length > 3) return null;
    return landmarks >= 2 ? 'X2' : 'X1';
  }
  if (clauses.length === 3) return landmarks === 0 ? 'H3' : null;
  if (clauses.length === 2) {
    if (landmarks === 0) return 'I3';
    const [first, second] = clauses as [Clause, Clause];
    if (hasLandmark(second) || first.action !== 'TURN') return null;
    // Action + landmark, then an action (H1: "devant"); action + relation + place, then an action (H2).
    return first.relation === 'DEVANT' ? 'H1' : 'H2';
  }
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
      // "la troisième rue" is a Hard construction (H4); Intermediate may use it too (Mr Henry).
      return c.ordinal === 3 && (difficulty === 'HARD' || difficulty === 'EXPERT') ? 'H4' : 'I2';
    case 'ROUNDABOUT_EXIT':
      return 'RB';
    case 'WRONG_STREET':
    case 'U_TURN':
      return 'R';
  }
}

export function makeInstruction(
  clauses: Clause[],
  difficulty: Difficulty,
  atNodes: string[] = [],
  form: Form = 'SENTENCE',
): Instruction {
  const template = templateFor(clauses, difficulty, form);
  if (!template) throw new Error(`No template for ${clauses.map(clauseKey).join(', ')} (${form})`);
  const clips = clipsFor(clauses, form);
  return {
    template,
    form,
    clauses,
    text: clips.map((c) => c.text).join(' '),
    clips,
    audioId: clips.map((c) => c.audioId).join(' '),
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
