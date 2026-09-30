import type { Difficulty } from '../difficulty';

/**
 * Chase tuning per difficulty (provisional; tune in playtesting).
 * Distances are metres measured along roads, not straight lines.
 */
export interface ChaseSettings {
  /** Length of the suspect's route. */
  routeLength: [number, number];
  /** How far ahead of the player the suspect starts. */
  headStart: number;
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
    headStart: 220,
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
    headStart: 240,
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
    headStart: 260,
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
    headStart: 280,
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
