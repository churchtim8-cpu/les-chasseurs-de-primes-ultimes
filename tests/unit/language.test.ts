import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { Chase } from '../../src/engine/chase/chase';
import { generateScenario, type ScenarioOptions } from '../../src/engine/chase/scenario';
import { DIFFICULTIES, type Difficulty } from '../../src/engine/difficulty';
import { actionIndices } from '../../src/engine/language/generate';
import { makeInstruction, type Clause, type TemplateId } from '../../src/engine/language/instructions';
import { interpret } from '../../src/engine/language/interpret';
import type { Transmission } from '../../src/engine/language/navigator';
import { LANGUAGE_SETTINGS } from '../../src/engine/language/settings';
import type { MoverStart } from '../../src/engine/movement/mover';
import { exitsAt, type TurnIntent } from '../../src/engine/movement/turns';
import { Rng } from '../../src/engine/rng/prng';
import { createSeed } from '../../src/engine/rng/seedCode';
import { TownGraph } from '../../src/engine/world/graph';
import { ListenerBot } from './listenerBot';

const graph = new TownGraph(BELLEVUE);

function seeds(difficulty: Difficulty, count: number, label: string): string[] {
  const rng = Rng.fromSeed(`${label}-${difficulty}`);
  return Array.from({ length: count }, () => createSeed(difficulty, (n) => rng.int(0, n - 1)).code);
}

const at = (edgeId: string, t: number, towards: string): MoverStart => ({ edgeId, t, towards, mode: 'CAR' });

