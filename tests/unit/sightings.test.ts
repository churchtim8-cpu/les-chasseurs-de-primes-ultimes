import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { Chase, type ChaseEvent } from '../../src/engine/chase/chase';
import { generateScenario, validateScenario, type ScenarioOptions } from '../../src/engine/chase/scenario';
import { cardMatches, nearestPlace } from '../../src/engine/chase/sightings';
import { CHASE_SETTINGS, CHASE_TYPE_MODES, SIGHTING } from '../../src/engine/chase/settings';
import { DIFFICULTIES, type Difficulty } from '../../src/engine/difficulty';
import { sightingLine, vehicleLine } from '../../src/engine/language/sightings';
import { Rng } from '../../src/engine/rng/prng';
import { createSeed } from '../../src/engine/rng/seedCode';
import { TownGraph } from '../../src/engine/world/graph';
import { ListenerBot } from './listenerBot';

const graph = new TownGraph(BELLEVUE);

function seeds(difficulty: Difficulty, count: number, label: string): string[] {
  const rng = Rng.fromSeed(`${label}-${difficulty}`);
  return Array.from({ length: count }, () => createSeed(difficulty, (n) => rng.int(0, n - 1)).code);
}

function listen(seed: string, options: ScenarioOptions = {}) {
  const chase = new Chase(graph, generateScenario(graph, seed, options));
  const bot = new ListenerBot(graph);
  const events: ChaseEvent[] = [];
  const lostTransmissions: string[] = [];
  for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
    const lost = chase.status.signalLost;
    for (const e of bot.step(chase, 0.05)) {
      events.push(e);
      if (lost && chase.status.signalLost && e.type === 'TRANSMISSION') lostTransmissions.push(e.transmission.text);
    }
  }
  return { chase, bot, events, lostTransmissions };
}

