import Phaser from 'phaser';
import type { Vehicle } from '../../engine/chase/settings';
import type { TurnIntent } from '../../engine/movement/turns';
import { CAR_PICTURES } from './canvaArt';

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

/**
 * Colours the white car picture is tinted with (a tint darkens, so black is a
 * shade lighter than the drawn colour to keep the windows visible).
 */
const PICTURE_TINT: Record<Vehicle, number> = { ...VEHICLE_COLOURS, BLACK: 0x3a3d45, WHITE: 0xffffff };

/**
 * The top-down cartoon car (or van) picture, tinted and sized in metres facing
 * east, over a soft shadow. Empty when the pictures are off (`?look=drawn`).
 */
export function carPicture(
  scene: Phaser.Scene,
  kind: keyof typeof CAR_PICTURES,
  tint: number,
  length: number,
): Phaser.GameObjects.Image[] {
  const key = CAR_PICTURES[kind];
  if (!scene.textures.exists(key)) return [];
  const shadow = scene.add.image(1.4, 1.8, key).setTint(0x000000).setTintMode(Phaser.TintModes.FILL).setAlpha(0.22);
  const body = scene.add.image(0, 0, key).setTint(tint);
  for (const image of [shadow, body]) image.setDisplaySize(length, (length * image.height) / image.width);
  return [shadow, body];
}

/** Cartoon outline colour for people. */
const OUTLINE = 0x1b2230;
const SKIN = [0xe0ac7e, 0x8d5a3b, 0xc68e5e] as const;

/** A suspect on foot, seen from above, into `g`: red hoodie, hood up, face in its shadow. */
export function drawRunner(g: Phaser.GameObjects.Graphics, colour = 0xc0392b): void {
  g.fillStyle(0x000000, 0.25).fillEllipse(0.8, 1.2, 7, 6);
  g.fillStyle(colour).fillEllipse(0, 0, 5.6, 7.4); // shoulders
  g.lineStyle(0.5, OUTLINE, 0.9).strokeEllipse(0, 0, 5.6, 7.4);
  g.fillStyle(0x8e2a20).fillCircle(-0.2, 0, 2.5); // the hood, up
  g.lineStyle(0.45, OUTLINE, 0.9).strokeCircle(-0.2, 0, 2.5);
  g.fillStyle(0x3a1a14).fillEllipse(1.3, 0, 1.6, 2.6); // face in the hood's shadow
  g.lineStyle(0.3, 0xf4f1e8, 0.9).lineBetween(1.9, -0.9, 2.9, -1.1).lineBetween(1.9, 0.9, 2.9, 1.1); // drawstrings
}

/** An arm (sleeve and hand) that swings with the stride; named so `animateRunner` can move it. */
function arm(scene: Phaser.Scene, name: string, y: number, sleeve: number, skin: number): Phaser.GameObjects.Container {
  return scene.add.container(0, y, [
    scene.add.ellipse(0, 0, 2.4, 1.6, sleeve).setStrokeStyle(0.35, OUTLINE, 0.9),
    scene.add.circle(1.3, 0, 0.75, skin).setStrokeStyle(0.3, OUTLINE, 0.9),
  ]).setName(name);
}

