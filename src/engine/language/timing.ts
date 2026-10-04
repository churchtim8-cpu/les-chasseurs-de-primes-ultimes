/**
 * Timing of scanner calls (see SPEECH): how long a line takes to say, when
 * each step of a direction has been heard, and whether a direction can be
 * heard out, and acted on, before the car or runner reaches each junction it
 * is about. Directions are chosen with this, so the chase never has to slow
 * down for the French.
 */

import { clauseText, type Clause, type Clip, type Instruction } from './instructions';
import { SPEECH } from './settings';

/** Upper bound on how long one recorded line takes to say. */
export function speechSeconds(text: string): number {
  return text ? SPEECH.baseSeconds + text.length * SPEECH.secondsPerChar : 0;
}

/** How long the radio is busy with a call made of these lines (beep, voice, gaps, click). */
export function callSeconds(texts: readonly string[]): number {
  if (texts.length === 0) return 0;
  return (
    SPEECH.radioLeadSeconds +
    texts.reduce((sum, t) => sum + speechSeconds(t), 0) +
    SPEECH.clipGapSeconds * (texts.length - 1) +
    SPEECH.radioTailSeconds
  );
}

/** How long a clip lasts: the upper-bound estimate, unless the real recording's length is known. */
export type ClipSeconds = (clip: Pick<Clip, 'audioId' | 'text'>) => number;
const ESTIMATE: ClipSeconds = (clip) => speechSeconds(clip.text);

/**
 * For each clause of each instruction in a call, the seconds from the start
 * of the call (the radio beep) until that step has been said, in order. A
 * clip holding two steps ("…, puis …") has said the first one part-way
 * through, in proportion to its words. `lead` are lines spoken first in the
 * same call ("Attention ! …").
 */
export function heardTimes(
  instructions: readonly Instruction[],
  lead: readonly Pick<Clip, 'audioId' | 'text'>[] = [],
  seconds: ClipSeconds = ESTIMATE,
): number[] {
  let t = SPEECH.radioLeadSeconds;
  for (const line of lead) t += seconds(line) + SPEECH.clipGapSeconds;
  const out: number[] = [];
  for (const instruction of instructions) {
    let clause = 0;
    for (const clip of instruction.clips) {
      const length = seconds(clip);
      const inClip = clausesInClip(instruction, clip.text, clause);
      const total = inClip.reduce((n, c) => n + clauseText(c).length, 0) || 1;
      let said = 0;
      for (const c of inClip) {
        said += clauseText(c).length;
        out.push(t + length * (said / total));
      }
      clause += inClip.length;
      t += length + SPEECH.clipGapSeconds;
    }
  }
  return out;
}

/** The clauses a clip says: the rest of them when it is the instruction's last clip, otherwise one (or two for "…, puis …"). */
function clausesInClip(instruction: Instruction, text: string, from: number): Clause[] {
  const rest = instruction.clauses.slice(from);
  if (instruction.clips.length === 1 || instruction.form === 'LINKED') {
    return instruction.clips.length === 1 ? rest : rest.slice(0, 1);
  }
  // H3: the "…, puis …" sentence holds the first two steps, then "Ensuite, …" the third.
  return text.includes(', puis ') ? rest.slice(0, 2) : rest.slice(0, 1);
}

/**
 * Seconds of travel needed before the junction of each step: until the step
 * has been heard (after `delay` seconds of waiting for the radio), plus time
 * to react.
 */
export function neededSeconds(instructions: readonly Instruction[], delay = 0): number[] {
  return heardTimes(instructions).map((t) => delay + t + SPEECH.reactSeconds);
}