describe('French sentences', () => {
  const text = (...clauses: Clause[]) => makeInstruction(clauses, 'INTERMEDIATE').text;

  it('builds the approved sentence shapes with correct articles', () => {
    expect(text({ action: 'TURN', side: 'LEFT' })).toBe('Tournez à gauche.');
    expect(text({ action: 'STRAIGHT' })).toBe('Continuez tout droit.');
    expect(text({ action: 'TURN', side: 'RIGHT', landmark: 'CINEMA', relation: 'APRES' })).toBe(
      'Tournez à droite après le cinéma.',
    );
    expect(text({ action: 'TURN', side: 'LEFT', landmark: 'BANK', relation: 'DEVANT' })).toBe(
      'Tournez à gauche devant la banque.',
    );
    expect(text({ action: 'TURN', side: 'LEFT', landmark: 'HOSPITAL', relation: 'AVANT' })).toBe(
      "Tournez à gauche avant l'hôpital.",
    );
    expect(text({ action: 'TAKE_STREET', side: 'RIGHT', ordinal: 2, word: 'DEUXIEME' })).toBe(
      'Prenez la deuxième rue à droite.',
    );
    expect(text({ action: 'TAKE_STREET', side: 'LEFT', ordinal: 1, word: 'PROCHAINE' })).toBe(
      'Prenez la prochaine rue à gauche.',
    );
    expect(text({ action: 'ROUNDABOUT_EXIT', ordinal: 3, word: 'TROISIEME' })).toBe(
      'Au rond-point, prenez la troisième sortie.',
    );
    expect(text({ action: 'CONTINUE_UNTIL', landmark: 'CINEMA', verb: 'ALLEZ' })).toBe("Allez jusqu'au cinéma.");
    expect(text({ action: 'CONTINUE_UNTIL', landmark: 'BANK', verb: 'CONTINUEZ' })).toBe(
      "Continuez jusqu'à la banque.",
    );
    expect(text({ action: 'CONTINUE_UNTIL', landmark: 'SCHOOL', verb: 'CONTINUEZ' })).toBe(
      "Continuez jusqu'à l'école.",
    );
    expect(text({ action: 'WRONG_STREET' })).toBe("Ce n'est pas la bonne rue.");
    expect(text({ action: 'U_TURN' })).toBe('Faites demi-tour.');
  });

  it('joins two actions with "puis" into one sentence (I3)', () => {
    const i = makeInstruction(
      [
        { action: 'TURN', side: 'LEFT' },
        { action: 'TAKE_STREET', side: 'RIGHT', ordinal: 1, word: 'PREMIERE' },
      ],
      'INTERMEDIATE',
    );
    expect(i.text).toBe('Tournez à gauche, puis prenez la première rue à droite.');
    expect(i.template).toBe('I3');
    expect(i.audioId).toBe('seq.turn.left+puis+street.right.premiere');
    expect(
      makeInstruction(
        [
          { action: 'TURN', side: 'RIGHT' },
          { action: 'ROUNDABOUT_EXIT', ordinal: 2, word: 'DEUXIEME' },
        ],
        'INTERMEDIATE',
      ).text,
    ).toBe('Tournez à droite, puis, au rond-point, prenez la deuxième sortie.');
  });

  it('builds the Hard shapes: full two-step sentences, and "Ensuite" for a third step (H1–H4)', () => {
    const left: Clause = { action: 'TURN', side: 'LEFT' };
    const right: Clause = { action: 'TURN', side: 'RIGHT' };
    const street2: Clause = { action: 'TAKE_STREET', side: 'LEFT', ordinal: 2, word: 'DEUXIEME' };
    const h1 = makeInstruction([{ action: 'TURN', side: 'LEFT', landmark: 'BANK', relation: 'DEVANT' }, street2], 'HARD');
    expect(h1.template).toBe('H1');
    expect(h1.text).toBe('Tournez à gauche devant la banque, puis prenez la deuxième rue à gauche.');
    expect(h1.clips.map((c) => c.audioId)).toEqual(['seq.turn.left.devant.bank+puis+street.left.deuxieme']);
    const h2 = makeInstruction([{ action: 'TURN', side: 'RIGHT', landmark: 'CINEMA', relation: 'APRES' }, left], 'HARD');
    expect(h2.template).toBe('H2');
    expect(h2.text).toBe('Tournez à droite après le cinéma, puis tournez à gauche.');
    const h3 = makeInstruction([left, right, street2], 'HARD');
    expect(h3.template).toBe('H3');
    expect(h3.text).toBe('Tournez à gauche, puis tournez à droite. Ensuite, prenez la deuxième rue à gauche.');
    expect(h3.clips.map((c) => c.audioId)).toEqual(['seq.turn.left+puis+turn.right', 'link.ensuite.street.left.deuxieme']);
    const third: Clause = { action: 'TAKE_STREET', side: 'RIGHT', ordinal: 3, word: 'TROISIEME' };
    expect(makeInstruction([third], 'HARD').template).toBe('H4');
    expect(makeInstruction([third], 'INTERMEDIATE').template).toBe('I2');
  });

  it('builds Expert sequences with "D\'abord, Ensuite, Enfin" (X1, X2)', () => {
    const x1 = makeInstruction(
      [
        { action: 'TURN', side: 'LEFT' },
        { action: 'TAKE_STREET', side: 'RIGHT', ordinal: 1, word: 'PREMIERE' },
        { action: 'ROUNDABOUT_EXIT', ordinal: 2, word: 'DEUXIEME' },
      ],
      'EXPERT',
      [],
      'LINKED',
    );
    expect(x1.template).toBe('X1');
    expect(x1.text).toBe(
      "D'abord, tournez à gauche. Ensuite, prenez la première rue à droite. Enfin, au rond-point, prenez la deuxième sortie.",
    );
    const x2 = makeInstruction(
      [
        { action: 'TURN', side: 'LEFT', landmark: 'BANK', relation: 'DEVANT' },
        { action: 'TURN', side: 'RIGHT', landmark: 'CINEMA', relation: 'APRES' },
      ],
      'EXPERT',
      [],
      'LINKED',
    );
    expect(x2.template).toBe('X2');
    expect(x2.text).toBe("D'abord, tournez à gauche devant la banque. Ensuite, tournez à droite après le cinéma.");
    expect(x2.clips.map((c) => c.audioId)).toEqual(['link.dabord.turn.left.devant.bank', 'link.ensuite.turn.right.apres.cinema']);
  });

  it('gives every sentence one stable audio ID', () => {
    const a = makeInstruction([{ action: 'TURN', side: 'RIGHT', landmark: 'BANK', relation: 'APRES' }], 'EASY');
    expect(a.audioId).toBe('dir.turn.right.apres.bank');
    expect(a.template).toBe('E3');
  });
});

