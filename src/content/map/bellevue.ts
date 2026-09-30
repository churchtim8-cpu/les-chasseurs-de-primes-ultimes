/**
 * Bellevue City: the town layout (source of truth for navigation).
 *
 * Layout at a glance (north at the top, sea at the bottom):
 *
 *   - A canal with a harbour basin splits the small west bank (Transport
 *     district: la gare, la gare routière, le parking, la station-service,
 *     l'arrêt de bus) from the rest of town. Cars cross it by two northern
 *     streets or by le pont on the main avenue.
 *   - Town Centre around la place (a pedestrian square) with la mairie,
 *     la banque, la poste, le café, le restaurant and le théâtre.
 *   - Civic buildings along the north: le commissariat, le musée,
 *     la bibliothèque, l'école, l'hôpital.
 *   - Commercial district around le rond-point on the main avenue.
 *   - Le parc (footpaths only inside), le stade, and the seafront strip
 *     (le cinéma, l'hôtel, la piscine) above the promenade and la plage.
 *
 * Grid naming: columns c0..c9 (west to east), rows r0..r4 (north to south),
 * so node "c4r1" is where column 4 meets row 1.
 */

import { Rng } from '../../engine/rng/prng';
import { MapBuilder } from '../../engine/world/builder';
import { HALF_WIDTH, PAVEMENT, pointInPolygon, rectsOverlap, segmentRectDistance } from '../../engine/world/geometry';
import type { Filler, Rect, TownMap } from '../../engine/world/types';

const X = [100, 320, 540, 980, 1200, 1420, 1640, 1860, 2080, 2300] as const;
const Y = [120, 320, 520, 720, 920] as const;
const PROMENADE_Y = 1060;

const n = (c: number, r: number) => `c${c}r${r}`;
const col = (c: number, rows: number[]) => rows.map((r) => n(c, r));
const row = (r: number, cols: number[]) => cols.map((c) => n(c, r));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const TRAFFIC_LIGHTS = new Set(['c1r3', 'c3r3', 'c4r3', 'c6r3', 'c4r1', 'c6r1']);

