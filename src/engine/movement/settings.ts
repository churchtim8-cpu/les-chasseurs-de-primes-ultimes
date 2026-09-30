import type { TravelMode } from '../world/graph';

/**
 * Movement tuning. Distances are map metres, but speeds are "game speeds"
 * chosen for feel: a car crosses Bellevue (2.4 km) in about half a minute so a
 * chase fits its timer. Tune during playtesting.
 */
export interface MovementSettings {
  /** Speed the player settles at with no input (units per second). */
  cruise: number;
  /** Top speed while accelerating. */
  max: number;
  acceleration: number;
  braking: number;
}

export const MOVEMENT: Record<TravelMode, MovementSettings> = {
  CAR: { cruise: 70, max: 100, acceleration: 45, braking: 150 },
  FOOT: { cruise: 22, max: 30, acceleration: 60, braking: 120 },
};

/** How close (metres) the player must be to the parked car to get back in. */
export const BOARDING_DISTANCE = 30;