describe('interpreter (how a listener reads an instruction)', () => {
  // Driving east along Rue Jean-Jaurès from la poste (c3r2) towards c4r2, c5r2, c6r2...
  const east = at('c3r2-c4r2', 0.2, 'c4r2');

  it('"Tournez à gauche" means the first street on the left', () => {
    expect(interpret(graph, east, { action: 'TURN', side: 'LEFT' }, 'CAR')).toMatchObject({ node: 'c4r2', to: 'c4r1' });
  });

  it('counts streets on one side only', () => {
    const second = interpret(graph, east, { action: 'TAKE_STREET', side: 'LEFT', ordinal: 2, word: 'DEUXIEME' }, 'CAR');
    expect(second).toMatchObject({ node: 'c5r2', to: 'c5r1' });
  });

  it('"devant la banque" is the junction at the bank', () => {
    const reading = interpret(graph, east, { action: 'TURN', side: 'RIGHT', landmark: 'BANK', relation: 'DEVANT' }, 'CAR');
    expect(reading).toMatchObject({ node: 'c4r2', to: 'c4r3' });
  });

  it('refuses "après" a place that stands at a junction where the turn could be made', () => {
    // Le café is on the corner of c4r2: "après le café" could mean c4r2 or c5r2.
    expect(interpret(graph, east, { action: 'TURN', side: 'LEFT', landmark: 'CAFE', relation: 'APRES' }, 'CAR')).toBeNull();
  });

  it('refuses places that are not on the road ahead', () => {
    expect(interpret(graph, east, { action: 'TURN', side: 'LEFT', landmark: 'BEACH', relation: 'APRES' }, 'CAR')).toBeNull();
    expect(interpret(graph, east, { action: 'TURN', side: 'LEFT', landmark: 'STADIUM', relation: 'DEVANT' }, 'CAR')).toBeNull();
  });

  it('counts roundabout exits from the entry', () => {
    // Heading east on the avenue into the roundabout at RB_W: exits RB_S (1st), RB_E (2nd), RB_N (3rd).
    const into = at('c4r3-RB_W', 0.3, 'RB_W');
    expect(interpret(graph, into, { action: 'ROUNDABOUT_EXIT', ordinal: 1, word: 'PREMIERE' }, 'CAR')).toMatchObject({
      node: 'RB_S',
    });
    expect(interpret(graph, into, { action: 'ROUNDABOUT_EXIT', ordinal: 2, word: 'DEUXIEME' }, 'CAR')).toMatchObject({
      node: 'RB_E',
    });
  });
});

/** Plays one chase with the listening bot. */
function listen(seed: string, reaction = 1.2, options: ScenarioOptions = {}) {
  const chase = new Chase(graph, generateScenario(graph, seed, options));
  const bot = new ListenerBot(graph, reaction);
  for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) bot.step(chase, 0.05);
  return { chase, status: chase.status, log: bot.log };
}

const templatesIn = (log: Transmission[]) => new Set(log.flatMap((t) => t.instructions.map((i) => i.template)));

