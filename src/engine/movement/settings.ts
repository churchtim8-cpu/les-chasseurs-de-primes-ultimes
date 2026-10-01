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
  CAR: { cruise: 85, max: 115, acceleration: 55, braking: 170 },
  FOOT: { cruise: 26, max: 34, acceleration: 70, braking: 130 },
};

/** How close (metres) the player must be to the parked car to get back in. */
export const BOARDING_DISTANCE = 30;
