/**
 * The approved vocabulary locations (blueprint section 5). No location may
 * appear in an instruction unless it is in this list AND physically on the map.
 */

import type { District } from '../world/types';

export type Article = 'le' | 'la' | "l'";

export interface LocationWord {
  id: string;
  article: Article;
  /** Noun without its article, e.g. "banque", "hôpital", "commissariat de police". */
  noun: string;
  gender: 'm' | 'f';
  en: string;
  district: District;
}

const loc = (
  id: string,
  article: Article,
  noun: string,
  gender: 'm' | 'f',
  en: string,
  district: District,
): LocationWord => ({ id, article, noun, gender, en, district });

export const LOCATION_WORDS: readonly LocationWord[] = [
  // Town Centre
  loc('TOWN_HALL', 'la', 'mairie', 'f', 'town hall', 'TOWN_CENTRE'),
  loc('SQUARE', 'la', 'place', 'f', 'town square', 'TOWN_CENTRE'),
  loc('BANK', 'la', 'banque', 'f', 'bank', 'TOWN_CENTRE'),
  loc('POST_OFFICE', 'la', 'poste', 'f', 'post office', 'TOWN_CENTRE'),
  loc('CAFE', 'le', 'café', 'm', 'café', 'TOWN_CENTRE'),
  loc('RESTAURANT', 'le', 'restaurant', 'm', 'restaurant', 'TOWN_CENTRE'),
  // Commercial District
  loc('SHOP', 'le', 'magasin', 'm', 'shop', 'COMMERCIAL'),
  loc('SHOPPING_CENTRE', 'le', 'centre commercial', 'm', 'shopping centre', 'COMMERCIAL'),
  loc('MARKET', 'le', 'marché', 'm', 'market', 'COMMERCIAL'),
  loc('BAKERY', 'la', 'boulangerie', 'f', 'bakery', 'COMMERCIAL'),
  loc('BOOKSHOP', 'la', 'librairie', 'f', 'bookshop', 'COMMERCIAL'),
  loc('PHARMACY', 'la', 'pharmacie', 'f', 'pharmacy', 'COMMERCIAL'),
  loc('SUPERMARKET', 'le', 'supermarché', 'm', 'supermarket', 'COMMERCIAL'),
  // Civic / Education
  loc('SCHOOL', "l'", 'école', 'f', 'school', 'CIVIC'),
  loc('LIBRARY', 'la', 'bibliothèque', 'f', 'library', 'CIVIC'),
  loc('MUSEUM', 'le', 'musée', 'm', 'museum', 'CIVIC'),
  loc('THEATRE', 'le', 'théâtre', 'm', 'theatre', 'CIVIC'),
  loc('HOSPITAL', "l'", 'hôpital', 'm', 'hospital', 'CIVIC'),
  loc('POLICE_STATION', 'le', 'commissariat de police', 'm', 'police station', 'CIVIC'),
  // Transport
  loc('TRAIN_STATION', 'la', 'gare', 'f', 'train station', 'TRANSPORT'),
  loc('BUS_STATION', 'la', 'gare routière', 'f', 'bus station', 'TRANSPORT'),
  loc('GAS_STATION', 'la', 'station-service', 'f', 'gas station', 'TRANSPORT'),
  loc('CAR_PARK', 'le', 'parking', 'm', 'car park', 'TRANSPORT'),
  loc('BUS_STOP', "l'", 'arrêt de bus', 'm', 'bus stop', 'TRANSPORT'),
  // Recreation / Coastal
  loc('PARK', 'le', 'parc', 'm', 'park', 'COASTAL'),
  loc('STADIUM', 'le', 'stade', 'm', 'stadium', 'COASTAL'),
  loc('SWIMMING_POOL', 'la', 'piscine', 'f', 'swimming pool', 'COASTAL'),
  loc('CINEMA', 'le', 'cinéma', 'm', 'cinema', 'COASTAL'),
  loc('BEACH', 'la', 'plage', 'f', 'beach', 'COASTAL'),
  // Additional
  loc('HOTEL', "l'", 'hôtel', 'm', 'hotel', 'COASTAL'),
];

export const LOCATION_WORD_BY_ID: ReadonlyMap<string, LocationWord> = new Map(
  LOCATION_WORDS.map((word) => [word.id, word]),
);

/** "la banque", "le café", "l'école". */
export function withArticle(word: LocationWord): string {
  return word.article === "l'" ? `l'${word.noun}` : `${word.article} ${word.noun}`;
}

/** "à la banque", "au café", "à l'école". */
export function withA(word: LocationWord): string {
  return word.article === 'le' ? `au ${word.noun}` : `à ${withArticle(word)}`;
}

/** "de la banque", "du café", "de l'école". */
export function withDe(word: LocationWord): string {
  return word.article === 'le' ? `du ${word.noun}` : `de ${withArticle(word)}`;
}

/**
 * Joins a preposition to a location with the correct French contraction:
 *   "jusqu'à" + le café → "jusqu'au café"
 *   "près de" + le parc → "près du parc"
 *   "devant"  + la banque → "devant la banque"
 */
export function withPreposition(preposition: string, word: LocationWord): string {
  if (preposition === 'à') return withA(word);
  if (preposition === 'de') return withDe(word);
  if (preposition.endsWith(" à") || preposition.endsWith("'à")) {
    return `${preposition.slice(0, -1)}${withA(word)}`;
  }
  if (preposition.endsWith(' de')) return `${preposition.slice(0, -2)}${withDe(word)}`;
  return `${preposition} ${withArticle(word)}`;
}