describe('scanner instructions in real chases', () => {
  it.each(DIFFICULTIES)('a student who understands the French catches the suspect (%s)', (difficulty) => {
    const runs = seeds(difficulty, 120, 'listen').map((s) => listen(s));
    const captured = runs.filter((r) => r.status.phase === 'CAPTURED').length;
    expect(captured / runs.length).toBeGreaterThanOrEqual(0.95);
    // Following the French exactly never produces "Ce n'est pas la bonne rue".
    const corrected = runs.filter((r) => r.log.some((t) => t.kind === 'RECOVERY'));
    expect(corrected.map((r) => r.chase.scenario.seed)).toEqual([]);
  });

  it.each(DIFFICULTIES)('every turn on the route is announced before the junction (%s)', (difficulty) => {
    for (const seed of seeds(difficulty, 60, 'announce')) {
      const { chase, log } = listen(seed, 1.2, { chaseType: 'CAR_CAR' });
      const route = chase.scenario.route;
      const announced = new Set(log.flatMap((t) => t.instructions.flatMap((i) => i.atNodes)));
      const reached = new Set<string>();
      // The actions the player actually reached must all have been announced.
      const progressNode = route.indexOf(chase.player.snapshot().towards);
      for (const a of actionIndices(graph, route, 'CAR')) if (a < progressNode) reached.add(route[a] as string);
      for (const node of reached) expect(announced, `${seed} ${node}`).toContain(node);
    }
  });

  it('uses only the templates allowed at each difficulty', () => {
    for (const difficulty of DIFFICULTIES) {
      const used = new Set<TemplateId>();
      for (const seed of seeds(difficulty, 60, 'templates')) for (const t of templatesIn(listen(seed).log)) used.add(t);
      const allowed = new Set([...Object.keys(LANGUAGE_SETTINGS[difficulty].weights), 'R']);
      for (const t of used) expect(allowed, `${difficulty} used ${t}`).toContain(t);
      if (difficulty === 'EASY') expect([...used]).toEqual(expect.arrayContaining(['E1', 'E3']));
      if (difficulty === 'INTERMEDIATE') expect([...used]).toEqual(expect.arrayContaining(['I1', 'I2', 'I3']));
      if (difficulty === 'HARD') expect([...used]).toEqual(expect.arrayContaining(['H1', 'H3', 'H4']));
      if (difficulty === 'EXPERT') expect([...used]).toEqual(expect.arrayContaining(['X1', 'X2']));
    }
  });

  it.each(DIFFICULTIES)('the scanner speaks as soon as the chase starts (%s)', (difficulty) => {
    for (const seed of seeds(difficulty, 150, 'first-call')) {
      const chase = new Chase(graph, generateScenario(graph, seed));
      const first = chase.update(0.05).find((e) => e.type === 'TRANSMISSION');
      expect(first, seed).toBeDefined();
    }
  });

  it('uses "troisième" from Intermediate upwards only', () => {
    const texts = (difficulty: Difficulty) =>
      seeds(difficulty, 150, 'troisieme').flatMap((s) => listen(s).log.map((t) => t.text));
    expect(texts('EASY').filter((t) => t.includes('troisième'))).toEqual([]);
    expect(texts('INTERMEDIATE').some((t) => t.includes('troisième'))).toBe(true);
  });

  it('is reproducible: the same seed gives the same transmissions', () => {
    for (const seed of seeds('INTERMEDIATE', 10, 'repro')) {
      expect(listen(seed).log.map((t) => t.text)).toEqual(listen(seed).log.map((t) => t.text));
    }
  });

  it('corrects a wrong turn and guides the player back to the suspect', () => {
    let corrected = 0;
    let caught = 0;
    const all = seeds('EASY', 60, 'wrong-turn');
    for (const seed of all) {
      const chase = new Chase(graph, generateScenario(graph, seed, { chaseType: 'CAR_CAR' }));
      const bot = new ListenerBot(graph);
      // Take the first wrong street offered, then listen again.
      let wrongDone = false;
      const log: Transmission[] = [];
      for (let t = 0; t < 400 && chase.status.phase === 'PURSUIT'; t += 0.05) {
        if (!wrongDone && t > 2) {
          const me = chase.player.snapshot();
          const exits = exitsAt(graph, graph.edge(me.edgeId), me.towards, 'CAR');
          const plan = chase.navigator.guide;
          const wrong = exits.find((e) => !plan.includes(e.step.to) && e.kind !== 'BACK');
          if (wrong && exits.length > 1) {
            chase.player.queue(wrong.kind as TurnIntent);
            wrongDone = true;
          }
        }
        for (const e of bot.step(chase, 0.05)) if (e.type === 'TRANSMISSION') log.push(e.transmission);
      }
      if (log.some((t) => t.text.startsWith("Ce n'est pas la bonne rue."))) corrected++;
      if (chase.status.phase === 'CAPTURED') caught++;
    }
    expect(corrected).toBeGreaterThan(all.length * 0.8);
    expect(caught).toBeGreaterThan(all.length * 0.6);
  });
});