function buildBellevue(): TownMap {
  const b = new MapBuilder({ id: 'bellevue', name: 'Bellevue City', width: 2400, height: 1300 });

  // ---- Grid nodes -------------------------------------------------------
  for (let c = 0; c < X.length; c++) {
    for (let r = 0; r < Y.length; r++) {
      if (c <= 2 && r === 0) continue; // the railway runs along the north of the west bank
      if (c === 5 && r === 3) continue; // replaced by the roundabout
      if (c === 9 && r === 3) continue; // the stadium fills this corner
      const id = n(c, r);
      b.node(id, X[c] as number, Y[r] as number, TRAFFIC_LIGHTS.has(id) ? { trafficLight: true } : {});
    }
  }

  // Roundabout on the main avenue (ring nodes where roads join).
  const rb = { roundaboutId: 'RB' };
  b.node('RB_N', 1420, 680, rb).node('RB_W', 1380, 720, rb).node('RB_S', 1420, 760, rb).node('RB_E', 1460, 720, rb);
  // Bridge ends, harbour quays, park and square path hubs.
  b.node('BW', 700, 720).node('BE', 820, 720);
  b.node('Q2W', 700, 520).node('Q2E', 820, 520);
  b.node('PK', 1970, 520).node('PKN', 1970, 320).node('PKS', 1970, 720);
  b.node('PL', 1090, 420);
  // Promenade (west and east of the canal mouth).
  for (let c = 0; c < X.length; c++) b.node(`p${c}`, X[c] as number, PROMENADE_Y);
  b.node('PQW', 700, PROMENADE_Y).node('PQE', 820, PROMENADE_Y).node('PE', 2360, PROMENADE_Y);

  // ---- Rows (east-west) ------------------------------------------------
  b.street('r0', 'rue', 'Rue Victor-Hugo', row(0, range(3, 9)), { edgeKind: 'STREET' });
  b.street(
    'r1',
    'rue',
    'Rue de la République',
    [...row(1, range(0, 7)), 'PKN', ...row(1, [8, 9])],
    { edgeKind: 'STREET' },
  );
  b.street('r2w', 'rue', 'Rue Jean-Jaurès', [...row(2, [0, 1, 2]), 'Q2W'], { edgeKind: 'STREET' });
  b.street('r2e', 'rue', 'Rue Jean-Jaurès', ['Q2E', ...row(2, range(3, 7))], { edgeKind: 'STREET' });
  b.street('r2s', 'rue', 'Rue Jean-Jaurès', row(2, [8, 9]), { edgeKind: 'STREET' });
  b.street('r3w', 'avenue', 'Avenue de la Liberté', [...row(3, [0, 1, 2]), 'BW', 'BE', ...row(3, [3, 4]), 'RB_W'], {
    edgeKind: 'AVENUE',
    bridges: [['BW', 'BE']],
  });
  b.street('r3e', 'avenue', 'Avenue de la Liberté', ['RB_E', ...row(3, [6, 7]), 'PKS', n(8, 3)], {
    edgeKind: 'AVENUE',
  });
  b.street('r4w', 'rue', 'Boulevard de la Plage', row(4, [0, 1, 2]), { edgeKind: 'STREET' });
  b.street('r4e', 'rue', 'Boulevard de la Plage', row(4, range(3, 9)), { edgeKind: 'STREET' });

  // ---- Columns (north-south) -------------------------------------------
  b.street('c0', 'rue', 'Rue de la Gare', col(0, [1, 2, 3, 4]), { edgeKind: 'STREET' });
  b.street('c1', 'rue', 'Rue des Rails', col(1, [1, 2, 3, 4]), { edgeKind: 'STREET' });
  b.street('c2', 'rue', 'Quai Ouest', col(2, [1, 2, 3, 4]), { edgeKind: 'STREET' });
  b.street('c3', 'rue', 'Rue Molière', col(3, [0, 1, 2, 3, 4]), { edgeKind: 'STREET' });
  b.street('c4', 'rue', 'Rue de la Mairie', col(4, [0, 1, 2, 3, 4]), { edgeKind: 'STREET' });
  b.street('c5n', 'avenue', 'Avenue des Arts', [...col(5, [0, 1, 2]), 'RB_N'], { edgeKind: 'AVENUE' });
  b.street('c5s', 'avenue', 'Avenue des Arts', ['RB_S', n(5, 4)], { edgeKind: 'AVENUE' });
  b.street('c6', 'rue', 'Rue Pasteur', col(6, [0, 1, 2, 3, 4]), { edgeKind: 'STREET' });
  b.street('c7', 'rue', 'Rue des Écoles', col(7, [0, 1, 2, 3, 4]), { edgeKind: 'STREET' });
  b.street('c8', 'rue', 'Rue du Stade', col(8, [0, 1, 2, 3, 4]), { edgeKind: 'STREET' });
  b.street('c9', 'rue', "Rue de l'Hôpital", col(9, [0, 1, 2, 4]), { edgeKind: 'STREET' });

  // Roundabout ring, one-way anticlockwise as seen on the map (traffic keeps right).
  b.street('rb', 'rond-point', 'Rond-point de la Liberté', ['RB_E', 'RB_N', 'RB_W', 'RB_S'], {
    edgeKind: 'ROUNDABOUT_RING',
    oneWay: true,
    closed: true,
  });

  // ---- Pedestrian ways -------------------------------------------------
  for (const corner of [n(3, 1), n(4, 1), n(3, 2), n(4, 2)]) {
    b.street(`pl-${corner}`, 'chemin', 'Place de la Mairie', ['PL', corner], { edgeKind: 'PATH' });
  }
  b.street('pk-ew', 'chemin', 'Parc des Mouettes', [n(7, 2), 'PK', n(8, 2)], { edgeKind: 'PATH' });
  b.street('pk-ns', 'chemin', 'Parc des Mouettes', ['PKN', 'PK', 'PKS'], { edgeKind: 'PATH' });
  for (let c = 0; c < X.length; c++) {
    b.street(`pa${c}`, 'passage', 'Passage de la Plage', [n(c, 4), `p${c}`], { edgeKind: 'PASSAGE' });
  }
  b.street('pmw', 'promenade', 'Promenade des Mouettes', ['p0', 'p1', 'p2', 'PQW'], { edgeKind: 'PROMENADE' });
  b.street('pme', 'promenade', 'Promenade des Mouettes', ['PQE', ...range(3, 9).map((c) => `p${c}`), 'PE'], {
    edgeKind: 'PROMENADE',
  });

  // ---- Regions (drawn under the roads) ---------------------------------
  b.rectRegion('sea', 'SEA', { x: 0, y: 1190, w: 2400, h: 110 });
  b.rectRegion('sand', 'SAND', { x: 0, y: 1085, w: 2400, h: 105 });
  b.region('canal', 'WATER', [
    [700, 400],
    [820, 400],
    [820, 470],
    [790, 470],
    [790, 1300],
    [730, 1300],
    [730, 470],
    [700, 470],
  ]);
  b.rectRegion('railway', 'RAILWAY', { x: 0, y: 30, w: 720, h: 70 });
  b.rectRegion('park', 'PARK', { x: 1875, y: 335, w: 190, h: 370 });
  b.rectRegion('pond', 'WATER', { x: 1995, y: 380, w: 50, h: 35 });
  b.rectRegion('square', 'PLAZA', { x: 995, y: 335, w: 190, h: 170 });

  // ---- Locations --------------------------------------------------------
  // Transport (west bank)
  b.location('TRAIN_STATION', 'TRANSPORT', { x: 160, y: 120, w: 320, h: 160 }, [
    [n(0, 1), n(1, 1), 0.85],
    [n(1, 1), n(2, 1), 0.15],
  ]);
  b.location('BUS_STATION', 'TRANSPORT', { x: 125, y: 345, w: 170, h: 110 }, [[n(0, 1), n(0, 2), 0.45]]);
  b.location('CAR_PARK', 'TRANSPORT', { x: 340, y: 340, w: 180, h: 150 }, [[n(1, 2), n(2, 2), 0.5]]);
  b.location('GAS_STATION', 'TRANSPORT', { x: 350, y: 560, w: 150, h: 130 }, [[n(1, 3), n(2, 3), 0.5]]);
  b.location('BUS_STOP', 'TRANSPORT', { x: 185, y: 736, w: 50, h: 14 }, [[n(0, 3), n(1, 3), 0.5]]);

  // Civic (north)
  b.location('THEATRE', 'CIVIC', { x: 1005, y: 200, w: 170, h: 105 }, [[n(3, 1), n(4, 1), 0.5]]);
  b.location('POLICE_STATION', 'CIVIC', { x: 1215, y: 190, w: 130, h: 115 }, [[n(4, 1), n(5, 1), 0.4]]);
  b.location('MUSEUM', 'CIVIC', { x: 1440, y: 140, w: 180, h: 150 }, [[n(5, 0), n(5, 1), 0.5]]);
  b.location('LIBRARY', 'CIVIC', { x: 1665, y: 195, w: 140, h: 110 }, [[n(6, 1), n(7, 1), 0.35]]);
  b.location('SCHOOL', 'CIVIC', { x: 1885, y: 135, w: 170, h: 110 }, [[n(7, 0), n(8, 0), 0.5]]);
  b.location('HOSPITAL', 'CIVIC', { x: 2095, y: 135, w: 190, h: 170 }, [
    [n(9, 0), n(9, 1), 0.5],
    [n(8, 0), n(9, 0), 0.5],
  ]);

  // Town Centre
  b.location(
    'SQUARE',
    'TOWN_CENTRE',
    { x: 995, y: 335, w: 190, h: 170 },
    [
      [n(3, 1), n(3, 2), 0.5],
      [n(4, 1), n(4, 2), 0.5],
      [n(3, 2), n(4, 2), 0.5],
      [n(3, 1), n(4, 1), 0.5],
    ],
    { open: true },
  );
  b.location('TOWN_HALL', 'TOWN_CENTRE', { x: 1220, y: 340, w: 120, h: 95 }, [[n(4, 1), n(4, 2), 0.4]]);
  b.location('BANK', 'TOWN_CENTRE', { x: 1220, y: 450, w: 95, h: 55 }, [[n(4, 2), n(5, 2), 0.25]]);
  b.location('POST_OFFICE', 'TOWN_CENTRE', { x: 995, y: 535, w: 95, h: 70 }, [[n(3, 2), n(4, 2), 0.25]]);
  b.location('CAFE', 'TOWN_CENTRE', { x: 1105, y: 535, w: 80, h: 60 }, [[n(3, 2), n(4, 2), 0.75]]);
  b.location('RESTAURANT', 'TOWN_CENTRE', { x: 995, y: 625, w: 105, h: 78 }, [[n(3, 3), n(4, 3), 0.3]]);

  // Commercial
  b.location('BOOKSHOP', 'COMMERCIAL', { x: 1440, y: 440, w: 80, h: 65 }, [[n(5, 2), n(6, 2), 0.2]]);
  b.location('PHARMACY', 'COMMERCIAL', { x: 1540, y: 440, w: 85, h: 65 }, [[n(5, 2), n(6, 2), 0.72]]);
  b.location('SHOP', 'COMMERCIAL', { x: 1660, y: 340, w: 90, h: 70 }, [[n(6, 1), n(7, 1), 0.45]]);
  b.location('SHOPPING_CENTRE', 'COMMERCIAL', { x: 1480, y: 540, w: 145, h: 125 }, [[n(6, 2), n(6, 3), 0.5]]);
  b.location('SUPERMARKET', 'COMMERCIAL', { x: 1660, y: 540, w: 175, h: 85 }, [[n(6, 2), n(7, 2), 0.5]]);
  b.location('BAKERY', 'COMMERCIAL', { x: 1660, y: 640, w: 80, h: 62 }, [[n(6, 3), n(7, 3), 0.25]]);
  b.location('MARKET', 'COMMERCIAL', { x: 1480, y: 770, w: 145, h: 125 }, [[n(6, 3), n(6, 4), 0.5]]);

  // Recreation / Coastal
  b.location(
    'PARK',
    'COASTAL',
    { x: 1875, y: 335, w: 190, h: 370 },
    [
      ['PKN', 'PK', 0.05],
      [n(7, 2), 'PK', 0.05],
      [n(8, 2), 'PK', 0.05],
      ['PKS', 'PK', 0.05],
    ],
    { open: true },
  );
  b.location('STADIUM', 'COASTAL', { x: 2100, y: 540, w: 185, h: 365 }, [
    [n(8, 3), n(8, 4), 0.5],
    [n(8, 4), n(9, 4), 0.5],
  ]);
  b.location('CINEMA', 'COASTAL', { x: 1215, y: 935, w: 170, h: 95 }, [[n(4, 4), n(5, 4), 0.5]]);
  b.location('HOTEL', 'COASTAL', { x: 1440, y: 935, w: 180, h: 100 }, [[n(5, 4), n(6, 4), 0.5]]);
  b.location('SWIMMING_POOL', 'COASTAL', { x: 1880, y: 935, w: 180, h: 100 }, [[n(7, 4), n(8, 4), 0.5]]);
  b.location(
    'BEACH',
    'COASTAL',
    { x: 820, y: 1085, w: 1560, h: 100 },
    [
      ['p3', 'p4', 0.5],
      ['p5', 'p6', 0.5],
      ['p7', 'p8', 0.5],
    ],
    { open: true },
  );

  b.setFillers(placeFillers(b.snapshot()));
  return b.build();
}