describe('suspect sightings', () => {
  it('writes the approved sentences', () => {
    expect(vehicleLine('GREEN').text).toBe('Le suspect est dans une voiture verte.');
    expect(vehicleLine('TAXI').text).toBe('Le suspect est dans un taxi.');
    expect(sightingLine('GREEN', 'LIBRARY').text).toBe('La voiture verte est près de la bibliothèque.');
    expect(sightingLine('TAXI', 'PARK').text).toBe('Le taxi est près du parc.');
    expect(sightingLine(null, 'SCHOOL').text).toBe("Le suspect est près de l'école.");
  });

  it('are off by default since the 2026-10-01 playtest', () => {
    for (const d of DIFFICULTIES) {
      expect(CHASE_SETTINGS[d].sightings.count).toBe(0);
      for (const seed of seeds(d, 10, 'off')) expect(generateScenario(graph, seed).sightings).toEqual([]);
    }
  });

  it.each(DIFFICULTIES)('plans true sightings with exactly one right choice (%s)', (difficulty) => {
    const { cards } = CHASE_SETTINGS[difficulty].sightings;
    let planned = 0;
    const list = seeds(difficulty, 60, 'plan');
    for (const seed of list) {
      const scenario = generateScenario(graph, seed, { sightings: true });
      expect(validateScenario(graph, scenario), seed).toEqual([]);
      planned += scenario.sightings.length;
      for (const s of scenario.sightings) {
        const stage = scenario.stages[s.stage]!;
        const own = scenario.vehicles[s.stage] ?? null;
        expect(nearestPlace(graph, graph.node(stage.route[s.at]!)), seed).toBe(s.place);
        expect(s.cards).toHaveLength(cards);
        expect(s.cards.filter((c) => cardMatches(c, s.place, own))).toEqual([s.cards[s.answer]]);
        if (own && cards >= 3) {
          // Both the vehicle and the place must be understood (or remembered).
          expect(s.cards.some((c) => c.vehicle === own && c.place !== s.place), seed).toBe(true);
          expect(s.cards.some((c) => c.vehicle !== own && c.place === s.place), seed).toBe(true);
        }
        // Expert says "Le suspect est près de …": the vehicle comes from memory.
        if (difficulty === 'EXPERT' || !own) expect(s.named).toBeNull();
        else expect(s.named).toBe(own);
      }
    }
    expect(planned / list.length).toBeGreaterThan(0.8);
  });

  it('gives each driving stage its own car, never the van mid-chase', () => {
    for (const seed of seeds('EXPERT', 40, 'vehicles')) {
      const scenario = generateScenario(graph, seed, { chaseType: 'CAR_FOOT_CAR' });
      const [first, foot, last] = scenario.vehicles;
      expect(first).not.toBeNull();
      expect(foot).toBeNull();
      expect(last).not.toBeNull();
      expect(last).not.toBe(first);
      expect(last).not.toBe('VAN');
    }
  });

  it.each(DIFFICULTIES)('a student who understands the French answers every sighting (%s)', (difficulty) => {
    const runs = seeds(difficulty, 40, 'answer').map((s) => listen(s, { sightings: true }));
    const asked = runs.reduce((n, r) => n + r.chase.status.sightingsAsked, 0);
    // Off by default now; when forced, a careful player often catches the suspect before the sighting point.
    expect(asked).toBeGreaterThan(runs.length * 0.2);
    expect(runs.reduce((n, r) => n + r.chase.status.sightingsRight, 0)).toBe(asked);
    expect(runs.flatMap((r) => r.bot.unsure)).toEqual([]);
    const captured = runs.filter((r) => r.chase.status.phase === 'CAPTURED').length;
    expect(captured / runs.length).toBeGreaterThanOrEqual(0.95);
  }, 60_000);

  it('says which vehicle to look for before the first sighting of a driving stage', () => {
    for (const seed of seeds('HARD', 30, 'told')) {
      const { chase, events } = listen(seed, { sightings: true });
      const firstSighting = events.findIndex((e) => e.type === 'SIGHTING');
      if (firstSighting === -1) continue;
      const s = chase.scenario.sightings[0]!;
      const vehicle = chase.scenario.vehicles[s.stage];
      if (!vehicle) continue;
      const told = events.findIndex((e) => e.type === 'ANNOUNCE' && e.lines.some((l) => l.audioId === vehicleLine(vehicle).audioId));
      expect(told, seed).toBeGreaterThanOrEqual(0);
      expect(told, seed).toBeLessThan(firstSighting);
    }
  });

  it('pauses the chase for the answer, then rewards or costs time', () => {
    const seed = seeds('INTERMEDIATE', 40, 'pause').find((s) => generateScenario(graph, s, { chaseType: 'CAR_CAR', sightings: true }).sightings.length > 0)!;
    const run = (pick: 'RIGHT' | 'WRONG') => {
      const chase = new Chase(graph, generateScenario(graph, seed, { chaseType: 'CAR_CAR', turnOff: false, sightings: true }));
      chase.player.followPlan(chase.scenario.route.slice(1));
      for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
        const question = chase.update(0.05).find((e) => e.type === 'SIGHTING');
        if (!question || question.type !== 'SIGHTING') continue;
        const before = chase.status;
        const where = chase.player.snapshot();
        chase.update(1); // paused: nobody moves and the clock stops
        expect(chase.status.timeLeft).toBe(before.timeLeft);
        expect(chase.player.snapshot().x).toBe(where.x);
        expect(chase.status.sighting?.secondsLeft).toBeCloseTo(question.seconds - 1);
        const right = chase.scenario.sightings[0]!.answer;
        const result = chase.answerSighting(pick === 'RIGHT' ? right : (right + 1) % question.cards.length);
        expect(result).toEqual([expect.objectContaining({ type: 'SIGHTING_RESULT', correct: pick === 'RIGHT' })]);
        return { before: before.timeLeft, after: chase.status.timeLeft, visible: chase.update(0.05) && chase.status.suspectVisible };
      }
      throw new Error(`${seed}: no sighting`);
    };
    const right = run('RIGHT');
    expect(right.after).toBeCloseTo(right.before + SIGHTING.bonusSeconds);
    expect(right.visible).toBe(true);
    const wrong = run('WRONG');
    expect(wrong.after).toBeCloseTo(wrong.before - SIGHTING.penaltySeconds);
  });

  it('counts no answer as a wrong one when the time runs out', () => {
    const seed = seeds('HARD', 40, 'timeout').find((s) => generateScenario(graph, s, { sightings: true }).sightings.length > 0)!;
    const chase = new Chase(graph, generateScenario(graph, seed, { turnOff: false, lostSignal: false, sightings: true }));
    chase.player.followPlan(chase.scenario.route.slice(1));
    let result: ChaseEvent | undefined;
    for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT' && !result; t += 0.05) {
      result = chase.update(0.05).find((e) => e.type === 'SIGHTING_RESULT');
    }
    expect(result).toEqual(expect.objectContaining({ correct: false, chosen: null }));
    expect(chase.status.sightingsAsked).toBe(1);
  });
});

