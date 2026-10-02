import { describe, expect, it } from 'vitest';
import {
  isComplete,
  isLiveryUnlocked,
  isUnlocked,
  MISSION_COUNT,
  MISSIONS,
  newCampaign,
  newlyUnlocked,
  parseProgress,
  recordMission,
  totalScore,
} from '../../src/engine/campaign/campaign';
import { scoreMission, type MissionStats } from '../../src/engine/campaign/scoring';

const stats = (over: Partial<MissionStats> = {}): MissionStats => ({
  difficulty: 'EASY',
  captured: true,
  timeLeft: 60,
  directions: 10,
  wrongTurns: 0,
  repeatsUsed: 0,
  sightingsAsked: 0,
  sightingsRight: 0,
  transportChanges: 0,
  ...over,
});

describe('campaign missions', () => {
  it('has eight suspects, two per level, in order of difficulty', () => {
    expect(MISSIONS.map((m) => m.difficulty)).toEqual([
      'EASY', 'EASY', 'INTERMEDIATE', 'INTERMEDIATE', 'HARD', 'HARD', 'EXPERT', 'EXPERT',
    ]);
    expect(new Set(MISSIONS.map((m) => m.nickname)).size).toBe(8);
  });
});

describe('scoring', () => {
  it('rewards the capture, the time left and reactions, and takes off wrong turns', () => {
    const clean = scoreMission(stats({ sightingsRight: 1, transportChanges: 1 }));
    expect(clean.total).toBe(500 + 60 * 4 + 100 + 100);
    expect(clean.medal).toBe('GOLD');
    expect(clean.accuracy).toBe(1);
    const sloppy = scoreMission(stats({ wrongTurns: 2 }));
    expect(sloppy.total).toBe(500 + 240 - 80);
    expect(sloppy.medal).toBe('SILVER');
    expect(sloppy.accuracy).toBeCloseTo(0.8);
    expect(scoreMission(stats({ wrongTurns: 5 })).medal).toBe('BRONZE');
  });

  it('harder levels are worth more; Easy repeats are free, others cost', () => {
    expect(scoreMission(stats({ difficulty: 'EXPERT', timeLeft: 0 })).total).toBe(1500);
    expect(scoreMission(stats({ repeatsUsed: 5 })).medal).toBe('GOLD');
    const hard = scoreMission(stats({ difficulty: 'HARD', timeLeft: 0, repeatsUsed: 2 }));
    expect(hard.total).toBe(1000 - 40);
    expect(hard.medal).toBe('SILVER');
  });

  it('an escape earns no medal and never a negative score', () => {
    const escaped = scoreMission(stats({ captured: false, wrongTurns: 6 }));
    expect(escaped.medal).toBeNull();
    expect(escaped.total).toBe(0);
  });
});

describe('progress', () => {
  it('moves on after any result (no lives) and keeps the best score and medal', () => {
    let p = newCampaign();
    expect(isUnlocked(p, 0)).toBe(true);
    expect(isUnlocked(p, 1)).toBe(false);
    p = recordMission(p, 0, scoreMission(stats({ captured: false })));
    expect(p.current).toBe(1);
    expect(p.missions[0]?.captured).toBe(false);
    p = recordMission(p, 0, scoreMission(stats()));
    p = recordMission(p, 0, scoreMission(stats({ wrongTurns: 4 })));
    expect(p.missions[0]).toMatchObject({ captured: true, medal: 'GOLD', attempts: 3, bestScore: 740 });
    expect(p.current).toBe(1);
    for (let i = 1; i < MISSION_COUNT; i++) p = recordMission(p, i, scoreMission(stats({ difficulty: MISSIONS[i]!.difficulty })));
    expect(isComplete(p)).toBe(true);
    expect(p.current).toBe(MISSION_COUNT);
    expect(totalScore(p)).toBeGreaterThan(0);
  });

  it('unlocks car colours by arrests and medals, and keeps them for a new campaign', () => {
    let p = newCampaign();
    expect(isLiveryUnlocked(p, 'NUIT')).toBe(false);
    const before = recordMission(p, 0, scoreMission(stats()));
    p = recordMission(before, 1, scoreMission(stats()));
    expect(newlyUnlocked(before, p).map((l) => l.id)).toEqual(['NUIT']);
    for (let i = 2; i < MISSION_COUNT; i++) p = recordMission(p, i, scoreMission(stats({ difficulty: MISSIONS[i]!.difficulty })));
    expect(isLiveryUnlocked(p, 'OR')).toBe(true);
    const again = newCampaign({ ...p, livery: 'OR' });
    expect(again.missions.every((m) => m === null)).toBe(true);
    expect(again.livery).toBe('OR');
    expect(isLiveryUnlocked(again, 'OR')).toBe(true);
  });

  it('reads saved progress back, and starts afresh from damaged data', () => {
    const p = recordMission(newCampaign(), 0, scoreMission(stats()));
    expect(parseProgress(JSON.stringify(p))).toEqual(p);
    expect(parseProgress('not json')).toEqual(newCampaign());
    expect(parseProgress(JSON.stringify({ version: 2 }))).toEqual(newCampaign());
    expect(parseProgress(JSON.stringify({ ...p, livery: 'OR' })).livery).toBe('CLASSIQUE');
  });
});
