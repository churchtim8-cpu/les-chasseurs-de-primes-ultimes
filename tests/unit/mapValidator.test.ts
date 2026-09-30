import { describe, expect, it } from 'vitest';
import { BELLEVUE } from '../../src/content/map/bellevue';
import type { TownMap } from '../../src/engine/world/types';
import { validateMap } from '../../src/engine/world/validate';

// Each test breaks the real map in one way and checks the validator notices.
const clone = (): TownMap => structuredClone(BELLEVUE);
const codes = (map: TownMap) => new Set(validateMap(map).map((i) => i.code));

describe('map validator catches broken maps', () => {
  it('a missing location', () => {
    const map = clone();
    map.locations = map.locations.filter((l) => l.id !== 'LIBRARY');
    expect(codes(map)).toContain('MISSING_LOCATION');
  });

  it('a location that is not approved vocabulary', () => {
    const map = clone();
    map.locations.push({ ...map.locations[0]!, id: 'CASINO', footprint: { x: 0, y: 0, w: 1, h: 1 } });
    expect(codes(map)).toContain('UNKNOWN_LOCATION');
  });

  it('a building on a road', () => {
    const map = clone();
    map.locations.find((l) => l.id === 'BANK')!.footprint = { x: 1190, y: 450, w: 60, h: 40 };
    expect(codes(map)).toContain('BUILDING_ON_ROAD');
  });

  it('an entrance far from its building', () => {
    const map = clone();
    const cinema = map.locations.find((l) => l.id === 'CINEMA')!;
    cinema.entrances = [{ edgeId: 'c3r0-c4r0', t: 0.5 }];
    expect(codes(map)).toContain('FAR_ENTRANCE');
  });

  it('a road through water that is not a bridge', () => {
    const map = clone();
    map.edges.find((e) => e.bridge)!.bridge = undefined;
    const found = codes(map);
    expect(found).toContain('ROAD_IN_WATER');
    expect(found).toContain('NO_BRIDGE');
  });

  it('a single chokepoint', () => {
    const map = clone();
    // Remove both northern canal crossings: the bridge becomes the only way west.
    map.edges = map.edges.filter((e) => e.id !== 'c2r1-c3r1');
    expect(codes(map)).toContain('SINGLE_ROUTE');
  });

  it('a one-way ring pointing the wrong way at one node', () => {
    const map = clone();
    const ring = map.edges.find((e) => e.id === 'RB_E-RB_N')!;
    [ring.from, ring.to] = [ring.to, ring.from];
    expect(codes(map)).toContain('BAD_ROUNDABOUT');
  });

  it('a disconnected road', () => {
    const map = clone();
    map.nodes.push({ id: 'ISLAND_A', x: 50, y: 900, kind: 'BEND' }, { id: 'ISLAND_B', x: 60, y: 990, kind: 'BEND' });
    map.edges.push({ id: 'ISLAND', from: 'ISLAND_A', to: 'ISLAND_B', kind: 'LANE', car: true, foot: true, streetId: 'c0' });
    const found = codes(map);
    expect(found).toContain('CAR_UNREACHABLE');
    expect(found).toContain('FOOT_UNREACHABLE');
  });
});
