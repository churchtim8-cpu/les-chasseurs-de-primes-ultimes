import { describe, expect, it } from 'vitest';
import {
  addEntry,
  boardFor,
  dailyChase,
  dayNumber,
  hasPlayed,
  newBoard,
  parseBoard,
  readScoreCode,
  scoreCode,
} from '../../src/engine/campaign/daily';
import { parseSeed } from '../../src/engine';

describe('le défi du jour', () => {
  it('counts days on the calendar', () => {
    expect(dayNumber('2000-01-01')).toBe(0);
    expect(dayNumber('2000-03-01')).toBe(60);
    expect(dayNumber('2026-10-05') - dayNumber('2026-10-04')).toBe(1);
    expect(dayNumber('2027-01-01') - dayNumber('2026-12-31')).toBe(1);
  });

  it('gives everybody the same valid chase on the same day, and a new one the next day', () => {
    const a = dailyChase('2026-10-04');
    expect(dailyChase('2026-10-04')).toEqual(a);
    expect(parseSeed(a.seed.code)).toEqual({ ok: true, seed: a.seed });
    expect(dailyChase('2026-10-05').seed.code).not.toBe(a.seed.code);
  });

  it('follows the week: easy Monday, expert Friday', () => {
    expect(dailyChase('2026-10-05').difficulty).toBe('EASY'); // a Monday
    expect(dailyChase('2026-10-09').difficulty).toBe('EXPERT'); // a Friday
    expect(dailyChase('2026-10-04').difficulty).toBe('HARD'); // a Sunday
  });

  it('makes score codes that only work for that student, class and day', () => {
    const code = scoreCode('2026-10-04', 'Ti Jean', '4b', { score: 1234, stars: 3 });
    expect(code).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/);
    expect(readScoreCode(code, '2026-10-04', ' ti  jean ', '4B')).toEqual({ score: 1234, stars: 3 });
    expect(readScoreCode(code, '2026-10-04', 'Marie', '4B')).toBeNull();
    expect(readScoreCode(code, '2026-10-05', 'Ti Jean', '4B')).toBeNull();
    expect(readScoreCode(code, '2026-10-04', 'Ti Jean', '5A')).toBeNull();
    // Any one character changed is caught almost always.
    let caught = 0;
    for (const c of '0123456789ABCDEF') {
      const typo = c + code.slice(1);
      if (typo !== code && readScoreCode(typo, '2026-10-04', 'Ti Jean', '4B') === null) caught++;
    }
    expect(caught).toBeGreaterThanOrEqual(14);
  });

  it('keeps one entry per student, ranks the class and remembers the day was played', () => {
    let board = newBoard();
    const day = '2026-10-04';
    board = addEntry(board, { date: day, nickname: 'ana', classCode: '4b', score: 900, stars: 2, local: true });
    board = addEntry(board, { date: day, nickname: 'Ben', classCode: '4B', score: 1200, stars: 3, local: false });
    board = addEntry(board, { date: day, nickname: 'Ana', classCode: '4B', score: 1000, stars: 2, local: false });
    board = addEntry(board, { date: day, nickname: 'Cleo', classCode: '5A', score: 2000, stars: 3, local: false });
    expect(boardFor(board, day, '4b').map((e) => [e.nickname, e.score])).toEqual([
      ['BEN', 1200],
      ['ANA', 1000],
    ]);
    expect(hasPlayed(board, day)).toBe(true);
    expect(hasPlayed(board, '2026-10-05')).toBe(false);
    // Old days are dropped.
    board = addEntry(board, { date: '2026-10-30', nickname: 'Ben', classCode: '4B', score: 10, stars: 1, local: true });
    expect(boardFor(board, day, '4B')).toEqual([]);
    expect(parseBoard(JSON.stringify(board))).toEqual(board);
    expect(parseBoard('not json')).toEqual(newBoard());
  });
});

describe('Bellevue en fête', () => {
  it('knows when Carnival and Christmas are', async () => {
    const { easter, festivalOn } = await import('../../src/engine/world/festival');
    expect(easter(2026)).toEqual([4, 5]);
    expect(easter(2027)).toEqual([3, 28]);
    expect(festivalOn('2026-02-17')).toBe('CARNIVAL'); // Carnival Tuesday 2026
    expect(festivalOn('2026-02-01')).toBe('CARNIVAL');
    expect(festivalOn('2026-02-18')).toBeNull(); // Ash Wednesday
    expect(festivalOn('2026-12-01')).toBe('CHRISTMAS');
    expect(festivalOn('2027-01-06')).toBe('CHRISTMAS');
    expect(festivalOn('2027-01-07')).toBeNull();
    expect(festivalOn('2026-10-04')).toBeNull();
  });
});
