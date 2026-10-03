import { describe, expect, it } from 'vitest';
import { MISSIONS, newCampaign, recordMission, type CampaignProgress } from '../../src/engine/campaign/campaign';
import {
  BADGE_COUNTS,
  BADGES,
  BOSS,
  BOSSES,
  bossUnlocked,
  RANK_PACE,
  suspectPaceFor,
  newProfile,
  nextRank,
  parseProfile,
  RANKS,
  rankFor,
  recordChase,
  SUSPECT_FILES,
  type ChaseOutcome,
} from '../../src/engine/campaign/profile';
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

const outcome = (over: Partial<ChaseOutcome> = {}, s: Partial<MissionStats> = {}): ChaseOutcome => {
  const st = stats(s);
  return {
    stats: st,
    score: scoreMission(st),
    timeLimit: 180,
    night: false,
    mode: 'CAR',
    suspect: 'renard',
    lastSeen: 'THEATRE',
    vehicle: 'GREEN',
    chaseType: 'CAR_CAR',
    campaign: newCampaign(),
    date: '2026-10-03',
    ...over,
  };
};

/** A campaign with gold on every mission. */
function allGold(): CampaignProgress {
  let p = newCampaign();
  for (let i = 0; i < MISSIONS.length; i++) p = recordMission(p, i, scoreMission(stats({ difficulty: MISSIONS[i]!.difficulty })));
  return p;
}

describe('ranks', () => {
  it('rise with points, in order, from Stagiaire to Commissaire', () => {
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i]!.points).toBeGreaterThan(RANKS[i - 1]!.points);
    expect(rankFor(0).id).toBe('STAGIAIRE');
    expect(rankFor(999).id).toBe('STAGIAIRE');
    expect(rankFor(1000).id).toBe('AGENT');
    expect(rankFor(1_000_000).id).toBe('COMMISSAIRE');
    expect(nextRank(rankFor(0))?.id).toBe('AGENT');
    expect(nextRank(rankFor(1_000_000))).toBeNull();
  });
});

