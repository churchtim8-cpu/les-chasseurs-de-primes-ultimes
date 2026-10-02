import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import { LOCATION_WORDS } from '../../src/engine/language/locations';
import { TownGraph } from '../../src/engine/world/graph';
import { validateMap } from '../../src/engine/world/validate';

describe('Bellevue City map', () => {
  const graph = new TownGraph(BELLEVUE);

  it('passes every map validation check', () => {
    expect(validateMap(BELLEVUE)).toEqual([]);
  });

  it('places every approved vocabulary location exactly once', () => {
    const ids = BELLEVUE.locations.map((l) => l.id).sort();
    expect(ids).toEqual(LOCATION_WORDS.map((w) => w.id).sort());
  });

  it('has the navigation features the French needs', () => {
    const kinds = BELLEVUE.nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'JUNCTION').length).toBeGreaterThanOrEqual(40);
    expect(kinds).toContain('DEAD_END');
    expect(BELLEVUE.nodes.filter((n) => n.trafficLight).length).toBeGreaterThanOrEqual(4);
    // Le pont for cars, and the footbridge over the harbour for runners.
    expect(BELLEVUE.edges.filter((e) => e.bridge && e.car)).toHaveLength(1);
    expect(BELLEVUE.edges.filter((e) => e.bridge && !e.car)).toHaveLength(1);
    expect(BELLEVUE.nodes.filter((n) => n.roundaboutId === 'RB')).toHaveLength(4);
  });

  it('keeps the park interior and the promenade pedestrian-only', () => {
    for (const e of BELLEVUE.edges.filter((edge) => edge.streetId.startsWith('pk-') || edge.kind === 'PROMENADE')) {
      expect(e.car).toBe(false);
      expect(e.foot).toBe(true);
    }
    // You can walk through the park but must drive around it.
    const walk = graph.shortestPath('c7r2', 'c8r2', 'FOOT')!;
    const drive = graph.shortestPath('c7r2', 'c8r2', 'CAR')!;
    expect(walk.nodes).toContain('PK');
    expect(drive.length).toBeGreaterThan(walk.length * 1.5);
  });

  it('offers more than one way across the canal', () => {
    const viaBridge = graph.shortestPath('c1r3', 'c3r3', 'CAR')!;
    expect(viaBridge.edges).toContain('BW-BE');
    const noBridge = graph.shortestPath('c1r3', 'c3r3', 'CAR', new Set(['BW-BE']));
    expect(noBridge).not.toBeNull();
    expect(noBridge!.edges).not.toContain('BW-BE');
  });

  it('sends cars round the roundabout anticlockwise (traffic keeps right)', () => {
    // Entering from the west and leaving north means going three quarters of the way round.
    expect(graph.shortestPath('RB_W', 'RB_N', 'CAR')!.nodes).toEqual(['RB_W', 'RB_S', 'RB_E', 'RB_N']);
    // On foot, direction does not matter.
    expect(graph.shortestPath('RB_W', 'RB_N', 'FOOT')!.nodes).toEqual(['RB_W', 'RB_N']);
  });

  it('is large enough to feel like a town', () => {
    expect(BELLEVUE.width).toBeGreaterThanOrEqual(2000);
    const totalRoad = BELLEVUE.edges.filter((e) => e.car).reduce((sum, e) => sum + graph.edgeLength(e), 0);
    expect(totalRoad).toBeGreaterThan(15_000);
  });
});
