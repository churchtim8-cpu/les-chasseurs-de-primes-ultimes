import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { ESCAPE_LINES } from '../../src/engine/audio/script';
import { Escape } from '../../src/engine/chase/escape';
import { generateScenario, type ScenarioOptions } from '../../src/engine/chase/scenario';
import { CHASE_TYPES, type ChaseType } from '../../src/engine/chase/settings';
import { DIFFICULTIES, type Difficulty } from '../../src/engine/difficulty';
import { exitsAt, type TurnIntent } from '../../src/engine/movement/turns';
import { Rng } from '../../src/engine/rng/prng';
import { createSeed } from '../../src/engine/rng/seedCode';
import { TownGraph } from '../../src/engine/world/graph';
import { ListenerBot } from './listenerBot';
import { OFFICERS } from '../../src/engine/campaign/officers';

/**
 * Escape Mode: the player is the suspect, guided to the hideout by the
 * partner's French while the police follow. Listening must get away;
 * turning at random must not.
 */
const graph = new TownGraph(BELLEVUE);
const PLAIN: ScenarioOptions = { sightings: false, nearCapture: null, turnOff: false, lostSignal: false };

function seeds(difficulty: Difficulty, count: number, label = 'escape'): string[] {
  const rng = Rng.fromSeed(`${label}-${difficulty}`);
  return Array.from({ length: count }, () => createSeed(difficulty, (n) => rng.int(0, n - 1)).code);
}

function play(seed: string, bot: 'LISTENER' | 'RANDOM', options: ScenarioOptions = PLAIN, policeSpeed?: number) {
  const escape = new Escape(graph, generateScenario(graph, seed, options), policeSpeed === undefined ? {} : { policeSpeed });
  const listener = new ListenerBot(graph);
  const rng = Rng.fromSeed(`bot-${seed}`);
  let lastEdge = '';
  let recoveries = 0;
  const said: string[] = [];
  // The bot hears the opening call in full before anything moves, as the game plays it.
  for (let t = 0; t < escape.timeLimit + 5 && escape.status.phase === 'PURSUIT'; t += 0.05) {
    let events;
    if (bot === 'LISTENER') events = listener.step(escape, 0.05);
    else {
      const me = escape.player.snapshot();
      if (me.edgeId !== lastEdge || me.waiting) {
        lastEdge = me.edgeId;
        const exits = exitsAt(graph, graph.edge(me.edgeId), me.towards, me.mode);
        if (exits.length > 0) escape.player.queue(rng.pick(exits).kind as TurnIntent);
        else escape.player.uTurn();
      }
      events = escape.update(0.05);
    }
    for (const e of events) {
      if (e.type === 'TRANSMISSION' && e.transmission.kind === 'RECOVERY') recoveries++;
      if (e.type === 'ANNOUNCE') said.push(...e.lines.map((l) => l.audioId));
    }
  }
  return { status: escape.status, recoveries, said, failedOrders: listener.failedOrders, log: listener.log };
}

