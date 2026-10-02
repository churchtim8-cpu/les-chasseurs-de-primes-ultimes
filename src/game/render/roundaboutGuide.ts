import Phaser from 'phaser';
import { roundaboutAhead, type RoundaboutExit } from '../../engine/language/analysis';
import type { Mover } from '../../engine/movement/mover';
import type { TownGraph } from '../../engine/world/graph';
import { FONT_FAMILY, PALETTE, toCss } from '../palette';

/** How far out along each exit road its number is drawn (metres from the ring). */
const BADGE_OUT = 26;
const MAX_EXITS = 8;

/**
 * Roundabout exits made easy to choose: when the car reaches a roundabout
 * (with no other junction first), every exit gets a number on the map,
 * counted the way the scanner counts them ("la deuxième sortie" = 2).
 * ◀ ▶ (or the touch arrows) move the choice from exit to exit; the car keeps
 * going round and leaves by the chosen one. The numbers stay fixed from the
 * entry, so they still match the French once the car is on the ring.
 */
export class RoundaboutGuide {
  private current: { roundaboutId: string; exits: RoundaboutExit[]; selected: number | null } | null = null;
  private readonly badges: { circle: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }[] = [];

  constructor(
    scene: Phaser.Scene,
    private readonly graph: TownGraph,
    /** Called once each time a roundabout comes up (for a hint). */
    private readonly onArrive: () => void,
  ) {
    for (let i = 0; i < MAX_EXITS; i++) {
      const circle = scene.add.circle(0, 0, 9, PALETTE.cream).setStrokeStyle(2.5, PALETTE.ink).setDepth(45);
      const label = scene.add
        .text(0, 0, String(i + 1), { fontFamily: FONT_FAMILY, fontSize: '26px', fontStyle: 'bold', color: toCss(PALETTE.ink) })
        .setOrigin(0.5)
        .setScale(0.5)
        .setDepth(46);
      this.badges.push({ circle, label });
    }
    this.hide();
  }

  /** World objects, so the scene can keep them off the HUD camera. */
  get objects(): Phaser.GameObjects.GameObject[] {
    return this.badges.flatMap((b) => [b.circle, b.label]);
  }

  /** Turn the exit numbers to stay readable on a turned map. */
  setUpright(rotation: number): void {
    for (const b of this.badges) b.label.setRotation(rotation);
  }

  /** True while a roundabout's exits are on show (◀ ▶ then choose an exit). */
  get active(): boolean {
    return this.current !== null;
  }

  update(player: Mover, enabled: boolean): void {
    const found = enabled ? roundaboutAhead(this.graph, player.location(), player.mode) : null;
    const here = this.graph.edge(player.location().edgeId);
    const onRing = player.mode === 'CAR' && here.kind === 'ROUNDABOUT_RING';
    const same = this.current && (found?.roundaboutId === this.current.roundaboutId || onRing);
    if (!same) {
      this.current = found ? { ...found, selected: null } : null;
      if (this.current) this.onArrive();
    }
    if (!enabled || (!found && !onRing)) this.current = null;
    if (!this.current) {
      this.hide();
      return;
    }
    // Exits behind the car (passed on the ring) are greyed out; the numbers never change.
    const next = found?.exits[0]?.node;
    const nextIndex = next ? this.current.exits.findIndex((e) => e.node === next) : 0;
    const aimed = player.aimedExit;
    if (this.current.selected !== null && !aimed) this.current.selected = null; // taken, or cleared by a U-turn
    const pulse = 1 + 0.12 * Math.sin(performance.now() / 160);
    this.badges.forEach((badge, i) => {
      const exit = this.current?.exits[i];
      badge.circle.setVisible(exit !== undefined);
      badge.label.setVisible(exit !== undefined);
      if (!exit) return;
      const a = this.graph.node(exit.node);
      const b = this.graph.node(exit.to);
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const out = Math.min(BADGE_OUT, d * 0.6);
      const x = a.x + ((b.x - a.x) / d) * out;
      const y = a.y + ((b.y - a.y) / d) * out;
      const chosen = this.current?.selected === exit.number;
      const passed = i < nextIndex && onRing;
      badge.circle
        .setPosition(x, y)
        .setFillStyle(chosen ? PALETTE.terracotta : PALETTE.cream)
        .setScale(chosen ? 1.25 * pulse : 1)
        .setAlpha(passed ? 0.3 : 1);
      badge.label
        .setPosition(x, y)
        .setColor(toCss(chosen ? PALETTE.cream : PALETTE.ink))
        .setScale(chosen ? 0.6 * pulse : 0.5)
        .setAlpha(passed ? 0.3 : 1);
    });
  }

  /**
   * ◀ or ▶ while a roundabout is on show: choose the previous or next exit
   * (the first press of ▶ picks exit 1). Returns false when no roundabout is
   * on show, so the arrow works as a normal turn.
   */
  step(player: Mover, by: 1 | -1, firstAvailable = 1): boolean {
    const current = this.current;
    if (!current) return false;
    const min = Math.max(1, firstAvailable);
    const max = current.exits.length;
    const from = current.selected ?? (by > 0 ? min - 1 : min);
    current.selected = Math.max(min, Math.min(max, from + by));
    const exit = current.exits[current.selected - 1] as RoundaboutExit;
    player.aimExit({ node: exit.node, to: exit.to });
    return true;
  }

  /** The lowest exit number not yet passed. */
  firstAvailable(player: Mover): number {
    if (!this.current) return 1;
    const next = roundaboutAhead(this.graph, player.location(), player.mode)?.exits[0]?.node;
    const i = next ? this.current.exits.findIndex((e) => e.node === next) : 0;
    return Math.max(1, i + 1);
  }

  private hide(): void {
    for (const badge of this.badges) {
      badge.circle.setVisible(false);
      badge.label.setVisible(false);
    }
  }
}
