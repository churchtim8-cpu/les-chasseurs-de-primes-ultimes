import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { Mover } from '../../src/engine/movement/mover';
import { exitsAt } from '../../src/engine/movement/turns';
import { TownGraph } from '../../src/engine/world/graph';

const graph = new TownGraph(BELLEVUE);
const edgeBetween = (a: string, b: string) =>
  BELLEVUE.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))!;

/** Runs the mover until it has passed `count` nodes (or time runs out). */
function drive(mover: Mover, count: number, seconds = 120): string[] {
  const passed: string[] = [];
  for (let t = 0; t < seconds && passed.length < count; t += 1 / 60) passed.push(...mover.update(1 / 60));
  return passed;
}

describe('turn geometry', () => {
  it('names left, right and straight from the direction of arrival', () => {
    // Driving east along row 2 into the c4r2 crossroads.
    const exits = exitsAt(graph, edgeBetween('c3r2', 'c4r2'), 'c4r2', 'CAR');
    const byKind = Object.fromEntries(exits.map((e) => [e.kind, e.step.to]));
    expect(byKind).toEqual({ LEFT: 'c4r1', RIGHT: 'c4r3', STRAIGHT: 'c5r2' });

    // Same junction arriving from the south: left is now west.
    const fromSouth = exitsAt(graph, edgeBetween('c4r3', 'c4r2'), 'c4r2', 'CAR');
    expect(Object.fromEntries(fromSouth.map((e) => [e.kind, e.step.to]))).toEqual({
      LEFT: 'c3r2',
      RIGHT: 'c5r2',
      STRAIGHT: 'c4r1',
    });
  });

  it('offers footpaths only on foot', () => {
    const car = exitsAt(graph, edgeBetween('c3r1', 'c4r1'), 'c4r1', 'CAR').map((e) => e.step.to);
    const foot = exitsAt(graph, edgeBetween('c3r1', 'c4r1'), 'c4r1', 'FOOT').map((e) => e.step.to);
    expect(car).not.toContain('PL');
    expect(foot).toContain('PL');
  });

  it('treats the roundabout ring as straight on and exits as right turns', () => {
    const exits = exitsAt(graph, edgeBetween('RB_W', 'RB_S'), 'RB_S', 'CAR');
    expect(Object.fromEntries(exits.map((e) => [e.kind, e.step.to]))).toEqual({ STRAIGHT: 'RB_E', RIGHT: 'c5r4' });
  });
});