describe('lost signal', () => {
  it('happens at Expert only', () => {
    for (const d of DIFFICULTIES) {
      const lost = seeds(d, 60, 'lost-share').filter((s) => generateScenario(graph, s).lostSignal).length;
      if (d === 'EXPERT') expect(lost).toBeGreaterThan(25);
      else expect(lost).toBe(0);
    }
  });

  it('cuts in after a call with several turns, stays silent, and comes back', () => {
    let cut = 0;
    const list = seeds('EXPERT', 40, 'lost');
    for (const seed of list) {
      const { chase, events, lostTransmissions } = listen(seed, { lostSignal: true });
      const at = events.findIndex((e) => e.type === 'ANNOUNCE' && e.after);
      if (at === -1) continue;
      cut++;
      const call = events[at - 1];
      expect(call?.type, seed).toBe('TRANSMISSION');
      if (call?.type === 'TRANSMISSION') {
        expect(call.transmission.instructions.reduce((n, i) => n + i.atNodes.length, 0)).toBeGreaterThanOrEqual(2);
      }
      expect(lostTransmissions, seed).toEqual([]);
      const back = events.findIndex((e) => e.type === 'SIGNAL' && !e.lost);
      if (chase.status.phase !== 'PURSUIT' || back !== -1) expect(back === -1 || back > at, seed).toBe(true);
    }
    // It needs a call with several turns, which the map does not always allow (junctions far apart).
    expect(cut / list.length).toBeGreaterThan(0.35);
  }, 60_000);

  it('a student who remembers the directions still catches the suspect', () => {
    const runs = seeds('EXPERT', 40, 'lost-catch').map((s) => listen(s, { lostSignal: true }));
    const captured = runs.filter((r) => r.chase.status.phase === 'CAPTURED').length;
    expect(captured / runs.length).toBeGreaterThanOrEqual(0.95);
    expect(runs.filter((r) => r.bot.log.some((t) => t.kind === 'RECOVERY')).map((r) => r.chase.scenario.seed)).toEqual([]);
  }, 60_000);

  it('blocks repeats while the signal is lost', () => {
    for (const seed of seeds('EXPERT', 20, 'lost-repeat')) {
      const chase = new Chase(graph, generateScenario(graph, seed, { lostSignal: true }));
      const bot = new ListenerBot(graph);
      for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
        bot.step(chase, 0.05);
        if (chase.status.signalLost) {
          expect(chase.requestRepeat()).toBeNull();
          expect(chase.status.suspectVisible).toBe(false);
          return;
        }
      }
    }
    throw new Error('No chase lost the signal');
  });
});

it('only drives in the stages a vehicle is named for', () => {
  for (const seed of seeds('EXPERT', 30, 'modes')) {
    const scenario = generateScenario(graph, seed);
    CHASE_TYPE_MODES[scenario.chaseType].forEach((mode, i) => expect(scenario.vehicles[i] !== null).toBe(mode === 'CAR'));
  }
});
