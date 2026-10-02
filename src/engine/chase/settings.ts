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
  /**
   * Suspect speed (fraction of the player's cruising speed) before its last
   * stage: it keeps pace with the police, so the chase reaches every change of
   * transport and a wrong turn still costs ground. The police close in on the
   * last stage, at the level's `suspectSpeed`.
   */
  suspectSpeedBeforeLastStage: 1,
} as const;

/**
 * Foot routes (Mr Henry, 2026-10-02): a runner does not keep to the car
 * roads but cuts across the park and the square, down alleys between
 * buildings, over the footbridge and along the promenade.
 */
export const FOOT_ROUTES = {
  /** Chance that each random waypoint of a foot route is on a pedestrian-only way. */
  footwayWaypointChance: 0.75,
  /** A foot route has at least this share of its length on pedestrian-only ways... */
  minFootwayShare: 0.2,
  /** ...for this share of the attempts to build one (then any route will do). */
  strictAttempts: 0.75,
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
  /**
   * Suspect speed as a fraction of the player's cruising speed, by mode. The
   * suspect never stops or waits: the police are only slightly faster in a
   * car, so a player who follows the directions closes in steadily, and every
   * wrong turn lets it get further away. On foot the officer is fitter, so a
   * foot chase is a short sprint that closes faster. If the suspect reaches
   * its destination first, it escapes.
   */
  suspectSpeed: Record<TravelMode, number>;
  /** Distance at which the suspect is visible on the map: only when very close. */
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
  /**
   * Chance that the suspect changes direction mid-chase, away from the route
   * the scanner predicted: "Attention ! Le suspect a changé de direction."
   * followed by corrected directions (X3). Blueprint: few route changes at Easy.
   */
  directionChange: number;
  /**
   * Sightings (blueprint section 18): the scanner reports the suspect near a
   * place ("La voiture verte est près de la bibliothèque.") and the player
   * picks the matching suspect from `cards` choices within `pickSeconds`.
   * Off (count 0) at every level since the 2026-10-01 playtest: the owner
   * found the pop-up questions interrupting. `?sightings=1` still forces one.
   */
  sightings: { count: number; cards: number; pickSeconds: number };
  /**
   * Chance of a lost signal (Expert, blueprint section 10): right after a
   * multi-step call the scanner says "Nous avons perdu le signal." and goes
   * quiet, so the player must remember the directions.
   */
  lostSignal: number;
}

/** Vehicles the suspect can drive (approved vocabulary, blueprint section 11). */
export const VEHICLES = ['BLUE', 'BLACK', 'WHITE', 'GREEN', 'TAXI', 'VAN'] as const;
export type Vehicle = (typeof VEHICLES)[number];

/** Sighting tuning, shared by all levels (provisional). */
export const SIGHTING = {
  /** The suspect is "près de" a place when this close (metres) to its building. */
  nearWithin: 45,
  /** No sighting in the first metres of a stage... */
  minFromStart: 150,
  /** ...nor with less than this share of the stage left. */
  minRemainingShare: 0.2,
  /** Sightings in the same stage are at least this far apart (metres along the route). */
  spacing: 350,
  /** Seconds added to the clock for the right answer, and taken off for a wrong one (or none). */
  bonusSeconds: 4,
  penaltySeconds: 6,
  /** After the right answer the suspect shows on the map for this long (seconds). */
  revealSeconds: 6,
} as const;

/** Lost-signal tuning (provisional). */
export const LOST_SIGNAL = {
  /** Not in the first seconds of the chase. From then on the scanner prefers calls with several turns. */
  minElapsed: 6,
  /** The call just before must give at least this many turns to remember. */
  minSteps: 2,
  /** The signal comes back once the player has used the directions they were given, or after this long (seconds). */
  maxSeconds: 20,
} as const;

/** Direction-change tuning, shared by all levels (provisional). */
/**
 * When directions are spoken. On foot each call waits until the runner is
 * about `footLeadSeconds` from the junction it is about, so it comes close to
 * the turn instead of a whole street early (longer at the levels with longer
 * sentences). Calls still come only just after a node, never mid-street. The car is fast, so its calls come as soon as possible. If a
 * call still comes late (two junctions close together, or a long sentence),
 * the whole chase slows a little, police and suspect alike and the clock too,
 * so the player can hear it out and react before the junction without losing
 * ground. The same at every level: difficulty never comes from rushed timing.
 */
