import type { Rng } from '../rng/prng';

/**
 * Weather in Bellevue (Mr Henry, 2026-10-04): rain and fog make the chase
 * harder to see, so students lean on the French directions even more. Weather
 * is drawing only, and never adds noise: the scanner stays as clear as ever.
 * The suspect also shows up a little later in bad weather (drawn closer).
 */
export const WEATHERS = ['CLEAR', 'RAIN', 'FOG'] as const;
export type Weather = (typeof WEATHERS)[number];

export const WEATHER = {
  /** Share of the usual sighting distance at which the suspect is drawn. */
  seeFactor: { CLEAR: 1, RAIN: 0.8, FOG: 0.6 } as Record<Weather, number>,
  /** How often each weather comes up when it is chosen at random (and for the daily chase). */
  odds: { CLEAR: 5, RAIN: 3, FOG: 2 } as Record<Weather, number>,
  rain: {
    /** Streaks on screen at once, their length (px) and fall speed (px/s); the slant is the wind. */
    drops: 190,
    length: [16, 30] as const,
    speed: [900, 1300] as const,
    slant: 0.22,
    /** The grey-blue gloom over the town, and a flash of lightning every so often (seconds). */
    gloom: { colour: 0x24364a, alpha: 0.3 },
    lightningEvery: [14, 28] as const,
  },
  fog: {
    /** Clear radius around the player and where the fog is thickest, as shares of the screen height. */
    clearRadius: 0.27,
    thickRadius: 0.85,
    colour: 0xdfe5e8,
    thickAlpha: 0.82,
    /** Slow drifting banks of mist. */
    banks: 7,
  },
} as const;

/** Random weather, by the odds above. */
export function pickWeather(rng: Rng): Weather {
  return rng.weighted(WEATHERS, WEATHERS.map((w) => WEATHER.odds[w]));
}