function foot(scene: Phaser.Scene, name: string, y: number, colour: number): Phaser.GameObjects.Ellipse {
  return scene.add.ellipse(0, y, 2.7, 1.6, colour).setStrokeStyle(0.3, OUTLINE, 0.9).setName(name);
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
  const picture = carPicture(scene, 'CAR', colours.body, 18);
  const g = scene.add.graphics();
  if (picture.length > 0) {
    // The livery stripe along the roof and the bonnet, and the light bar across the roof.
    g.fillStyle(colours.stripe, 0.95).fillRect(-5.2, -1.2, 6.6, 2.4).fillRect(4.6, -1, 3.4, 2);
    g.fillStyle(0x1b2230).fillRoundedRect(-2.3, -3.2, 1.6, 6.4, 0.5);
  } else {
    g.fillStyle(0x000000, 0.25).fillRoundedRect(-9 + 1.5, -4.8 + 2, 18, 9.6, 2.5);
    g.fillStyle(colours.body).fillRoundedRect(-9, -4.8, 18, 9.6, 2.5);
    g.fillStyle(colours.stripe).fillRect(-9, -1.4, 18, 2.8); // stripe
    g.fillStyle(0x27323a).fillRoundedRect(1.5, -3.8, 3.5, 7.6, 1); // windscreen
    g.fillStyle(0x27323a).fillRoundedRect(-6.5, -3.6, 2.5, 7.2, 1); // rear window
  }
  // Siren: the light bar flashes red and blue, and throws a coloured glow on the road.
  const glowRed = scene.add.circle(-1, -6, 11, 0xe0463a, 0.22);
  const glowBlue = scene.add.circle(-1, 6, 11, 0x2f7de1, 0.22).setAlpha(0);
  const bar = picture.length > 0 ? { x: -1.5, w: 1.2, h: 2.8, y: 1.5 } : { x: -1, w: 2, h: 2, y: 2 };
  const lightRed = scene.add.rectangle(bar.x, -bar.y, bar.w, bar.h, 0xe0463a);
  const lightBlue = scene.add.rectangle(bar.x, bar.y, bar.w, bar.h, 0x2f7de1).setAlpha(0.2);
  scene.tweens.add({ targets: [lightRed, glowRed], alpha: 0.15, duration: 230, yoyo: true, repeat: -1 });
  scene.tweens.add({ targets: [lightBlue, glowBlue], alpha: 1, duration: 230, yoyo: true, repeat: -1 });
  // The same size as every other car; the flashing lights make it easy to find on screen.
  return scene.add.container(0, 0, [glowRed, glowBlue, ...picture, g, lightRed, lightBlue]).setDepth(30).setScale(CAR_SCALE);
}

/** The suspect's vehicle (the one the scanner names), drawn facing east. */
export function createSuspectCar(scene: Phaser.Scene, vehicle: Vehicle): Phaser.GameObjects.Container {
  const picture = carPicture(scene, vehicle === 'VAN' ? 'VAN' : 'CAR', PICTURE_TINT[vehicle], vehicle === 'VAN' ? 22 : 18);
  const g = scene.add.graphics();
  if (picture.length === 0) drawVehicle(g, vehicle);
  // A taxi's sign on the roof.
  else if (vehicle === 'TAXI') g.fillStyle(0x21313a).fillRoundedRect(-2.6, -2, 2.2, 4, 0.5).fillStyle(0xfff4b8).fillRect(-2.1, -1.4, 1.2, 2.8);
  return scene.add.container(0, 0, [...picture, g]).setDepth(29).setScale(CAR_SCALE);
}

/**
 * Placeholder police officer on foot, seen from above. Its feet and arms are
 * separate children (named) so the scene can swing them while running.
 */
export function createOfficer(scene: Phaser.Scene, colours: PoliceColours = CLASSIC_COLOURS): Phaser.GameObjects.Container {
  const uniform = colours.uniform;
  const parts = [
    foot(scene, 'footL', -1.6, 0x111111),
    foot(scene, 'footR', 1.6, 0x111111),
    arm(scene, 'armL', -3.3, uniform, SKIN[0]),
    arm(scene, 'armR', 3.3, uniform, SKIN[0]),
  ];
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillEllipse(0.8, 1.2, 7, 6);
  g.fillStyle(uniform).fillEllipse(0, 0, 5.6, 7.4); // shoulders
  g.lineStyle(0.5, OUTLINE, 0.9).strokeEllipse(0, 0, 5.6, 7.4);
  g.fillStyle(0xe8c547).fillRoundedRect(-1.2, -3.5, 2.2, 0.9, 0.3).fillRoundedRect(-1.2, 2.6, 2.2, 0.9, 0.3); // epaulettes
  g.fillStyle(0x1a1a1a).fillRoundedRect(0.4, -3.0, 1.1, 1.3, 0.3); // radio on the shoulder
  g.fillStyle(0x0f1a30).fillEllipse(1.9, 0, 1.7, 3.4); // cap peak
  g.fillStyle(0x16233d).fillCircle(0.2, 0, 2.3); // cap
  g.lineStyle(0.45, OUTLINE, 0.9).strokeCircle(0.2, 0, 2.3);
  g.fillStyle(0x24365a).fillCircle(-0.1, -0.3, 1.3); // light on the crown
  g.fillStyle(0xe8c547).fillCircle(1.7, 0, 0.6); // badge on the cap peak
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
  const part = (name: string) => runner.getByName(name) as unknown as Phaser.GameObjects.Components.Transform | null;
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
    foot(scene, 'footL', -1.6, 0xf4f1e8),
    foot(scene, 'footR', 1.6, 0xf4f1e8),
    arm(scene, 'armL', -3.3, 0xc0392b, SKIN[2]),
    arm(scene, 'armR', 3.3, 0xc0392b, SKIN[2]),
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
