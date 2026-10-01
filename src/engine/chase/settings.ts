import type { Difficulty } from '../difficulty';
import type { TravelMode } from '../world/graph';

/**
 * Chase types (blueprint section 8): how the suspect travels, stage by stage.
 * The player starts in the suspect's first mode and changes when the suspect does.
 */
export const CHASE_TYPES = ['CAR_CAR', 'FOOT_FOOT', 'CAR_FOOT', 'FOOT_CAR', 'CAR_FOOT_CAR', 'FOOT_CAR_FOOT'] as const;
export type ChaseType = (typeof CHASE_TYPES)[number];

export const CHASE_TYPE_MODES: Record<ChaseType, TravelMode[]> = {
  CAR_CAR: ['CAR'],
  FOOT_FOOT: ['FOOT'],
  CAR_FOOT: ['CAR', 'FOOT'],
  FOOT_CAR: ['FOOT', 'CAR'],
  CAR_FOOT_CAR: ['CAR', 'FOOT', 'CAR'],
  FOOT_CAR_FOOT: ['FOOT', 'CAR', 'FOOT'],
};

/**
 * How often each chase type comes up per difficulty (relative weights; missing = never).
 * Easy is mostly Car → Car; transport changes grow with the level, and the
 * three-stage chains are Expert only (blueprint sections 8 and 10).
 */
export const CHASE_TYPE_WEIGHTS: Record<Difficulty, Partial<Record<ChaseType, number>>> = {
  EASY: { CAR_CAR: 4, FOOT_FOOT: 1 },
  INTERMEDIATE: { CAR_CAR: 3, CAR_FOOT: 2, FOOT_FOOT: 1 },
  HARD: { CAR_CAR: 2, CAR_FOOT: 2, FOOT_CAR: 1.5, FOOT_FOOT: 1 },
  EXPERT: { CAR_CAR: 1, CAR_FOOT: 1.5, FOOT_CAR: 1.5, CAR_FOOT_CAR: 1, FOOT_CAR_FOOT: 1 },
};

/** Transport-change tuning, shared by all levels (provisional). */
export const TRANSFER = {
  /** Seconds the suspect takes to get out of or into a car. */
  suspectSeconds: 1.5,
  /** "Descendez de la voiture !" is said when the player is this close (metres) to where the suspect got out. */
  getOutWithin: 70,
  /**
   * When the suspect gets into a car, a colleague brings the police car to the
   * nearest road; the player can get in from this far away (metres).
   */
  pickupWithin: 160,
  /** Extra time on the clock for each change of transport (getting out, catching up on foot is slow). */
  extraSeconds: 12,
} as const;

/**
 * Chase tuning per difficulty (provisional; tune in playtesting).
 * Distances are metres measured along roads, not straight lines.
 */
export interface ChaseSettings {
  /** Length of the suspect's route in a Car → Car chase. */
  routeLength: [number, number];
  /** Length of a whole Foot → Foot chase. */
  footRouteLength: [number, number];
  /** Length of each stage when the suspect changes transport: walking is three times slower than driving. */
  stageLength: Record<TravelMode, [number, number]>;
  /** How far ahead of the player the suspect starts, by starting mode. */
  headStart: Record<TravelMode, number>;
  /** Suspect speed as a fraction of the player's cruising speed. */
  suspectSpeed: number;
  /**
   * Suspect speed when the player is close. Close to the player's own speed, so
   * a player who follows correctly closes in steadily and usually makes the
   * arrest near the end of the route, after several instructions.
   */
  suspectFleeSpeed: number;
  /** Distance under which the suspect starts fleeing faster. */
  fleeDistance: number;
  /** Distance at which the suspect is visible on the map (a sighting). */
  sightingDistance: number;
  /** Capture when this close... */
  captureDistance: number;
  /** ...for this many seconds. */
  captureHold: number;
  /** Warnings start beyond this distance. */
  warningDistance: number;
  /** Escape when this far away... */
  escapeDistance: number;
  /** ...for this many seconds (the player gets a chance to recover first). */
  escapeHold: number;
}

export const CHASE_SETTINGS: Record<Difficulty, ChaseSettings> = {
  EASY: {
    routeLength: [1300, 2200],
    footRouteLength: [600, 950],
    stageLength: { CAR: [1000, 1500], FOOT: [250, 400] },
    headStart: { CAR: 220, FOOT: 90 },
    suspectSpeed: 0.78,
    suspectFleeSpeed: 0.97,
    fleeDistance: 160,
    sightingDistance: 170,
    captureDistance: 28,
    captureHold: 0.6,
    warningDistance: 600,
    escapeDistance: 850,
    escapeHold: 4,
  },
  INTERMEDIATE: {
    routeLength: [1700, 2700],
    footRouteLength: [650, 1000],
    stageLength: { CAR: [1000, 1600], FOOT: [250, 420] },
    headStart: { CAR: 240, FOOT: 95 },
    suspectSpeed: 0.8,
    suspectFleeSpeed: 0.97,
    fleeDistance: 160,
    sightingDistance: 150,
    captureDistance: 28,
    captureHold: 0.7,
    warningDistance: 550,
    escapeDistance: 800,
    escapeHold: 3.5,
  },
  HARD: {
    routeLength: [2100, 3300],
    footRouteLength: [700, 1050],
    stageLength: { CAR: [1100, 1700], FOOT: [260, 440] },
    headStart: { CAR: 260, FOOT: 100 },
    suspectSpeed: 0.82,
    suspectFleeSpeed: 0.97,
    fleeDistance: 160,
    sightingDistance: 130,
    captureDistance: 26,
    captureHold: 0.8,
    warningDistance: 500,
    escapeDistance: 750,
    escapeHold: 3,
  },
  EXPERT: {
    routeLength: [2400, 3800],
    footRouteLength: [700, 1100],
    stageLength: { CAR: [1000, 1600], FOOT: [250, 420] },
    headStart: { CAR: 280, FOOT: 105 },
    suspectSpeed: 0.85,
    suspectFleeSpeed: 0.97,
    fleeDistance: 160,
    sightingDistance: 110,
    captureDistance: 25,
    captureHold: 0.9,
    warningDistance: 480,
    escapeDistance: 700,
    escapeHold: 2.5,
  },
};
