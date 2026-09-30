/**
 * The repeat mechanic (blueprint section 16): the player asks for the last
 * call again, a police officer asks the dispatcher to repeat, and the
 * original transmission plays again, unchanged. How many repeats a chase
 * allows, and what they cost, comes from DIFFICULTY_SETTINGS.
 */

import { REPEAT_URGENCY, type RepeatRule } from '../difficulty';
import { REPEAT_LINES } from './script';

export type Urgency = keyof typeof REPEAT_LINES;

export type RepeatResult =
  | { allowed: true; urgency: Urgency; penaltySeconds: number }
  | { allowed: false; reason: 'NO_REPEATS_LEFT' };

/** The officer sounds more urgent as the signal to the suspect weakens. */
export function repeatUrgency(signal: number, warning: boolean): Urgency {
  if (warning || signal < REPEAT_URGENCY.franticBelowSignal) return 'FRANTIC';
  if (signal < REPEAT_URGENCY.urgentBelowSignal) return 'URGENT';
  return 'CALM';
}

export class RepeatCounter {
  /** Repeats used this chase (recorded for scoring). */
  used = 0;

  constructor(private readonly rule: RepeatRule) {}

  /** Repeats left this chase, or null when there is no limit. */
  get left(): number | null {
    switch (this.rule.kind) {
      case 'LIMITED':
        return Math.max(0, this.rule.maxPerChase - this.used);
      case 'ONCE':
        return Math.max(0, 1 - this.used);
      default:
        return null;
    }
  }

  request(signal: number, warning: boolean): RepeatResult {
    if (this.left === 0) return { allowed: false, reason: 'NO_REPEATS_LEFT' };
    this.used++;
    const penaltySeconds = this.rule.kind === 'COSTS_TIME' ? this.rule.secondsPerRepeat : 0;
    return { allowed: true, urgency: repeatUrgency(signal, warning), penaltySeconds };
  }
}
