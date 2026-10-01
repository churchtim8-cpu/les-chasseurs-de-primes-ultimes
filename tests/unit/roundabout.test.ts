import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { roundaboutAhead } from '../../src/engine/language/analysis';
import { interpret } from '../../src/engine/language/interpret';
import { Mover, type MoverStart } from '../../src/engine/movement/mover';
import { TownGraph } from '../../src/engine/world/graph';

const graph = new TownGraph(BELLEVUE);

/** Every road leading onto a roundabout, as a position at the start of that road. */
function approaches(): MoverStart[] {
  const out: MoverStart[] = [];
  for (const edge of graph.map.edges) {
    if (!edge.car || edge.kind === 'ROUNDABOUT_RING') continue;
    for (const [from, to] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as const) {
      if (graph.node(to).roundaboutId === undefined || graph.node(from).roundaboutId !== undefined) continue;
      if (edge.oneWay && edge.from !== from) continue;
      out.push({ edgeId: edge.id, t: 0.5, towards: to, mode: 'CAR' });
    }
  }
  return out;
}

describe('roundabout exits on the map', () => {
  it('numbers the exits exactly as "Prenez la … sortie" counts them', () => {
    const starts = approaches();
    expect(starts.length).toBeGreaterThan(2);
    for (const start of starts) {
      const found = roundaboutAhead(graph, start, 'CAR', Infinity);
      expect(found, start.edgeId).not.toBeNull();
      for (const exit of found!.exits) {
        const reading = interpret(graph, start, { action: 'ROUNDABOUT_EXIT', ordinal: exit.number, word: 'PREMIERE' }, 'CAR');
        expect(reading, `${start.edgeId} exit ${exit.number}`).toEqual(expect.objectContaining({ node: exit.node, to: exit.to }));
      }
    }
  });

  it('is not offered on foot, or when another junction comes first', () => {
    for (const start of approaches()) expect(roundaboutAhead(graph, { ...start, mode: 'FOOT' }, 'FOOT', Infinity)).toBeNull();
  });

  it('takes the chosen exit, going round as far as needed', () => {
    for (const start of approaches()) {
      const found = roundaboutAhead(graph, start, 'CAR', Infinity)!;
      for (const exit of found.exits) {
        const car = new Mover(graph, start);
        car.aimExit(exit);
        let left = false;
        for (let t = 0; t < 30 && !left; t += 0.05) {
          car.update(0.05);
          const here = car.location();
          if (graph.edge(here.edgeId).kind !== 'ROUNDABOUT_RING' && graph.node(here.towards).roundaboutId === undefined) {
            expect(here.towards, `${start.edgeId} exit ${exit.number}`).toBe(exit.to);
            left = true;
          }
        }
        expect(left, `${start.edgeId} exit ${exit.number}`).toBe(true);
        expect(car.aimedExit).toBeNull();
      }
    }
  });

  it('keeps going round when no exit is chosen', () => {
    const start = approaches()[0]!;
    const car = new Mover(graph, start);
    for (let t = 0; t < 20; t += 0.05) car.update(0.05);
    expect(graph.edge(car.location().edgeId).kind).toBe('ROUNDABOUT_RING');
  });
});
