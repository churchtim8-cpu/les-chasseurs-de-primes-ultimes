import Phaser from 'phaser';
import { LOCATION_WORD_BY_ID, withArticle } from '../../engine/language/locations';
import { Rng } from '../../engine/rng/prng';
import { HALF_WIDTH, PAVEMENT, pointInPolygon, pointInRect, pointSegmentDistance } from '../../engine/world/geometry';
import type { TownGraph } from '../../engine/world/graph';
import type { EdgeKind, MapEdge, Rect, Region, RegionKind } from '../../engine/world/types';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';
import { building, palm, tree } from './art';
import { LANDMARKS, type SignText } from './landmarks';

/**
 * Draws Bellevue City from the map data. Roads, paths, the bridge and the
 * roundabout are generated from the navigation graph, so the picture can never
 * disagree with the routes. Buildings, trees and other decoration are
 * drawn on the footprints and open ground the map data leaves free.
 */

const REGION_COLOUR: Record<RegionKind, number> = {
  SEA: PALETTE.sea,
  SAND: PALETTE.sand,
  WATER: 0x3b9fb3,
  PARK: PALETTE.green,
  PLAZA: PALETTE.stone,
  RAILWAY: 0xb9aea0,
};

const ROOF_VARIANTS = [0xc8674a, 0xb65c43, 0x9c6b5a, 0xd98c75, 0x8a6f63, 0xc47a52];

const CAR_KINDS: EdgeKind[] = ['AVENUE', 'STREET', 'LANE', 'ROUNDABOUT_RING'];

export interface LocationLabel {
  text: Phaser.GameObjects.Text;
  /** Width of the building in metres, used to wrap long names. */
  width: number;
}

export interface TownLayers {
  /** Location labels, rescaled with the camera so they stay readable. */
  labels: LocationLabel[];
  /** Graph overlay for debug mode. */
  debug: Phaser.GameObjects.Container;
}

export function drawTown(scene: Phaser.Scene, graph: TownGraph): TownLayers {
  const map = graph.map;
  drawSurroundings(scene, map.width, map.height, map.regions.find((r) => r.kind === 'SEA'));
  const g = scene.add.graphics();

  // Ground, regions.
  g.fillStyle(0xe9e2cf).fillRect(0, 0, map.width, map.height);
  for (const region of map.regions) {
    g.fillStyle(REGION_COLOUR[region.kind]);
    g.fillPoints(region.points.map(([x, y]) => new Phaser.Math.Vector2(x, y)), true);
  }
  drawRailway(g, map.regions.find((r) => r.kind === 'RAILWAY')?.points);

  const carEdges = map.edges.filter((e) => e.car);
  const footEdges = map.edges.filter((e) => !e.car);

  // Footpaths first (under roads where they meet).
  for (const e of footEdges) {
    // The footbridge has a wooden deck and railings.
    const colour = e.bridge ? 0xb08a5a : e.kind === 'PATH' ? 0xd8c9a3 : 0xcdb994;
    strokeEdge(g, graph, e, HALF_WIDTH[e.kind], colour);
    if (e.bridge) drawBridge(g, graph, e);
  }

  // Pavements, then asphalt, drawn as thick strokes with round joints at nodes.
  for (const e of carEdges) strokeEdge(g, graph, e, HALF_WIDTH[e.kind] + PAVEMENT, PALETTE.stone);
  drawRoundabout(g, graph, true);
  for (const e of carEdges) strokeEdge(g, graph, e, HALF_WIDTH[e.kind], PALETTE.road);
  drawRoundabout(g, graph, false);
  for (const e of carEdges) if (e.bridge) drawBridge(g, graph, e);
  for (const e of carEdges) {
    if ((e.kind === 'AVENUE' || e.kind === 'STREET') && !e.bridge) drawCentreLine(g, graph, e);
  }
  drawCrossings(g, graph);
  for (const node of map.nodes.filter((n) => n.trafficLight)) drawTrafficLight(g, node.x, node.y);

  // Trees on free ground, then buildings: plain houses, then the vocabulary places.
  drawTrees(g, graph);
  map.fillers.forEach((f, i) => drawHouse(g, f.footprint, i));
  const sign: SignText = (x, y, text, size, colour, bold = false) => {
    scene.add
      .text(x, y, text, {
        fontFamily: FONT_FAMILY,
        fontSize: `${size}px`,
        fontStyle: bold ? 'bold' : 'normal',
        color: toCss(colour),
      })
      .setOrigin(0.5)
      .setResolution(4)
      .setDepth(1);
  };
  for (const loc of map.locations) LANDMARKS[loc.id]?.(g, loc.footprint, sign);
  bake(scene, g, map.width, map.height);

  // French labels for every location.
  const labels = map.locations.map((loc) => {
    const word = LOCATION_WORD_BY_ID.get(loc.id);
    const { x, y, w, h } = loc.footprint;
    // Under the building's front so its picture stays visible (centred on open places).
    const labelY = loc.open ? y + h / 2 : y + h + 4;
    const text = scene.add
      .text(x + w / 2, labelY, word ? withArticle(word) : loc.id, {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: 'bold',
        color: toCss(PALETTE.ink),
        backgroundColor: 'rgba(246, 236, 210, 0.88)',
        padding: { x: 5, y: 2 },
        align: 'center',
      })
      .setOrigin(0.5, loc.open ? 0.5 : 0)
      .setDepth(10);
    return { text, width: w };
  });

  return { labels, debug: drawDebugGraph(scene, graph) };
}

