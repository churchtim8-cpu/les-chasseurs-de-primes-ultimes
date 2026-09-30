import Phaser from 'phaser';
import type { TurnIntent } from '../../engine/movement/turns';

/** Placeholder police car, drawn facing east (heading 0). Sizes in metres. */
export function createPoliceCar(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillRoundedRect(-9 + 1.5, -4.8 + 2, 18, 9.6, 2.5);
  g.fillStyle(0xf7f7f2).fillRoundedRect(-9, -4.8, 18, 9.6, 2.5);
  g.fillStyle(0x1f4e9c).fillRect(-9, -1.4, 18, 2.8); // blue stripe
  g.fillStyle(0x27323a).fillRoundedRect(1.5, -3.8, 3.5, 7.6, 1); // windscreen
  g.fillStyle(0x27323a).fillRoundedRect(-6.5, -3.6, 2.5, 7.2, 1); // rear window
  const lightRed = scene.add.rectangle(-1, -2, 2, 2, 0xe0463a);
  const lightBlue = scene.add.rectangle(-1, 2, 2, 2, 0x2f7de1);
  scene.tweens.add({ targets: [lightRed, lightBlue], alpha: 0.2, duration: 260, yoyo: true, repeat: -1 });
  // Drawn slightly larger than life so the player's car is easy to find on screen.
  return scene.add.container(0, 0, [g, lightRed, lightBlue]).setDepth(30).setScale(1.3);
}

/** Placeholder suspect car, drawn facing east. */
export function createSuspectCar(scene: Phaser.Scene, colour = 0xc0392b): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillRoundedRect(-9 + 1.5, -4.8 + 2, 18, 9.6, 2.5);
  g.fillStyle(colour).fillRoundedRect(-9, -4.8, 18, 9.6, 2.5);
  g.fillStyle(0x27323a).fillRoundedRect(1.5, -3.8, 3.5, 7.6, 1);
  g.fillStyle(0x27323a).fillRoundedRect(-6.5, -3.6, 2.5, 7.2, 1);
  g.lineStyle(1, 0xffffff, 0.5).strokeRoundedRect(-9, -4.8, 18, 9.6, 2.5);
  return scene.add.container(0, 0, [g]).setDepth(29).setScale(1.3);
}

/** Placeholder police officer on foot, seen from above. */
export function createOfficer(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillEllipse(0.8, 1.2, 7, 6);
  g.fillStyle(0x1f4e9c).fillEllipse(0, 0, 5.5, 7); // shoulders
  g.fillStyle(0x16233d).fillCircle(0.4, 0, 2.2); // cap
  g.fillStyle(0xe8c547).fillCircle(1.6, 0, 0.7); // badge on the cap peak
  // Much larger than life: on foot the player should be big and easy to follow.
  return scene.add.container(0, 0, [g]).setDepth(31).setScale(2);
}

/** Small arrow above the player showing the turn they have chosen (input feedback only). */
export function createIntentBadge(scene: Phaser.Scene): {
  container: Phaser.GameObjects.Container;
  show: (intent: TurnIntent | null) => void;
} {
  const g = scene.add.graphics();
  const container = scene.add.container(0, 0, [g]).setDepth(40);
  const show = (intent: TurnIntent | null) => {
    g.clear();
    container.setVisible(intent !== null);
    if (!intent) return;
    g.fillStyle(0x16323d, 0.85).fillCircle(0, 0, 7);
    g.lineStyle(1.6, 0xf6ecd2);
    const angle = intent === 'LEFT' ? Math.PI : intent === 'RIGHT' ? 0 : -Math.PI / 2;
    const tip = { x: Math.cos(angle) * 4, y: Math.sin(angle) * 4 };
    g.lineBetween(-tip.x, -tip.y, tip.x, tip.y);
    g.lineBetween(tip.x, tip.y, tip.x - Math.cos(angle - 0.6) * 3, tip.y - Math.sin(angle - 0.6) * 3);
    g.lineBetween(tip.x, tip.y, tip.x - Math.cos(angle + 0.6) * 3, tip.y - Math.sin(angle + 0.6) * 3);
  };
  show(null);
  return { container, show };
}
