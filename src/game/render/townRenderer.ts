import Phaser from 'phaser';
import { LOCATION_WORD_BY_ID, withArticle } from '../../engine/language/locations';
import { HALF_WIDTH, PAVEMENT } from '../../engine/world/geometry';
import type { TownGraph } from '../../engine/world/graph';
import type { District, EdgeKind, MapEdge, Rect, RegionKind } from '../../engine/world/types';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';

/**
 * Draws Bellevue City from the map data. Roads, paths, the bridge and the
 * roundabout are generated from the navigation graph, so the picture can never
 * disagree with the routes. Later art passes replace building blocks with
 * sprites placed on the same footprints.
 */

const REGION_COLOUR: Record<RegionKind, number> = {
  SEA: PALETTE.sea,
  SAND: PALETTE.sand,
  WATER: 0x3b9fb3,
  PARK: PALETTE.green,
  PLAZA: PALETTE.stone,
  RAILWAY: 0xb9aea0,
};

const DISTRICT_ROOF: Record<District, number> = {
  TOWN_CENTRE: PALETTE.terracotta,
  COMMERCIAL: 0xd9895b,
  CIVIC: 0x6f8fa6,
  TRANSPORT: 0x7d7a8c,
  COASTAL: 0x4f9a8c,
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
  const g = scene.add.graphics();

  // Ground, regions.
  g.fillStyle(0xe9e2cf).fillRect(0, 0, map.width, map.height);
  for (const region of map.regions) {
    g.fillStyle(REGION_COLOUR[region.kind]);
    g.fillPoints(region.points.map(([x, y]) => new Phaser.Math.Vector2(x, y)), true);
  }
  drawRailway(g, map.regions.find((r) => r.kind === 'RAILWAY')?.points);
  drawWaves(g, map.width, map.regions.find((r) => r.id === 'sea')?.points);

  const carEdges = map.edges.filter((e) => e.car);
  const footEdges = map.edges.filter((e) => !e.car);

  // Footpaths first (under roads where they meet).
  for (const e of footEdges) strokeEdge(g, graph, e, HALF_WIDTH[e.kind], e.kind === 'PATH' ? 0xd8c9a3 : 0xcdb994);

  // Pavements, then asphalt, drawn as thick strokes with round joints at nodes.
  for (const e of carEdges) strokeEdge(g, graph, e, HALF_WIDTH[e.kind] + PAVEMENT, PALETTE.stone);
  drawRoundabout(g, graph, true);
  for (const e of carEdges) strokeEdge(g, graph, e, HALF_WIDTH[e.kind], PALETTE.road);
  drawRoundabout(g, graph, false);
  for (const e of carEdges) if (e.bridge) drawBridge(g, graph, e);
  for (const e of carEdges) if (e.kind === 'AVENUE' && !e.bridge) drawCentreLine(g, graph, e);
  drawCrossings(g, graph);
  for (const node of map.nodes.filter((n) => n.trafficLight)) drawTrafficLight(g, node.x, node.y);

  // Buildings: plain fillers then vocabulary locations.
  map.fillers.forEach((f, i) => drawBuilding(g, f.footprint, ROOF_VARIANTS[i % ROOF_VARIANTS.length] as number, 0.85));
  for (const loc of map.locations) {
    if (loc.open) continue;
    drawBuilding(g, loc.footprint, DISTRICT_ROOF[loc.district], 1);
  }

  // French labels for every location.
  const labels = map.locations.map((loc) => {
    const word = LOCATION_WORD_BY_ID.get(loc.id);
    const { x, y, w, h } = loc.footprint;
    const text = scene.add
      .text(x + w / 2, y + h / 2, word ? withArticle(word) : loc.id, {
        fontFamily: FONT_FAMILY,
        fontSize: '15px',
        fontStyle: 'bold',
        color: toCss(PALETTE.ink),
        backgroundColor: 'rgba(246, 236, 210, 0.88)',
        padding: { x: 5, y: 2 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(10);
    return { text, width: w };
  });

  return { labels, debug: drawDebugGraph(scene, graph) };
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
  const half = HALF_WIDTH[e.kind] + PAVEMENT;
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

/** A building seen from slightly south: front wall, then roof. */
function drawBuilding(g: Phaser.GameObjects.Graphics, r: Rect, roof: number, alpha: number) {
  const wall = Phaser.Display.Color.IntegerToColor(roof).darken(35).color;
  g.fillStyle(0x000000, 0.12).fillRect(r.x + 4, r.y + 6, r.w, r.h);
  g.fillStyle(wall, alpha).fillRect(r.x, r.y + 5, r.w, r.h - 5);
  g.fillStyle(roof, alpha).fillRect(r.x, r.y, r.w, r.h - 7);
  g.lineStyle(1, 0xffffff, 0.25).strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 11);
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

function drawWaves(g: Phaser.GameObjects.Graphics, width: number, points?: [number, number][]) {
  if (!points) return;
  const top = Math.min(...points.map((p) => p[1]));
  g.lineStyle(2, PALETTE.lightBlue, 0.7);
  for (let row = 0; row < 3; row++) {
    for (let x = (row % 2) * 40; x < width; x += 80) {
      g.beginPath();
      g.arc(x + 40, top + 25 + row * 28, 14, Math.PI * 1.15, Math.PI * 1.85);
      g.strokePath();
    }
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