/** How far beyond the town's edge the countryside and sea are drawn (metres). */
const SURROUND = 1200;

/**
 * Countryside around the town and the sea beyond the beach, seen when the map
 * turns with the player near the edge (an upright view stops at the edge).
 */
function drawSurroundings(scene: Phaser.Scene, width: number, height: number, sea: Region | undefined) {
  const seaTop = sea ? Math.min(...sea.points.map(([, y]) => y)) : height;
  scene.add
    .graphics()
    .setDepth(-1)
    .fillStyle(0xd3d9b4)
    .fillRect(-SURROUND, -SURROUND, width + 2 * SURROUND, seaTop + SURROUND)
    .fillStyle(PALETTE.sea)
    .fillRect(-SURROUND, seaTop, width + 2 * SURROUND, height - seaTop + SURROUND);
}

/** Pixels per metre in the baked town tiles: sharp in car view, close to it on foot. */
const BAKE_SCALE = 2;
/** Metres per tile (textures just over 1024 pixels, safe on every device). */
const BAKE_TILE = 512;

/**
 * Draws the finished town into a few image tiles once, so the thousands of
 * shapes are not redrawn every frame (which slowed the game on modest devices).
 */
function bake(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, width: number, height: number) {
  g.setScale(BAKE_SCALE);
  for (let y0 = 0; y0 < height; y0 += BAKE_TILE) {
    for (let x0 = 0; x0 < width; x0 += BAKE_TILE) {
      const key = `town-${x0}-${y0}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      // Tiles overlap by a metre so no hairline seam shows between them.
      const left = Math.max(0, x0 - 1);
      const top = Math.max(0, y0 - 1);
      const w = Math.min(x0 + BAKE_TILE + 1, width) - left;
      const h = Math.min(y0 + BAKE_TILE + 1, height) - top;
      const tile = scene.textures.addDynamicTexture(key, w * BAKE_SCALE, h * BAKE_SCALE);
      if (!tile) continue;
      tile.draw(g, -left * BAKE_SCALE, -top * BAKE_SCALE).render();
      scene.add.image(left, top, key).setOrigin(0).setScale(1 / BAKE_SCALE);
    }
  }
  g.destroy();
}

function strokeEdge(g: Phaser.GameObjects.Graphics, graph: TownGraph, e: MapEdge, halfWidth: number, colour: number) {
  const a = graph.node(e.from);
  const b = graph.node(e.to);
  g.lineStyle(halfWidth * 2, colour);
  g.lineBetween(a.x, a.y, b.x, b.y);
  g.fillStyle(colour);
  g.fillCircle(a.x, a.y, halfWidth);
  g.fillCircle(b.x, b.y, halfWidth);
}

function drawRoundabout(g: Phaser.GameObjects.Graphics, graph: TownGraph, pavement: boolean) {
  const ringIds = new Set(graph.map.nodes.map((n) => n.roundaboutId).filter(Boolean));
  for (const id of ringIds) {
    const ring = graph.map.nodes.filter((n) => n.roundaboutId === id);
    const cx = ring.reduce((s, n) => s + n.x, 0) / ring.length;
    const cy = ring.reduce((s, n) => s + n.y, 0) / ring.length;
    const r = Math.hypot((ring[0]?.x ?? cx) - cx, (ring[0]?.y ?? cy) - cy);
    const half = HALF_WIDTH.ROUNDABOUT_RING + (pavement ? PAVEMENT : 0);
    g.lineStyle(half * 2, pavement ? PALETTE.stone : PALETTE.road);
    g.strokeCircle(cx, cy, r);
    if (!pavement) {
      g.fillStyle(PALETTE.stone).fillCircle(cx, cy, r - HALF_WIDTH.ROUNDABOUT_RING);
      g.fillStyle(PALETTE.green).fillCircle(cx, cy, r - HALF_WIDTH.ROUNDABOUT_RING - 3);
      g.fillStyle(0xe8c547).fillCircle(cx, cy, 6);
    }
  }
}

function drawBridge(g: Phaser.GameObjects.Graphics, graph: TownGraph, e: MapEdge) {
  const a = graph.node(e.from);
  const b = graph.node(e.to);
  const half = HALF_WIDTH[e.kind] + (e.car ? PAVEMENT : 0.5);
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  g.fillStyle(0x8c7a68);
  if (horizontal) {
    g.fillRect(Math.min(a.x, b.x), a.y - half - 3, Math.abs(b.x - a.x), 3);
    g.fillRect(Math.min(a.x, b.x), a.y + half, Math.abs(b.x - a.x), 3);
  } else {
    g.fillRect(a.x - half - 3, Math.min(a.y, b.y), 3, Math.abs(b.y - a.y));
    g.fillRect(a.x + half, Math.min(a.y, b.y), 3, Math.abs(b.y - a.y));
  }
}

function drawCentreLine(g: Phaser.GameObjects.Graphics, graph: TownGraph, e: MapEdge) {
  const a = graph.node(e.from);
  const b = graph.node(e.to);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  g.lineStyle(1.5, 0xf4f1e8, 0.9);
  for (let d = 24; d < length - 24; d += 18) {
    g.lineBetween(a.x + ux * d, a.y + uy * d, a.x + ux * (d + 9), a.y + uy * (d + 9));
  }
}

/** Zebra crossings on each road arm of junctions with traffic lights. */
function drawCrossings(g: Phaser.GameObjects.Graphics, graph: TownGraph) {
  g.fillStyle(0xf4f1e8, 0.9);
  for (const node of graph.map.nodes.filter((n) => n.trafficLight)) {
    for (const e of graph.edgesAt(node.id).filter((edge) => CAR_KINDS.includes(edge.kind))) {
      const other = graph.node(graph.other(e, node.id));
      const length = Math.hypot(other.x - node.x, other.y - node.y);
      const ux = (other.x - node.x) / length;
      const uy = (other.y - node.y) / length;
      const half = HALF_WIDTH[e.kind];
      const at = half + 10;
      for (let s = -half + 2; s < half - 1; s += 4) {
        const cx = node.x + ux * at - uy * s;
        const cy = node.y + uy * at + ux * s;
        g.fillRect(cx - 1.5, cy - 1.5, 3, 3);
      }
    }
  }
}

function drawTrafficLight(g: Phaser.GameObjects.Graphics, x: number, y: number) {
  const offset = 16;
  for (const [dx, dy] of [
    [-1, -1],
    [1, 1],
  ] as const) {
    g.fillStyle(0x2b2b2b).fillRoundedRect(x + dx * offset - 3, y + dy * offset - 7, 6, 14, 2);
    g.fillStyle(0xe0463a).fillCircle(x + dx * offset, y + dy * offset - 3, 1.8);
    g.fillStyle(0x4cc26b).fillCircle(x + dx * offset, y + dy * offset + 3, 1.8);
  }
}

const WALL_VARIANTS = [0xf3e2a9, 0xe8d3b5, 0xf1dcc6, 0xe6d8b8, 0xd9c4a3, 0xf0e6d0];

/** A plain town house: pitched terracotta roof, cream walls, and now and then a chimney. */
function drawHouse(g: Phaser.GameObjects.Graphics, r: Rect, i: number) {
  const roof = building(g, r, {
    roof: ROOF_VARIANTS[i % ROOF_VARIANTS.length] as number,
    wall: WALL_VARIANTS[(i * 7) % WALL_VARIANTS.length] as number,
    wallHeight: 5,
    door: r.w > 18,
  });
  if (i % 3 === 0 && roof.w > 14 && roof.h > 12) {
    g.fillStyle(0x7a5546).fillRect(roof.x + roof.w * 0.72, roof.y + 3, 4, 4);
  }
}

/**
 * Trees on open ground: never on a road, path, building or water, so the
 * picture never hides a way the player could take.
 */
function drawTrees(g: Phaser.GameObjects.Graphics, graph: TownGraph) {
  const map = graph.map;
  const rng = Rng.fromSeed(`${map.id}-trees`);
  const blocked = map.regions.filter((r) => r.kind !== 'PLAZA');
  const footprints = [...map.locations.map((l) => l.footprint), ...map.fillers.map((f) => f.footprint)];
  const edges = map.edges.map((e) => ({
    a: graph.node(e.from),
    b: graph.node(e.to),
    clear: HALF_WIDTH[e.kind] + (e.car ? PAVEMENT : 0) + 7,
  }));
  const step = 24;
  for (let y = 20; y < map.height - 20; y += step) {
    for (let x = 20; x < map.width - 20; x += step) {
      const p = { x: x + rng.range(-7, 7), y: y + rng.range(-7, 7) };
      const radius = rng.range(6, 9.5);
      if (rng.next() > 0.4) continue;
      if (blocked.some((r) => pointInPolygon(p, r.points))) continue;
      if (footprints.some((f) => pointInRect(p, { x: f.x - radius, y: f.y - radius, w: f.w + 2 * radius, h: f.h + 2 * radius }))) continue;
      if (edges.some((e) => pointSegmentDistance(p, e.a, e.b) < e.clear + radius * 0.4)) continue;
      tree(g, p.x, p.y, radius, rng.next() < 0.3 ? 0x6fae5a : 0x5f9e4f);
    }
  }
  // Palms along the promenade, on the sand side.
  const promenade = map.edges.filter((e) => e.kind === 'PROMENADE');
  for (const e of promenade) {
    const a = graph.node(e.from);
    const b = graph.node(e.to);
    for (let t = 0.25; t < 1; t += 0.5) {
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + 16;
      if (map.regions.some((r) => r.kind === 'WATER' && pointInPolygon({ x, y }, r.points))) continue;
      palm(g, x, y, 8);
    }
  }
}

function drawRailway(g: Phaser.GameObjects.Graphics, points?: [number, number][]) {
  if (!points) return;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x0, x1, y0] = [Math.min(...xs), Math.max(...xs), Math.min(...ys)];
  for (const ty of [y0 + 20, y0 + 48]) {
    g.lineStyle(2, 0x6d655c);
    for (let x = x0; x < x1; x += 8) g.lineBetween(x, ty - 6, x, ty + 6);
    g.lineStyle(2, 0x4a4540);
    g.lineBetween(x0, ty - 4, x1, ty - 4);
    g.lineBetween(x0, ty + 4, x1, ty + 4);
  }
}

function drawDebugGraph(scene: Phaser.Scene, graph: TownGraph): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0).setDepth(20);
  const g = scene.add.graphics();
  container.add(g);
  for (const e of graph.map.edges) {
    const a = graph.node(e.from);
    const b = graph.node(e.to);
    g.lineStyle(2, e.car ? 0x1f5fff : 0x19a35b, 0.9);
    g.lineBetween(a.x, a.y, b.x, b.y);
    if (e.oneWay) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      g.fillStyle(0x1f5fff).fillTriangle(
        mx + Math.cos(angle) * 6,
        my + Math.sin(angle) * 6,
        mx + Math.cos(angle + 2.5) * 6,
        my + Math.sin(angle + 2.5) * 6,
        mx + Math.cos(angle - 2.5) * 6,
        my + Math.sin(angle - 2.5) * 6,
      );
    }
  }
  const kindColour = { JUNCTION: 0x1f5fff, ROUNDABOUT: 0x9b3fd1, DEAD_END: 0xe0463a, BEND: 0x888888 } as const;
  for (const node of graph.map.nodes) {
    g.fillStyle(kindColour[node.kind]).fillCircle(node.x, node.y, 5);
    container.add(
      scene.add.text(node.x + 6, node.y - 16, node.id, {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '11px',
        color: '#0b1e3a',
        backgroundColor: 'rgba(255,255,255,0.7)',
      }),
    );
  }
  for (const loc of graph.map.locations) {
    g.lineStyle(1.5, 0xff00aa, 0.9).strokeRect(loc.footprint.x, loc.footprint.y, loc.footprint.w, loc.footprint.h);
    for (const entrance of loc.entrances) {
      const p = graph.entrancePoint(entrance);
      g.fillStyle(0xff00aa).fillRect(p.x - 3, p.y - 3, 6, 6);
    }
    container.add(
      scene.add.text(loc.footprint.x + 2, loc.footprint.y + 2, loc.id, {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: '10px',
        color: '#ff00aa',
      }),
    );
  }
  return container;
}
