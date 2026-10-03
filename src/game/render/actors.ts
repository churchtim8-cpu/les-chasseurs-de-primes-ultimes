import Phaser from 'phaser';
import type { Vehicle } from '../../engine/chase/settings';
import type { TurnIntent } from '../../engine/movement/turns';

/** Body colours of the suspect's possible vehicles (they must match the French: "une voiture verte"). */
export const VEHICLE_COLOURS: Record<Vehicle, number> = {
  BLUE: 0x2f6fd6,
  BLACK: 0x1d1f22,
  WHITE: 0xf4f4f0,
  GREEN: 0x2e9e5b,
  TAXI: 0xf2c230,
  VAN: 0x9aa3ab,
};

/**
 * Every car in town (police, suspect, traffic) is drawn at this scale, so they are all the
 * same size and each fits in one lane of a two-way road.
 */
export const CAR_SCALE = 1.1;

/** Draws a vehicle facing east (heading 0) into `g`, in metres. */
export function drawVehicle(g: Phaser.GameObjects.Graphics, vehicle: Vehicle): void {
  const colour = VEHICLE_COLOURS[vehicle];
  const [w, h] = vehicle === 'VAN' ? [22, 10.4] : [18, 9.6];
  g.fillStyle(0x000000, 0.25).fillRoundedRect(-w / 2 + 1.5, -h / 2 + 2, w, h, 2.5);
  g.fillStyle(colour).fillRoundedRect(-w / 2, -h / 2, w, h, 2.5);
  if (vehicle === 'VAN') {
    g.fillStyle(0x27323a).fillRoundedRect(w / 2 - 5, -h / 2 + 1, 3, h - 2, 1); // windscreen
    g.fillStyle(0xffffff, 0.25).fillRect(-w / 2 + 2, -h / 2 + 1.5, w - 9, h - 3); // box
  } else {
    g.fillStyle(0x27323a).fillRoundedRect(1.5, -3.8, 3.5, 7.6, 1);
    g.fillStyle(0x27323a).fillRoundedRect(-6.5, -3.6, 2.5, 7.2, 1);
  }
  if (vehicle === 'TAXI') g.fillStyle(0x21313a).fillRect(-2.6, -2.2, 3, 4.4); // roof sign
  g.lineStyle(1, vehicle === 'WHITE' ? 0x21313a : 0xffffff, 0.6).strokeRoundedRect(-w / 2, -h / 2, w, h, 2.5);
}

/** A suspect on foot, seen from above, into `g`. */
export function drawRunner(g: Phaser.GameObjects.Graphics, colour = 0xc0392b): void {
  g.fillStyle(0x000000, 0.25).fillEllipse(0.8, 1.2, 7, 6);
  g.fillStyle(colour).fillEllipse(0, 0, 5.5, 7); // shoulders
  g.fillStyle(0x2a1d17).fillCircle(0.3, 0, 2.1); // head
  g.lineStyle(0.6, 0xffffff, 0.6).strokeEllipse(0, 0, 5.5, 7);
}

/** Police car and uniform colours (the campaign's unlockable liveries). */
export interface PoliceColours {
  body: number;
  stripe: number;
  uniform: number;
}

export const CLASSIC_COLOURS: PoliceColours = { body: 0xf7f7f2, stripe: 0x1f4e9c, uniform: 0x1f4e9c };

/** Placeholder police car, drawn facing east (heading 0). Sizes in metres. */
export function createPoliceCar(scene: Phaser.Scene, colours: PoliceColours = CLASSIC_COLOURS): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillRoundedRect(-9 + 1.5, -4.8 + 2, 18, 9.6, 2.5);
  g.fillStyle(colours.body).fillRoundedRect(-9, -4.8, 18, 9.6, 2.5);
  g.fillStyle(colours.stripe).fillRect(-9, -1.4, 18, 2.8); // stripe
  g.fillStyle(0x27323a).fillRoundedRect(1.5, -3.8, 3.5, 7.6, 1); // windscreen
  g.fillStyle(0x27323a).fillRoundedRect(-6.5, -3.6, 2.5, 7.2, 1); // rear window
  // Siren: the light bar flashes red and blue, and throws a coloured glow on the road.
  const glowRed = scene.add.circle(-1, -6, 11, 0xe0463a, 0.22);
  const glowBlue = scene.add.circle(-1, 6, 11, 0x2f7de1, 0.22).setAlpha(0);
  const lightRed = scene.add.rectangle(-1, -2, 2, 2, 0xe0463a);
  const lightBlue = scene.add.rectangle(-1, 2, 2, 2, 0x2f7de1).setAlpha(0.2);
  scene.tweens.add({ targets: [lightRed, glowRed], alpha: 0.15, duration: 230, yoyo: true, repeat: -1 });
  scene.tweens.add({ targets: [lightBlue, glowBlue], alpha: 1, duration: 230, yoyo: true, repeat: -1 });
  // The same size as every other car; the flashing lights make it easy to find on screen.
  return scene.add.container(0, 0, [glowRed, glowBlue, g, lightRed, lightBlue]).setDepth(30).setScale(CAR_SCALE);
}

