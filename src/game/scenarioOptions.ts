import type { ScenarioOptions } from '../engine/chase/scenario';
import { CHASE_TYPES, type ChaseType } from '../engine/chase/settings';

/**
 * Debug and tests: `?type=CAR_FOOT` forces a chase type; `?turnoff=1` (or 0) a
 * change of direction, `?sightings=1` a sighting (off by default), `?lost=1` a lost signal.
 * (`?life=0` turns off the town's traffic and other movement.)
 */
export function scenarioOptionsFromAddress(): ScenarioOptions {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');
  const flag = (name: string) => {
    const value = params.get(name);
    return value === '1' || value === '0' ? value === '1' : undefined;
  };
  const turnOff = flag('turnoff');
  const sightings = flag('sightings');
  const lostSignal = flag('lost');
  return {
    ...(type && (CHASE_TYPES as readonly string[]).includes(type) ? { chaseType: type as ChaseType } : {}),
    ...(turnOff !== undefined ? { turnOff } : {}),
    ...(sightings !== undefined ? { sightings } : {}),
    ...(lostSignal !== undefined ? { lostSignal } : {}),
  };
}
