import { describe, expect, it } from 'vitest';
import { escapedCount, newEscapeProgress, nextOfficer, officerUnlocked, OFFICERS, parseEscapeProgress, recordEscape } from '../../src/engine/campaign/officers';
import { DIFFICULTIES } from '../../src/engine/difficulty';

describe('the escape campaign officers', () => {
  it('has two officers per level, then two hidden motorcycle officers, each faster than the last', () => {
    for (const d of DIFFICULTIES) expect(OFFICERS.filter((o) => !o.hidden && o.difficulty === d)).toHaveLength(2);
    const hidden = OFFICERS.filter((o) => o.hidden);
    expect(hidden.map((o) => o.vehicle)).toEqual(['MOTO', 'MOTO']);
    for (let i = 1; i < OFFICERS.length; i++) expect(OFFICERS[i]!.speed).toBeGreaterThan(OFFICERS[i - 1]!.speed);
    expect(new Set(OFFICERS.map((o) => o.id)).size).toBe(OFFICERS.length);
  });

  it('opens officers one after another, and the hidden pair after escaping all eight', () => {
    let p = newEscapeProgress();
    expect(officerUnlocked(p, 'escargot')).toBe(true);
    expect(officerUnlocked(p, 'agouti')).toBe(false);
    p = recordEscape(p, 'escargot', { escaped: false, score: 100, stars: 0 });
    expect(officerUnlocked(p, 'agouti')).toBe(true);
    expect(nextOfficer(p)?.id).toBe('escargot'); // not escaped yet
    p = recordEscape(p, 'escargot', { escaped: true, score: 900, stars: 2 });
    expect(p.records.escargot).toEqual({ escaped: true, bestScore: 900, stars: 2, attempts: 2 });
    for (const o of OFFICERS.filter((x) => !x.hidden).slice(1, -1)) p = recordEscape(p, o.id, { escaped: true, score: 500, stars: 1 });
    expect(officerUnlocked(p, 'frelon')).toBe(false);
    p = recordEscape(p, 'jaguar', { escaped: true, score: 500, stars: 1 });
    expect(officerUnlocked(p, 'frelon')).toBe(true);
    expect(officerUnlocked(p, 'mangouste')).toBe(true);
    expect(escapedCount(p)).toBe(8);
    expect(nextOfficer(p)?.id).toBe('frelon');
    expect(parseEscapeProgress(JSON.stringify(p))).toEqual(p);
    expect(parseEscapeProgress('nonsense')).toEqual(newEscapeProgress());
  });
});