/** The suspect's vehicle (the one the scanner names), drawn facing east. */
export function createSuspectCar(scene: Phaser.Scene, vehicle: Vehicle): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  drawVehicle(g, vehicle);
  return scene.add.container(0, 0, [g]).setDepth(29).setScale(CAR_SCALE);
}

/**
 * Placeholder police officer on foot, seen from above. Its feet and arms are
 * separate children (named) so the scene can swing them while running.
 */
export function createOfficer(scene: Phaser.Scene, colours: PoliceColours = CLASSIC_COLOURS): Phaser.GameObjects.Container {
  const uniform = colours.uniform;
  const parts = [
    scene.add.ellipse(0, -1.6, 2.6, 1.6, 0x16233d).setName('footL'),
    scene.add.ellipse(0, 1.6, 2.6, 1.6, 0x16233d).setName('footR'),
    scene.add.ellipse(0, -3.2, 2.2, 1.4, uniform).setName('armL'),
    scene.add.ellipse(0, 3.2, 2.2, 1.4, uniform).setName('armR'),
  ];
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillEllipse(0.8, 1.2, 7, 6);
  g.fillStyle(uniform).fillEllipse(0, 0, 5.5, 7); // shoulders
  g.fillStyle(0x16233d).fillCircle(0.4, 0, 2.2); // cap
  g.fillStyle(0xe8c547).fillCircle(1.6, 0, 0.7); // badge on the cap peak
  // About the size of the people walking in town (a car is three times as long); a soft
  // ring underneath keeps the player easy to find.
  const ring = scene.add.circle(0, 0, 6.5, 0xffffff, 0.22).setStrokeStyle(0.8, uniform, 0.8).setName('ring');
  return scene.add.container(0, 0, [ring, ...parts, g]).setDepth(31).setScale(OFFICER_SCALE);
}

/** On-foot figures are drawn at this scale (shapes are in metres). */
const OFFICER_SCALE = 0.95;

/**
 * Running: long strides, arms pumping against the legs, and a bounce with
 * every step. `stride` advances with distance run (radians).
 */
export function animateRunner(runner: Phaser.GameObjects.Container, stride: number, moving: boolean): void {
  const swing = moving ? Math.sin(stride) * 3.4 : 0;
  const part = (name: string) => runner.getByName(name) as Phaser.GameObjects.Ellipse | null;
  part('footL')?.setX(swing);
  part('footR')?.setX(-swing);
  part('armL')?.setX(-swing * 0.8);
  part('armR')?.setX(swing * 0.8);
  const bounce = moving ? Math.abs(Math.sin(stride)) * 0.08 : 0;
  runner.setScale(OFFICER_SCALE * (1 + bounce));
  part('ring')?.setScale(1 - bounce);
}

/**
 * The suspect on foot: built like the officer (legs, pumping arms) so both
 * run the same way, in a red hoodie with no cap.
 */
export function createSuspectRunner(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const parts = [
    scene.add.ellipse(0, -1.6, 2.6, 1.6, 0x2a2a2a).setName('footL'),
    scene.add.ellipse(0, 1.6, 2.6, 1.6, 0x2a2a2a).setName('footR'),
    scene.add.ellipse(0, -3.2, 2.2, 1.4, 0xc0392b).setName('armL'),
    scene.add.ellipse(0, 3.2, 2.2, 1.4, 0xc0392b).setName('armR'),
  ];
  const g = scene.add.graphics();
  drawRunner(g);
  return scene.add.container(0, 0, [...parts, g]).setDepth(29).setScale(OFFICER_SCALE);
}

/**
 * Small arrow above the player showing the turn they have chosen (input feedback only).
 * Turns are the driver's left and right ("à gauche", "à droite"), so the arrow turns
 * with the player: it points the way they will actually go, whichever way they face.
 */
export function createIntentBadge(scene: Phaser.Scene): {
  container: Phaser.GameObjects.Container;
  show: (intent: TurnIntent | null, heading: number) => void;
} {
  const g = scene.add.graphics();
  const container = scene.add.container(0, 0, [g]).setDepth(40);
  const show = (intent: TurnIntent | null, heading: number) => {
    g.clear();
    container.setVisible(intent !== null);
    if (!intent) return;
    // Drawn with "ahead" pointing up, then turned to face the way the player faces.
    g.setRotation(heading + Math.PI / 2);
    g.fillStyle(0x16323d, 0.85).fillCircle(0, 0, 7);
    g.lineStyle(1.6, 0xf6ecd2);
    const angle = intent === 'LEFT' ? Math.PI : intent === 'RIGHT' ? 0 : -Math.PI / 2;
    const tip = { x: Math.cos(angle) * 4, y: Math.sin(angle) * 4 };
    g.lineBetween(-tip.x, -tip.y, tip.x, tip.y);
    g.lineBetween(tip.x, tip.y, tip.x - Math.cos(angle - 0.6) * 3, tip.y - Math.sin(angle - 0.6) * 3);
    g.lineBetween(tip.x, tip.y, tip.x - Math.cos(angle + 0.6) * 3, tip.y - Math.sin(angle + 0.6) * 3);
  };
  show(null, 0);
  return { container, show };
}
