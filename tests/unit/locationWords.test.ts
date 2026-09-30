import { describe, expect, it } from 'vitest';
import { LOCATION_WORD_BY_ID, withA, withArticle, withDe, withPreposition } from '../../src/engine/language/locations';

const word = (id: string) => LOCATION_WORD_BY_ID.get(id)!;

describe('location French forms', () => {
  it('uses the right article', () => {
    expect(withArticle(word('BANK'))).toBe('la banque');
    expect(withArticle(word('CAFE'))).toBe('le café');
    expect(withArticle(word('SCHOOL'))).toBe("l'école");
    expect(withArticle(word('HOSPITAL'))).toBe("l'hôpital");
  });

  it('contracts à and de', () => {
    expect(withA(word('CAFE'))).toBe('au café');
    expect(withA(word('BANK'))).toBe('à la banque');
    expect(withA(word('HOTEL'))).toBe("à l'hôtel");
    expect(withDe(word('PARK'))).toBe('du parc');
    expect(withDe(word('LIBRARY'))).toBe('de la bibliothèque');
    expect(withDe(word('BUS_STOP'))).toBe("de l'arrêt de bus");
  });

  it('joins prepositions naturally', () => {
    expect(withPreposition("jusqu'à", word('MUSEUM'))).toBe("jusqu'au musée");
    expect(withPreposition("jusqu'à", word('TRAIN_STATION'))).toBe("jusqu'à la gare");
    expect(withPreposition("jusqu'à", word('HOSPITAL'))).toBe("jusqu'à l'hôpital");
    expect(withPreposition('près de', word('STADIUM'))).toBe('près du stade');
    expect(withPreposition('en face de', word('POST_OFFICE'))).toBe('en face de la poste');
    expect(withPreposition('à côté de', word('SCHOOL'))).toBe("à côté de l'école");
    expect(withPreposition('au coin de', word('SHOPPING_CENTRE'))).toBe('au coin du centre commercial');
    expect(withPreposition('devant', word('BANK'))).toBe('devant la banque');
    expect(withPreposition('après', word('CINEMA'))).toBe('après le cinéma');
  });
});
