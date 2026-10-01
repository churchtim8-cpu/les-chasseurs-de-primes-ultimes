/**
 * Suspect-sighting lines from the approved vocabulary (blueprint section 11):
 *
 *   Le suspect est dans une voiture verte.          (which vehicle to look for)
 *   La voiture verte est près de la bibliothèque.   (a sighting)
 *   Le suspect est près de la bibliothèque.         (on foot, or Expert: remember the vehicle)
 *
 * Whole sentences, one recording each: never assembled from words.
 */

import type { Vehicle } from '../chase/settings';
import { LOCATION_WORD_BY_ID, withPreposition } from './locations';

interface VehicleWords {
  /** "une voiture verte", "un taxi". */
  indefinite: string;
  /** "La voiture verte", "Le taxi" (sentence start). */
  definite: string;
  en: string;
}

export const VEHICLE_WORDS: Record<Vehicle, VehicleWords> = {
  BLUE: { indefinite: 'une voiture bleue', definite: 'La voiture bleue', en: 'blue car' },
  BLACK: { indefinite: 'une voiture noire', definite: 'La voiture noire', en: 'black car' },
  WHITE: { indefinite: 'une voiture blanche', definite: 'La voiture blanche', en: 'white car' },
  GREEN: { indefinite: 'une voiture verte', definite: 'La voiture verte', en: 'green car' },
  TAXI: { indefinite: 'un taxi', definite: 'Le taxi', en: 'taxi' },
  VAN: { indefinite: 'une camionnette', definite: 'La camionnette', en: 'van' },
};

export interface SightingText {
  audioId: string;
  text: string;
}

/** "Le suspect est dans une voiture verte." */
export function vehicleLine(vehicle: Vehicle): SightingText {
  return { audioId: `event.vehicle.${vehicle.toLowerCase()}`, text: `Le suspect est dans ${VEHICLE_WORDS[vehicle].indefinite}.` };
}

/** "La voiture verte est près de la bibliothèque.", or "Le suspect est près de …" when no vehicle is named. */
export function sightingLine(vehicle: Vehicle | null, place: string): SightingText {
  const word = LOCATION_WORD_BY_ID.get(place);
  if (!word) throw new Error(`No French word for ${place}`);
  const subject = vehicle ? VEHICLE_WORDS[vehicle].definite : 'Le suspect';
  return {
    audioId: `event.sighting.${vehicle ? vehicle.toLowerCase() : 'suspect'}.${place.toLowerCase()}`,
    text: `${subject} est ${withPreposition('près de', word)}.`,
  };
}