describe('the record of every chase', () => {
  it('adds the points, counts arrests and tells when the rank goes up', () => {
    const first = recordChase(newProfile(), outcome());
    expect(first.profile.points).toBe(740);
    expect(first.profile.arrests).toBe(1);
    expect(first.rankBefore.id).toBe('STAGIAIRE');
    let p = first.profile;
    while (p.points < 1000) p = recordChase(p, outcome()).profile;
    expect(rankFor(p.points).id).toBe('AGENT');
  });

  it('awards badges once each: first arrest, no wrong turn, quick, Expert without repeats, on foot', () => {
    const a = recordChase(newProfile(), outcome({ mode: 'FOOT' }, { timeLeft: 100 }));
    expect(a.newBadges.map((b) => b.id).sort()).toEqual(['ECLAIR', 'PIED_LEGER', 'PREMIERE', 'SANS_FAUTE']);
    const b = recordChase(a.profile, outcome({ mode: 'FOOT' }, { timeLeft: 100 }));
    expect(b.newBadges).toEqual([]);
    const c = recordChase(b.profile, outcome({ timeLimit: 90 }, { difficulty: 'EXPERT', timeLeft: 10, wrongTurns: 1 }));
    expect(c.newBadges.map((x) => x.id)).toEqual(['OREILLE_D_OR']);
    const escaped = recordChase(newProfile(), outcome({}, { captured: false }));
    expect(escaped.newBadges).toEqual([]);
    expect(escaped.profile.arrests).toBe(0);
  });

  it('counts night arrests and arrests in all for Noctambule and Marathonien', () => {
    let p = newProfile();
    let earned: string[] = [];
    for (let i = 0; i < BADGE_COUNTS.MARATHONIEN; i++) {
      const r = recordChase(p, outcome({ night: i < BADGE_COUNTS.NOCTAMBULE }));
      p = r.profile;
      earned = [...earned, ...r.newBadges.map((b) => b.id)];
    }
    expect(p.nightArrests).toBe(BADGE_COUNTS.NOCTAMBULE);
    expect(earned).toContain('NOCTAMBULE');
    expect(earned.filter((b) => b === 'MARATHONIEN')).toEqual(['MARATHONIEN']);
  });

  it('keeps a case file per suspect: arrests, escapes, quickest arrest, where and in what', () => {
    let p = recordChase(newProfile(), outcome()).profile;
    p = recordChase(p, outcome({ lastSeen: 'BANK', vehicle: 'TAXI' }, { captured: false })).profile;
    p = recordChase(p, outcome({ lastSeen: 'PARK' }, { timeLeft: 150 })).profile;
    const file = p.files['renard']!;
    expect(file.arrests).toBe(2);
    expect(file.escapes).toBe(1);
    expect(file.quickest).toBe(30);
    expect(file.lastSeen).toBe('PARK');
    expect(file.firstArrest).toBe('2026-10-03');
    expect(file.medal).toBe('GOLD');
    expect(p.files['pie']).toBeUndefined();
    // Practice chases count for points but have no suspect to file.
    const practice = recordChase(p, outcome({ suspect: null }));
    expect(Object.keys(practice.profile.files)).toEqual(['renard']);
    expect(practice.profile.points).toBeGreaterThan(p.points);
  });

  it('opens the Boss once every mission has gold, then the Patronne once the Boss is arrested, each with a badge', () => {
    expect(bossUnlocked(newCampaign(), newProfile())).toBe(false);
    const gold = allGold();
    expect(bossUnlocked(gold, newProfile())).toBe(true);
    expect(bossUnlocked(gold, newProfile(), 'patronne')).toBe(false);
    expect(bossUnlocked(gold, newProfile(), 'nobody')).toBe(false);
    const ultimate = recordChase(newProfile(), outcome({ campaign: gold }));
    expect(ultimate.newBadges.map((b) => b.id)).toContain('CHASSEUR_ULTIME');
    const boss = recordChase(ultimate.profile, outcome({ suspect: BOSS.picture, chaseType: BOSS.chaseType }, { difficulty: 'EXPERT' }));
    expect(boss.newBadges.map((b) => b.id)).toContain('BOSS');
    expect(boss.profile.files['boss']).toMatchObject({ arrests: 1, medal: 'GOLD' });
    expect(bossUnlocked(gold, boss.profile, 'patronne')).toBe(true);
    const patronne = recordChase(boss.profile, outcome({ suspect: 'patronne', chaseType: BOSSES[1]!.chaseType }, { difficulty: 'EXPERT' }));
    expect(patronne.newBadges.map((b) => b.id)).toContain('PATRONNE');
    expect(SUSPECT_FILES.map((s) => s.picture)).toEqual([...MISSIONS.map((m) => m.picture), 'boss', 'patronne']);
  });

  it('makes suspects a little faster at each rank, never more than the top rank allows', () => {
    expect(suspectPaceFor(0)).toBe(1);
    expect(suspectPaceFor(1000)).toBeCloseTo(1 + RANK_PACE);
    expect(suspectPaceFor(1_000_000)).toBeCloseTo(1 + RANK_PACE * (RANKS.length - 1));
    expect(suspectPaceFor(1_000_000)).toBeLessThan(1.15);
  });

  it('reads a saved record back, and starts afresh from damaged data', () => {
    const p = recordChase(newProfile(), outcome({ night: true })).profile;
    expect(parseProfile(JSON.stringify(p))).toEqual(p);
    expect(parseProfile(null)).toEqual(newProfile());
    expect(parseProfile('nonsense')).toEqual(newProfile());
    expect(parseProfile(JSON.stringify({ version: 1, points: -5, badges: { PREMIERE: 3, NOPE: 'x' }, files: { renard: 'bad' } }))).toEqual(newProfile());
    expect(BADGES.map((b) => b.id)).toHaveLength(10);
  });
});