export const CALL_TIMING = {
  footLeadSeconds: { EASY: 6, INTERMEDIATE: 6.5, HARD: 8, EXPERT: 9.5 } as Record<Difficulty, number>,
  /** A foot call that would come later than this before its junction comes a node earlier instead. */
  footMinLeadSeconds: 4,
  /** Time to react after the call ends, before the junction. */
  reactSeconds: 1,
  /** The chase never runs slower than this share of its usual pace. */
  minPace: 0.4,
  /** Speech length estimate for a call (slow, clear French). */
  speechBaseSeconds: 0.6,
  speechCharsPerSecond: 13,
};

export const TURN_OFF = {
  /** The suspect turns off at least this far (metres) beyond where it starts the stage. */
  minFromStart: 120,
  /** ...and with at least this share of the stage still to go, so there is a chase left to run. */
  minRemainingShare: 0.3,
  /**
   * In a one-stage chase, the turn-off comes before the suspect has covered this
   * share of the road it would cover before a player who follows every
   * direction catches it, so the change of direction happens during the chase.
   */
  beforeCatchShare: 0.6,
  /** After a change of transport the police are close behind, so the turn-off comes within this share of the stage... */
  laterStageShare: 0.35,
  /** ...or, either way, within this many metres of the earliest point. */
  minWindow: 170,
  /** Routes to try for a chase that should change direction before giving up on the change. */
  routeTries: 3,
  /** Length of the route the scanner wrongly predicted, from the turn-off point (metres). */
  decoyLength: [250, 700] as [number, number],
  /**
   * The correction is given only when the player is at least this many seconds
   * from the next junction (or stopped), so there is time to take it in.
   */
  clearSeconds: 2,
  /** The scanner sees the suspect turning off when it is this close to the junction (metres, by mode). */
  seenWithin: { CAR: 60, FOOT: 20 } as Record<TravelMode, number>,
} as const;

export const CHASE_SETTINGS: Record<Difficulty, ChaseSettings> = {
  EASY: {
    routeLength: [2400, 3300],
    footRouteLength: [650, 950],
    stageLength: { CAR: [1000, 1500], FOOT: [600, 850] },
    headStart: { CAR: 350, FOOT: 115 },
    suspectSpeed: { CAR: 0.74, FOOT: 0.70 },
    sightingDistance: 45,
    captureDistance: 28,
    captureHold: 0.6,
    warningDistance: 600,
    escapeDistance: 850,
    escapeHold: 4,
    directionChange: 0,
    sightings: { count: 0, cards: 2, pickSeconds: 12 },
    lostSignal: 0,
  },
  INTERMEDIATE: {
    routeLength: [2800, 3800],
    footRouteLength: [800, 1100],
    stageLength: { CAR: [1000, 1600], FOOT: [750, 1000] },
    headStart: { CAR: 400, FOOT: 130 },
    suspectSpeed: { CAR: 0.80, FOOT: 0.72 },
    sightingDistance: 40,
    captureDistance: 28,
    captureHold: 0.7,
    warningDistance: 550,
    escapeDistance: 800,
    escapeHold: 3.5,
    directionChange: 0.3,
    sightings: { count: 0, cards: 3, pickSeconds: 10 },
    lostSignal: 0,
  },
  HARD: {
    routeLength: [3300, 4400],
    footRouteLength: [900, 1250],
    stageLength: { CAR: [1500, 2100], FOOT: [850, 1100] },
    headStart: { CAR: 440, FOOT: 145 },
    suspectSpeed: { CAR: 0.82, FOOT: 0.74 },
    sightingDistance: 35,
    captureDistance: 26,
    captureHold: 0.8,
    warningDistance: 500,
    escapeDistance: 750,
    escapeHold: 3,
    directionChange: 0.5,
    sightings: { count: 0, cards: 3, pickSeconds: 9 },
    lostSignal: 0,
  },
  EXPERT: {
    routeLength: [3900, 5000],
    footRouteLength: [1000, 1350],
    stageLength: { CAR: [1800, 2400], FOOT: [950, 1250] },
    headStart: { CAR: 480, FOOT: 160 },
    suspectSpeed: { CAR: 0.84, FOOT: 0.76 },
    sightingDistance: 30,
    captureDistance: 25,
    captureHold: 0.9,
    warningDistance: 480,
    escapeDistance: 700,
    escapeHold: 2.5,
    directionChange: 0.7,
    sightings: { count: 0, cards: 3, pickSeconds: 9 },
    lostSignal: 0.9,
  },
};
