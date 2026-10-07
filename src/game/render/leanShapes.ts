import Phaser from 'phaser';

/**
 * Lighter circles for modest devices (Mr Henry, 2026-10-07: "optimize the
 * game so that it can run on weaker devices smoothly"). Phaser draws every
 * circle shape with 100 edges, whatever its size: the 90 tyre-smoke puffs
 * alone sent about 30,000 corners to the graphics card every frame. A
 * circle now gets edges in proportion to its size, still round on screen.
 */
export const CIRCLE_EDGES = { min: 12, max: 48, perUnit: 1.2, base: 10 } as const;

export function circleEdges(radius: number): number {
  const edges = Math.round(CIRCLE_EDGES.base + Math.abs(radius) * CIRCLE_EDGES.perUnit);
  return Math.min(CIRCLE_EDGES.max, Math.max(CIRCLE_EDGES.min, edges));
}

let installed = false;

/** Makes `scene.add.circle` and `scene.add.arc` use `circleEdges`. Call once, before the game starts. */
export function installLeanShapes(): void {
  if (installed) return;
  installed = true;
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as Record<string, (...args: unknown[]) => Phaser.GameObjects.Arc>;
  for (const name of ['circle', 'arc']) {
    const make = factory[name];
    if (typeof make !== 'function') continue;
    factory[name] = function (this: unknown, ...args: unknown[]) {
      const shape = make.apply(this, args);
      const radius = typeof args[2] === 'number' ? args[2] : 128;
      shape.setIterations?.(1 / circleEdges(radius));
      return shape;
    };
  }
}