describe('Escape Mode', () => {
  it('recreates the same escape from the same seed, with a clock long enough to travel the route', () => {
    const seed = seeds('HARD', 1)[0]!;
    const a = new Escape(graph, generateScenario(graph, seed, PLAIN));
    const b = new Escape(graph, generateScenario(graph, seed, PLAIN));
    expect(a.player.location()).toEqual(b.player.location());
    expect(a.police.location()).toEqual(b.police.location());
    expect(a.timeLimit).toBe(b.timeLimit);
    expect(a.timeLimit).toBeGreaterThanOrEqual(a.routeLeft / 85);
    expect(a.describable).toBe(true);
    const opening = a.openingCall();
    expect(opening[0]).toEqual({ type: 'ANNOUNCE', lines: [ESCAPE_LINES.OPENING] });
    expect(opening.some((e) => e.type === 'TRANSMISSION')).toBe(true);
  });

  it.each(DIFFICULTIES)('a player who follows the partner reaches the hideout, never corrected (%s)', (difficulty) => {
    const results = seeds(difficulty, 50).map((s) => play(s, 'LISTENER'));
    const away = results.filter((r) => r.status.phase === 'ESCAPED' && r.status.escapeReason === 'HIDEOUT').length;
    const corrected = results.filter((r) => r.recoveries > 0).length;
    expect(results.flatMap((r) => r.failedOrders)).toEqual([]);
    expect(corrected).toBe(0);
    expect(away / results.length).toBeGreaterThanOrEqual(0.95);
  }, 180_000);

  it.each(CHASE_TYPES)('changes of transport work the other way round too (%s)', (chaseType: ChaseType) => {
    const results = seeds('EXPERT', 12, chaseType).map((s) => play(s, 'LISTENER', { ...PLAIN, chaseType }));
    expect(results.flatMap((r) => r.failedOrders)).toEqual([]);
    const away = results.filter((r) => r.status.phase === 'ESCAPED').length;
    expect(away / results.length).toBeGreaterThanOrEqual(0.9);
  }, 180_000);

  // Luck (the hideout reached by chance before the roadblocks go up) stays rare; Expert routes
  // loop the most, so a driver who happens to head straight for the hideout gets there more often.
  const LUCK_LIMIT: Record<Difficulty, number> = { EASY: 0.2, INTERMEDIATE: 0.15, HARD: 0.15, EXPERT: 0.2 };

  it.each(DIFFICULTIES)('a player who turns at random is caught (%s)', (difficulty) => {
    const results = seeds(difficulty, 60, 'luck').map((s) => play(s, 'RANDOM', { ...PLAIN, chaseType: 'CAR_CAR' }));
    const away = results.filter((r) => r.status.phase === 'ESCAPED').length;
    expect(away / results.length).toBeLessThanOrEqual(LUCK_LIMIT[difficulty]);
  }, 180_000);

  it('the partner warns when the police are close, and reports losing them', () => {
    const results = seeds('EASY', 30, 'lines').map((s) => play(s, 'RANDOM', { ...PLAIN, chaseType: 'CAR_CAR' }));
    const close = results.filter((r) => r.said.includes(ESCAPE_LINES.POLICE_CLOSE.audioId)).length;
    expect(close).toBeGreaterThan(results.length / 2);
    const listened = seeds('EASY', 30, 'lines').map((s) => play(s, 'LISTENER'));
    const lost = listened.filter((r) => r.said.includes(ESCAPE_LINES.POLICE_LOST.audioId)).length;
    expect(lost).toBeGreaterThan(0);
  }, 180_000);
  it.each(DIFFICULTIES)('the partner never goes quiet on a player who is lost, stopped or has not changed transport (%s)', (difficulty) => {
    // A player who mostly listens but now and then turns the wrong way (Mr Henry, 2026-10-04: "no one giving any orders at all").
    for (const seed of seeds(difficulty, 12, 'quiet')) {
      const escape = new Escape(graph, generateScenario(graph, seed, PLAIN));
      const listener = new ListenerBot(graph);
      const rng = Rng.fromSeed(`sloppy-${seed}`);
      let lastEdge = '';
      let heard = 0;
      let worst = 0;
      for (let t = 0; t < escape.timeLimit && escape.status.phase === 'PURSUIT'; t += 0.05) {
        const me = escape.player.snapshot();
        let events;
        if (me.edgeId !== lastEdge && rng.next() < 0.2 && escape.status.switchTo === null && !escape.status.followingTracks) {
          const exits = exitsAt(graph, graph.edge(me.edgeId), me.towards, me.mode);
          if (exits.length > 0) escape.player.queue(rng.pick(exits).kind as TurnIntent);
          events = escape.update(0.05);
        } else events = listener.step(escape, 0.05);
        lastEdge = me.edgeId;
        if (events.some((e) => e.type === 'TRANSMISSION' || e.type === 'ANNOUNCE')) heard = t;
        const stuck = escape.player.snapshot().waiting === 'JUNCTION' || escape.status.switchTo !== null;
        if (stuck) worst = Math.max(worst, t - heard);
      }
      expect(worst, seed).toBeLessThan(16);
    }
  }, 180_000);

  // The escape campaign's officers (Mr Henry, 2026-10-04): slower at the easy levels, faster up to the
  // hidden motorcycle squad; listening still always gets away, turning at random does not.
  it.each(OFFICERS.map((o) => [o.nickname, o] as const))('a listener gets away from %s; a random driver mostly does not', (_name, officer) => {
    const options = { ...PLAIN, ...(officer.chaseType ? { chaseType: officer.chaseType } : {}) };
    const listened = seeds(officer.difficulty, 24, `officer-${officer.id}`).map((s) => play(s, 'LISTENER', options, officer.speed));
    expect(listened.flatMap((r) => r.failedOrders)).toEqual([]);
    const away = listened.filter((r) => r.status.phase === 'ESCAPED').length;
    expect(away / listened.length).toBeGreaterThanOrEqual(officer.hidden ? 0.9 : 0.95);
    const random = seeds(officer.difficulty, 30, `officer-luck-${officer.id}`).map((s) => play(s, 'RANDOM', { ...options, chaseType: officer.chaseType ?? 'CAR_CAR' }, officer.speed));
    expect(random.filter((r) => r.status.phase === 'ESCAPED').length / random.length).toBeLessThanOrEqual(0.25);
  }, 180_000);
});