describe('mover', () => {
  it('cruises straight on through crossroads', () => {
    const mover = new Mover(graph, { edgeId: edgeBetween('c3r2', 'c4r2').id, t: 0.5, towards: 'c4r2', mode: 'CAR' });
    expect(drive(mover, 3)).toEqual(['c4r2', 'c5r2', 'c6r2']);
  });

  it('takes a queued turn at the next junction', () => {
    const mover = new Mover(graph, { edgeId: edgeBetween('c3r2', 'c4r2').id, t: 0.5, towards: 'c4r2', mode: 'CAR' });
    mover.queue('LEFT');
    expect(drive(mover, 2)).toEqual(['c4r2', 'c4r1']);
    expect(mover.snapshot().queued).toBeNull();
  });

  it('holds a queued turn through junctions where it is impossible', () => {
    // Row 0 is the northern edge of town: no junction on it has a left turn when driving east.
    const mover = new Mover(graph, { edgeId: edgeBetween('c3r0', 'c4r0').id, t: 0.5, towards: 'c4r0', mode: 'CAR' });
    mover.queue('LEFT');
    expect(drive(mover, 3)).toEqual(['c4r0', 'c5r0', 'c6r0']);
    expect(mover.snapshot().queued).toBe('LEFT');
  });

  it('keeps a queued turn through a bend', () => {
    // c0r1 is a corner: driving west along row 1 the road bends south on its own.
    const mover = new Mover(graph, { edgeId: edgeBetween('c1r1', 'c0r1').id, t: 0.5, towards: 'c0r1', mode: 'CAR' });
    mover.queue('RIGHT');
    const passed = drive(mover, 2);
    expect(passed).toEqual(['c0r1', 'c0r2']);
    // Driving south into c0r2, right is west: there is no road that way, so the turn stays queued.
    expect(mover.snapshot().queued).toBe('RIGHT');
  });

  it('waits at a T-junction until told which way, then goes', () => {
    // Driving north on column 1 into c1r1: the station blocks the way ahead, so it is left or right.
    const mover = new Mover(graph, { edgeId: edgeBetween('c1r2', 'c1r1').id, t: 0.2, towards: 'c1r1', mode: 'CAR' });
    drive(mover, 1);
    for (let i = 0; i < 120; i++) mover.update(1 / 60);
    expect(mover.snapshot().waiting).toBe('JUNCTION');
    expect(mover.snapshot().speed).toBe(0);
    mover.queue('RIGHT');
    expect(mover.snapshot().waiting).toBeNull();
    expect(drive(mover, 1)).toEqual(['c2r1']);
  });

  it('stops at a dead end and can turn around', () => {
    const mover = new Mover(graph, { edgeId: edgeBetween('c2r2', 'Q2W').id, t: 0.1, towards: 'Q2W', mode: 'CAR' });
    drive(mover, 1);
    expect(mover.snapshot().waiting).toBe('DEAD_END');
    expect(mover.uTurn()).toBe(true);
    expect(drive(mover, 1)).toEqual(['c2r2']);
  });

  it('will not turn around against one-way traffic', () => {
    const mover = new Mover(graph, { edgeId: edgeBetween('RB_W', 'RB_S').id, t: 0.5, towards: 'RB_S', mode: 'CAR' });
    expect(mover.uTurn()).toBe(false);
    // On foot the ring is just a pavement.
    expect(mover.setMode('FOOT')).toBe(true);
    expect(mover.uTurn()).toBe(true);
  });

  it('goes round the roundabout and takes the chosen exit', () => {
    const mover = new Mover(graph, { edgeId: edgeBetween('c4r3', 'RB_W').id, t: 0.5, towards: 'RB_W', mode: 'CAR' });
    const passed = drive(mover, 3);
    expect(passed).toEqual(['RB_W', 'RB_S', 'RB_E']); // no exit chosen: keeps circling
    mover.queue('RIGHT');
    expect(drive(mover, 2)).toEqual(['RB_N', 'c5r2']);
  });

  it('can walk through the park but not drive through it', () => {
    const walker = new Mover(graph, { edgeId: edgeBetween('c6r2', 'c7r2').id, t: 0.5, towards: 'c7r2', mode: 'FOOT' });
    expect(drive(walker, 3)).toEqual(['c7r2', 'PK', 'c8r2']);
    const driver = new Mover(graph, { edgeId: edgeBetween('c6r2', 'c7r2').id, t: 0.5, towards: 'c7r2', mode: 'CAR' });
    drive(driver, 1);
    for (let i = 0; i < 120; i++) driver.update(1 / 60);
    expect(driver.snapshot().waiting).toBe('JUNCTION'); // T-junction for cars: park ahead
  });

  it('only lets you drive where cars can go', () => {
    const walker = new Mover(graph, { edgeId: edgeBetween('PL', 'c4r1').id, t: 0.5, towards: 'c4r1', mode: 'FOOT' });
    expect(walker.setMode('CAR')).toBe(false);
    expect(walker.mode).toBe('FOOT');
  });

  it('accelerates, cruises and brakes', () => {
    const mover = new Mover(graph, { edgeId: edgeBetween('c3r0', 'c4r0').id, t: 0, towards: 'c4r0', mode: 'CAR' });
    for (let i = 0; i < 60; i++) mover.update(1 / 60);
    const cruising = mover.snapshot().speed;
    expect(cruising).toBeGreaterThan(30);
    mover.setThrottle('BRAKE');
    for (let i = 0; i < 60; i++) mover.update(1 / 60);
    expect(mover.snapshot().speed).toBe(0);
  });
});

describe('mover location', () => {
  it('round-trips through location()', () => {
    const mover = new Mover(graph, { edgeId: edgeBetween('c4r2', 'c5r2').id, t: 0.3, towards: 'c4r2', mode: 'CAR' });
    for (let i = 0; i < 20; i++) mover.update(1 / 60);
    const copy = new Mover(graph, mover.location());
    expect(copy.snapshot().x).toBeCloseTo(mover.snapshot().x, 6);
    expect(copy.snapshot().y).toBeCloseTo(mover.snapshot().y, 6);
    expect(copy.snapshot().heading).toBeCloseTo(mover.snapshot().heading, 6);
  });
});