/**
 * Plain buildings lining the streets, placed automatically wherever there is
 * room: clear of roads and pavements, locations, water, parks and the square.
 * Deterministic, so the town looks the same every time.
 */
function placeFillers(map: TownMap): Filler[] {
  const rng = Rng.fromSeed('bellevue-fillers');
  const nodes = new Map(map.nodes.map((node) => [node.id, node]));
  const segments = map.edges.map((e) => {
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    const clearance = HALF_WIDTH[e.kind] + (e.car ? PAVEMENT + 1 : 2);
    return { a, b, clearance, car: e.car };
  });
  const fillers: Filler[] = [];
  const cell = 58;

  for (let y = 20; y < 1060; y += cell) {
    for (let x = 20; x < map.width - 40; x += cell) {
      const w = Math.round(rng.range(40, 52));
      const h = Math.round(rng.range(38, 50));
      const rect: Rect = { x: x + rng.int(0, 4), y: y + rng.int(0, 4), w, h };
      const corners: [number, number][] = [
        [rect.x, rect.y],
        [rect.x + rect.w, rect.y],
        [rect.x, rect.y + rect.h],
        [rect.x + rect.w, rect.y + rect.h],
        [rect.x + rect.w / 2, rect.y + rect.h / 2],
      ];
      if (map.regions.some((r) => corners.some(([px, py]) => pointInPolygon({ x: px, y: py }, r.points)))) continue;
      if (map.locations.some((l) => rectsOverlap(l.footprint, rect, 8))) continue;
      if (fillers.some((f) => rectsOverlap(f.footprint, rect, 6))) continue;
      let nearStreet = false;
      let clear = true;
      for (const s of segments) {
        const d = segmentRectDistance(s.a, s.b, rect);
        if (d < s.clearance) {
          clear = false;
          break;
        }
        if (s.car && d < 40) nearStreet = true;
      }
      if (clear && nearStreet) fillers.push({ id: `F${fillers.length}`, footprint: rect });
    }
  }
  return fillers;
}

export const BELLEVUE: TownMap = buildBellevue();
