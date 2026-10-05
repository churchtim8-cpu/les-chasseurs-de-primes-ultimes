import Phaser from 'phaser';
import type { LiveryPattern } from '../../engine/campaign/cosmetics';
import type { Vehicle } from '../../engine/chase/settings';
import type { TurnIntent } from '../../engine/movement/turns';
import { CAR_PICTURES } from './canvaArt';
import { carLights } from './night';

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

/** The fugitive's looks (the garage's FUGITIVE slot): top and hood colours, or a cap or mask instead of a hood. */
export const FUGITIVE_LOOKS: Record<string, { top: number; hood: number; head: 'HOOD' | 'CAP' | 'MASK' }> = {
  ROUGE: { top: 0xc0392b, hood: 0x8e2a20, head: 'HOOD' },
  NOIR: { top: 0x23262d, hood: 0x111318, head: 'HOOD' },
  VERT: { top: 0x2e9e5b, hood: 0x1f6e40, head: 'HOOD' },
  CASQUETTE: { top: 0xf2c230, hood: 0x21313a, head: 'CAP' },
  MASQUE: { top: 0x7b2fbe, hood: 0xf2c230, head: 'MASK' },
};

/** A suspect on foot, seen from above, into `g`: a hoodie with the hood up, face in its shadow (or the fugitive's chosen look). */
export function drawRunner(g: Phaser.GameObjects.Graphics, outfit = 'ROUGE'): void {
  const look = FUGITIVE_LOOKS[outfit] ?? FUGITIVE_LOOKS.ROUGE!;
  g.fillStyle(0x000000, 0.25).fillEllipse(0.8, 1.2, 7, 6);
  g.fillStyle(look.top).fillEllipse(0, 0, 5.6, 7.4); // shoulders
  g.lineStyle(0.5, OUTLINE, 0.9).strokeEllipse(0, 0, 5.6, 7.4);
  if (look.head === 'CAP') {
    // Hair, a cap worn backwards (its peak behind), sunglasses in front.
    g.fillStyle(0x2a1d17).fillCircle(-0.2, 0, 2.4);
    g.fillStyle(look.hood).fillCircle(-0.4, 0, 2.1).fillEllipse(-2.4, 0, 1.6, 3);
    g.lineStyle(0.45, OUTLINE, 0.9).strokeCircle(-0.4, 0, 2.1);
    g.fillStyle(0x111111).fillRoundedRect(1.6, -1.6, 0.7, 1.3, 0.3).fillRoundedRect(1.6, 0.3, 0.7, 1.3, 0.3);
  } else if (look.head === 'MASK') {
    // A Carnival mask with feathers, over dark hair.
    g.fillStyle(0x2a1d17).fillCircle(-0.2, 0, 2.4);
    [0xff4fa3, 0x2ed3a0, 0x29b6ff].forEach((colour, i) => g.fillStyle(colour).fillEllipse(-2.6, (i - 1) * 1.4, 2.6, 1));
    g.fillStyle(look.hood).fillEllipse(1.2, 0, 1.8, 3.6);
    g.fillStyle(0x111111).fillCircle(1.3, -0.9, 0.35).fillCircle(1.3, 0.9, 0.35);
    g.lineStyle(0.45, OUTLINE, 0.9).strokeEllipse(1.2, 0, 1.8, 3.6);
  } else {
    g.fillStyle(look.hood).fillCircle(-0.2, 0, 2.5); // the hood, up
    g.lineStyle(0.45, OUTLINE, 0.9).strokeCircle(-0.2, 0, 2.5);
    g.fillStyle(0x3a1a14).fillEllipse(1.3, 0, 1.6, 2.6); // face in the hood's shadow
    g.lineStyle(0.3, 0xf4f1e8, 0.9).lineBetween(1.9, -0.9, 2.9, -1.1).lineBetween(1.9, 0.9, 2.9, 1.1); // drawstrings
  }
  if (outfit === 'VERT') g.lineStyle(0.4, 0xffffff, 0.9).lineBetween(-2.2, -2.2, 2.2, -2.2).lineBetween(-2.2, 2.2, 2.2, 2.2); // tracksuit stripes
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

/** Police car and uniform colours (the garage's liveries); `pattern` is drawn over the body. */
export interface PoliceColours {
  body: number;
  stripe: number;
  uniform: number;
  pattern?: LiveryPattern;
}

export const CLASSIC_COLOURS: PoliceColours = { body: 0xf7f7f2, stripe: 0x1f4e9c, uniform: 0x1f4e9c };

/**
 * The player's police vehicle, facing east (heading 0), sizes in metres. Every
 * car is drawn the same size as the others in town (the motorbike smaller),
 * so the garage never breaks the town's proportions.
 */
export function createPoliceCar(scene: Phaser.Scene, colours: PoliceColours = CLASSIC_COLOURS, vehicle = 'BERLINE'): Phaser.GameObjects.Container {
  if (vehicle === 'MOTO') return createPoliceBike(scene, colours);
  if (vehicle === 'VELO') return createPoliceBicycle(scene, colours);
  const undercover = vehicle === 'BANALISEE';
  const vintage = vehicle === 'VINTAGE';
  const suv = vehicle === 'GENDARMERIE';
  const van = vehicle === 'FOURGON';
  const pickup = vehicle === 'PICKUP';
  const sports = vehicle === 'SPORTIVE';
  const body = undercover ? 0x2a2d33 : colours.body;
  // The van is the same length as the suspect's van; every other vehicle is a car's length.
  const length = van ? 22 : 18;
  const picture = carPicture(scene, van ? 'VAN' : 'CAR', body, length);
  // The 4x4 is a little wider; the same length as a car.
  if (suv) for (const image of picture) image.setDisplaySize(18.4, image.displayHeight * 1.14);
  const g = scene.add.graphics();
  const extras: Phaser.GameObjects.GameObject[] = [];
  if (picture.length > 0) {
    if (!undercover) drawPattern(g, colours);
    if (van) {
      // A wide stripe along the box, the word POLICE in white blocks, and a light bar up front.
      g.fillStyle(colours.stripe, 0.95).fillRect(-9.5, -1.4, 14, 2.8);
      g.fillStyle(0xffffff, 0.9);
      for (let i = 0; i < 6; i++) g.fillRect(-8 + i * 2.2, -0.6, 1.4, 1.2);
      g.lineStyle(0.5, 0x1b2230, 0.5).strokeRect(-9.8, -4.2, 15, 8.4);
    } else if (pickup) {
      // An open load bed behind the cab: a dark tray with ribs, a roll bar and a spare wheel.
      g.fillStyle(0x3a3f47).fillRoundedRect(-8.6, -3.6, 7.4, 7.2, 0.8);
      g.lineStyle(0.35, 0x5a606a, 0.9);
      for (let i = 0; i < 4; i++) g.lineBetween(-8 + i * 1.8, -3.2, -8 + i * 1.8, 3.2);
      g.fillStyle(0x1b1b1b).fillCircle(-6.6, 0, 1.5).fillStyle(0x8c8c8c).fillCircle(-6.6, 0, 0.6);
      g.fillStyle(0xd9dde2).fillRect(-1.4, -4.2, 0.9, 8.4); // roll bar
      g.fillStyle(colours.stripe, 0.95).fillRect(-0.2, -1.1, 4.4, 2.2).fillRect(4.6, -1, 3.4, 2);
    } else if (sports) {
      // Low and mean: twin racing stripes over the bonnet, a bonnet scoop and a rear spoiler.
      g.fillStyle(colours.stripe, 0.95).fillRect(-6.5, -1.7, 15, 1).fillRect(-6.5, 0.7, 15, 1);
      g.fillStyle(0x1b2230).fillRoundedRect(4.2, -1.2, 2.6, 2.4, 0.4); // scoop
      g.fillStyle(0x1b2230).fillRoundedRect(-9.6, -4.4, 1.3, 8.8, 0.4); // spoiler
      g.fillStyle(colours.stripe).fillRect(-9.4, -4.2, 0.9, 1.2).fillRect(-9.4, 3, 0.9, 1.2);
    } else if (vehicle === 'PRESTIGE') {
      // Twin gold stripes, gold trim and a glint on the roof.
      g.fillStyle(0xf0c53c).fillRect(-5.2, -1.9, 6.6, 1).fillRect(-5.2, 0.9, 6.6, 1).fillRect(4.6, -1.6, 3.4, 0.8).fillRect(4.6, 0.8, 3.4, 0.8);
      g.lineStyle(0.5, 0xf0c53c, 0.9).strokeRoundedRect(-8.6, -3.9, 17.2, 7.8, 2.4);
      const sparkle = scene.add.star(2.5, -2.4, 4, 0.3, 1.2, 0xffffff).setAlpha(0);
      scene.tweens.add({ targets: sparkle, alpha: 1, scale: 1.4, duration: 500, yoyo: true, repeat: -1, repeatDelay: 1100 });
      extras.push(sparkle);
    } else if (!undercover && !vintage) {
      // The livery stripe along the roof and the bonnet.
      g.fillStyle(colours.stripe, 0.95).fillRect(-5.2, -1.2, 6.6, 2.4).fillRect(4.6, -1, 3.4, 2);
    }
    if (vintage) {
      // Chrome bumpers and a stripe down each side.
      g.fillStyle(0xd9dde2).fillRoundedRect(8.2, -3.4, 1.2, 6.8, 0.5).fillRoundedRect(-9.4, -3.4, 1.2, 6.8, 0.5);
      g.fillStyle(colours.stripe, 0.95).fillRect(-7.5, -3.9, 15, 0.9).fillRect(-7.5, 3, 15, 0.9);
    }
    if (suv) g.lineStyle(0.6, 0x1b2230, 0.8).lineBetween(-5.5, -2.6, 1.5, -2.6).lineBetween(-5.5, 2.6, 1.5, 2.6); // roof rails
    const barX = van ? 3.2 : pickup ? 1.2 : sports ? -0.8 : -2.3;
    if (!undercover && !vintage) g.fillStyle(0x1b2230).fillRoundedRect(barX, suv ? -3.8 : -3.2, sports ? 1.1 : 1.6, suv ? 7.6 : 6.4, 0.5); // light bar
  } else {
    g.fillStyle(0x000000, 0.25).fillRoundedRect(-9 + 1.5, -4.8 + 2, 18, 9.6, 2.5);
    g.fillStyle(body).fillRoundedRect(-9, -4.8, 18, 9.6, 2.5);
    if (!undercover) g.fillStyle(colours.stripe).fillRect(-9, -1.4, 18, 2.8); // stripe
    g.fillStyle(0x27323a).fillRoundedRect(1.5, -3.8, 3.5, 7.6, 1); // windscreen
    g.fillStyle(0x27323a).fillRoundedRect(-6.5, -3.6, 2.5, 7.2, 1); // rear window
  }
  // Siren: the lights flash red and blue, and throw a coloured glow on the road.
  // The undercover car hides small ones in its grille; the classic has one blue dome on the roof.
  const glowSize = undercover ? 7 : 11;
  const glowAt = undercover ? 8.5 : -1;
  const glowRed = scene.add.circle(glowAt, -6, glowSize, vintage ? 0x2f7de1 : 0xe0463a, 0.22);
  const glowBlue = scene.add.circle(glowAt, 6, glowSize, 0x2f7de1, 0.22).setAlpha(0);
  let bar = picture.length > 0 ? { x: -1.5, w: 1.2, h: 2.8, y: 1.5 } : { x: -1, w: 2, h: 2, y: 2 };
  if (undercover) bar = { x: 8.4, w: 0.7, h: 0.9, y: 2.2 };
  if (suv) bar = { x: -1.5, w: 1.2, h: 3.4, y: 1.9 };
  if (van) bar = { x: 4, w: 1.2, h: 2.8, y: 1.5 };
  if (pickup) bar = { x: 2, w: 1.2, h: 2.8, y: 1.5 };
  if (sports) bar = { x: -0.25, w: 0.9, h: 2.8, y: 1.5 };
  const lightRed = vintage ? scene.add.circle(-1.5, 0, 1.3, 0x2f7de1) : scene.add.rectangle(bar.x, -bar.y, bar.w, bar.h, 0xe0463a);
  const lightBlue = vintage ? scene.add.circle(-1.5, 0, 0.6, 0xbfe0ff).setAlpha(0.2) : scene.add.rectangle(bar.x, bar.y, bar.w, bar.h, 0x2f7de1).setAlpha(0.2);
  scene.tweens.add({ targets: [lightRed, glowRed], alpha: 0.15, duration: 230, yoyo: true, repeat: -1 });
  scene.tweens.add({ targets: [lightBlue, glowBlue], alpha: 1, duration: 230, yoyo: true, repeat: -1 });
  const parts = [glowRed, glowBlue, ...picture, g, ...extras, lightRed, lightBlue, ...carLights(scene, length)];
  return scene.add.container(0, 0, parts).setDepth(30).setScale(CAR_SCALE);
}

/** The livery's pattern over a car body (roof and bonnet), sizes in metres. */
function drawPattern(g: Phaser.GameObjects.Graphics, colours: PoliceColours): void {
  switch (colours.pattern) {
    case 'FLAG':
      // A white-edged black band across, corner to corner.
      g.fillStyle(0xffffff).fillPoints([v(-6.5, 3.4), v(-3.6, 3.4), v(5.6, -3.4), v(2.7, -3.4)], true);
      g.fillStyle(0x111111).fillPoints([v(-5.9, 3.4), v(-4.2, 3.4), v(5, -3.4), v(3.3, -3.4)], true);
      break;
    case 'CARNIVAL': {
      // Sequins in mas colours and a golden swoosh.
      const sequins = [0xf2c230, 0x2ed3a0, 0xff4fa3, 0x29b6ff];
      for (let i = 0; i < 18; i++) {
        const x = -6.5 + ((i * 37) % 130) / 10;
        const y = -2.8 + ((i * 53) % 56) / 10;
        g.fillStyle(sequins[i % 4]!).fillCircle(x, y, 0.45);
      }
      g.lineStyle(0.9, 0xf2c230, 0.95).beginPath().arc(-1, 6, 7.5, -2.3, -0.8).strokePath();
      break;
    }
    case 'NEON':
      g.lineStyle(0.6, 0x29f0ff, 1).lineBetween(-7.5, -3.3, 7.5, -3.3).lineBetween(-7.5, 3.3, 7.5, 3.3);
      g.lineStyle(0.4, 0xff3fd0, 1).lineBetween(-7.5, -2.6, 7.5, -2.6).lineBetween(-7.5, 2.6, 7.5, 2.6);
      break;
    case 'CAMO':
      g.fillStyle(0x3d4626, 0.9).fillEllipse(-4.5, -1.5, 3.6, 2.2).fillEllipse(3.5, 1.8, 3, 2).fillEllipse(6, -2, 2, 1.4);
      g.fillStyle(0x8a8656, 0.9).fillEllipse(-1, 1.9, 3, 1.8).fillEllipse(-6.5, 2, 1.8, 1.2).fillEllipse(1.5, -2.2, 2.4, 1.4);
      break;
    case 'WAVES':
      // Two white rollers curling along each side of the body.
      g.lineStyle(0.7, 0xffffff, 0.9);
      for (const y of [-2.6, 2.6]) {
        g.beginPath();
        for (let x = -7.5; x <= 7.5; x += 0.5) {
          const yy = y + Math.sin((x + 7.5) * 1.3) * 0.6;
          if (x === -7.5) g.moveTo(x, yy);
          else g.lineTo(x, yy);
        }
        g.strokePath();
      }
      break;
    case 'FLOWERS': {
      // Hibiscus blooms: five petals round a gold heart.
      const blooms: [number, number, number][] = [[-5, -2, 0xffffff], [-1.5, 2.3, 0xfff1d6], [2.5, -2.4, 0xffffff], [6, 1.8, 0xfff1d6]];
      for (const [x, y, colour] of blooms) {
        g.fillStyle(colour, 0.95);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.fillEllipse(x + Math.cos(a) * 0.8, y + Math.sin(a) * 0.8, 1.1, 0.8);
        }
        g.fillStyle(0xf2c230).fillCircle(x, y, 0.4);
      }
      g.fillStyle(0x2e9e5b, 0.9).fillEllipse(-3.4, 0.6, 1.4, 0.7).fillEllipse(4.4, 0.2, 1.4, 0.7);
      break;
    }
    case 'CHECK': {
      // A chequered band across the middle, like a finish flag.
      for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) {
        if ((i + j) % 2 === 0) g.fillStyle(0x111111, 0.95).fillRect(-6.6 + i * 1.1, -1.65 + j * 1.1, 1.1, 1.1);
      }
      break;
    }
    case 'STARS': {
      // Gold stars scattered over a night-blue body, one big one on the roof.
      const pts = [[-6, -2.4], [-4, 2.2], [-1.5, -1.6], [1, 2.6], [3.5, -2.6], [6, 1.6], [7.2, -1.2]];
      for (const [x, y] of pts as [number, number][]) g.fillStyle(0xf2c230).fillCircle(x, y, 0.35);
      g.fillStyle(0xffe27a).fillPoints(starPoints(-2.2, 0.4, 1.3, 0.55), true);
      break;
    }
    case 'SUNSET': {
      // Bands of evening sky from the bonnet back, and a low sun on the roof.
      const bands = [0xffd166, 0xffa94d, 0xf26b3a, 0xc8457c, 0x5b3a8a];
      bands.forEach((colour, i) => g.fillStyle(colour, 0.85).fillRect(-7.5 + i * 3, -3.6, 3, 7.2));
      g.fillStyle(0xfff1a8).fillCircle(-2.4, 0, 1.4);
      break;
    }
    default:
      break;
  }
}

function v(x: number, y: number): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(x, y);
}

/** A five-pointed star's outline. */
function starPoints(cx: number, cy: number, outer: number, inner: number): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    pts.push(v(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

/** The police bicycle: a third of a car long, the officer pedalling in a helmet, a small blue light up front. */
function createPoliceBicycle(scene: Phaser.Scene, colours: PoliceColours): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.22).fillEllipse(0.6, 1, 7, 3);
  g.fillStyle(0x1b1b1b).fillRoundedRect(1.6, -0.35, 2.2, 0.7, 0.3).fillRoundedRect(-3.8, -0.35, 2.2, 0.7, 0.3); // tyres
  g.lineStyle(0.5, colours.body).lineBetween(-2.8, 0, 2.6, 0); // frame
  g.lineStyle(0.5, 0x2b2b2b).lineBetween(1.6, -1.8, 1.6, 1.8); // handlebars
  g.fillStyle(0x1b1b1b).fillRoundedRect(-1.2, -1.3, 2.2, 0.6, 0.3).fillRoundedRect(-1.2, 0.7, 2.2, 0.6, 0.3); // pedals
  g.fillStyle(colours.uniform).fillEllipse(-0.5, 0, 2.8, 3.8); // shoulders
  g.fillStyle(0xf4f4f0).fillCircle(-0.3, 0, 1.3); // helmet
  g.fillStyle(colours.stripe).fillRect(-1.1, -0.3, 1.6, 0.6);
  g.fillStyle(0xe8c547).fillRect(-1.6, -2, 1.1, 0.5).fillRect(-1.6, 1.5, 1.1, 0.5); // hi-vis bands
  const glow = scene.add.circle(2.6, 0, 4, 0x2f7de1, 0.2);
  const light = scene.add.circle(2.6, 0, 0.45, 0x8fd0ff);
  scene.tweens.add({ targets: [glow, light], alpha: 0.2, duration: 300, yoyo: true, repeat: -1 });
  return scene.add.container(0, 0, [glow, g, light]).setDepth(30).setScale(CAR_SCALE);
}

/** The police motorbike: about half a car long, the rider in a white helmet. */
function createPoliceBike(scene: Phaser.Scene, colours: PoliceColours): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.25).fillEllipse(0.8, 1.2, 10, 3.6);
  g.fillStyle(0x1b1b1b).fillRoundedRect(3, -0.6, 2.6, 1.2, 0.5).fillRoundedRect(-5.2, -0.65, 2.6, 1.3, 0.5); // tyres
  g.fillStyle(colours.body).fillEllipse(0, 0, 8.4, 2.8); // tank and seat
  g.lineStyle(0.35, OUTLINE, 0.9).strokeEllipse(0, 0, 8.4, 2.8);
  g.fillStyle(colours.stripe).fillRect(-2.6, -0.45, 5.2, 0.9);
  g.fillStyle(colours.body).fillRoundedRect(-4.8, -1.9, 2.6, 3.8, 0.8); // panniers
  g.lineStyle(0.6, 0x2b2b2b).lineBetween(2.6, -2.2, 2.6, 2.2); // handlebars
  // The rider: shoulders in uniform, a white helmet with a dark visor.
  g.fillStyle(colours.uniform).fillEllipse(-0.6, 0, 3.4, 4.6);
  g.fillStyle(0xf4f4f0).fillCircle(-0.3, 0, 1.6);
  g.fillStyle(0x1b2230).fillEllipse(0.9, 0, 0.8, 2);
  const glowRed = scene.add.circle(-4, -4, 7, 0xe0463a, 0.22);
  const glowBlue = scene.add.circle(-4, 4, 7, 0x2f7de1, 0.22).setAlpha(0);
  const lightRed = scene.add.rectangle(-4.6, -1.5, 0.8, 0.8, 0xe0463a);
  const lightBlue = scene.add.rectangle(-4.6, 1.5, 0.8, 0.8, 0x2f7de1).setAlpha(0.2);
  scene.tweens.add({ targets: [lightRed, glowRed], alpha: 0.15, duration: 230, yoyo: true, repeat: -1 });
  scene.tweens.add({ targets: [lightBlue, glowBlue], alpha: 1, duration: 230, yoyo: true, repeat: -1 });
  return scene.add.container(0, 0, [glowRed, glowBlue, g, lightRed, lightBlue, ...carLights(scene, 10)]).setDepth(30).setScale(CAR_SCALE);
}

/** The suspect's vehicle (the one the scanner names), drawn facing east. */
export function createSuspectCar(scene: Phaser.Scene, vehicle: Vehicle): Phaser.GameObjects.Container {
  const picture = carPicture(scene, vehicle === 'VAN' ? 'VAN' : 'CAR', PICTURE_TINT[vehicle], vehicle === 'VAN' ? 22 : 18);
  const g = scene.add.graphics();
  if (picture.length === 0) drawVehicle(g, vehicle);
  // A taxi's sign on the roof.
  else if (vehicle === 'TAXI') g.fillStyle(0x21313a).fillRoundedRect(-2.6, -2, 2.2, 4, 0.5).fillStyle(0xfff4b8).fillRect(-2.1, -1.4, 1.2, 2.8);
  return scene.add.container(0, 0, [...picture, g, ...carLights(scene, vehicle === 'VAN' ? 22 : 18)]).setDepth(29).setScale(CAR_SCALE);
}

/**
 * The fugitive's getaway car in Escape Mode (the garage's GETAWAY slot): the
 * story's car as it is, or one of the player's own, each a car's length.
 */
export function createGetawayCar(scene: Phaser.Scene, vehicle: Vehicle, style = 'STANDARD'): Phaser.GameObjects.Container {
  if (style === 'STANDARD' || !GETAWAY_LOOKS[style]) return createSuspectCar(scene, vehicle);
  const look = GETAWAY_LOOKS[style]!;
  const van = style === 'CAMION';
  const length = van ? 22 : 18;
  const picture = carPicture(scene, van ? 'VAN' : 'CAR', look.body, length);
  const g = scene.add.graphics();
  if (picture.length === 0) drawVehicle(g, van ? 'VAN' : 'BLUE');
  switch (style) {
    case 'SPORTIVE':
      g.fillStyle(0xffffff, 0.95).fillRect(-7, -1.6, 16, 0.9).fillRect(-7, 0.7, 16, 0.9); // racing stripes
      g.fillStyle(0x1b2230).fillRoundedRect(-9.6, -4.4, 1.3, 8.8, 0.4); // spoiler
      g.fillStyle(0x1b2230).fillRoundedRect(4.4, -1.1, 2.4, 2.2, 0.4); // bonnet scoop
      break;
    case 'CABRIOLET':
      // The roof down: two rows of seats in the open, a folded hood behind.
      g.fillStyle(0x2b2f36).fillRoundedRect(-6.2, -3.4, 7.8, 6.8, 1);
      g.fillStyle(0x8c2f2f).fillRoundedRect(-1.8, -2.9, 2.2, 2.4, 0.6).fillRoundedRect(-1.8, 0.5, 2.2, 2.4, 0.6);
      g.fillStyle(0x8c2f2f).fillRoundedRect(-5.4, -2.9, 2.2, 2.4, 0.6).fillRoundedRect(-5.4, 0.5, 2.2, 2.4, 0.6);
      g.fillStyle(0x1b1b1b).fillRoundedRect(-7.6, -3.6, 1.4, 7.2, 0.5); // folded hood
      g.fillStyle(0x3a3a3a).fillCircle(0.2, -1.4, 0.7); // steering wheel
      break;
    case 'MUSCLE':
      // Flames licking back from the bonnet, and a bonnet bulge.
      for (const side of [-1, 1]) {
        g.fillStyle(0xf26b3a).fillPoints([v(7.5, side * 1.2), v(2, side * 3.2), v(-1, side * 1.8), v(-4.5, side * 3.4), v(-2, side * 1.1), v(3, side * 0.6)], true);
        g.fillStyle(0xffd166).fillPoints([v(7, side * 1), v(3, side * 2.4), v(0.5, side * 1.5), v(-2, side * 2.4), v(-0.5, side * 0.9), v(3.5, side * 0.5)], true);
      }
      g.fillStyle(0x1b2230, 0.8).fillRoundedRect(3.8, -1, 3.4, 2, 0.5);
      break;
    case 'RETRO':
      // A white roof, chrome bumpers and a chrome stripe down each side.
      g.fillStyle(0xfbf7ee).fillRoundedRect(-5.6, -3.3, 6.8, 6.6, 1.2);
      g.fillStyle(0xd9dde2).fillRoundedRect(8.2, -3.4, 1.2, 6.8, 0.5).fillRoundedRect(-9.4, -3.4, 1.2, 6.8, 0.5);
      g.fillStyle(0xd9dde2, 0.95).fillRect(-7.5, -3.9, 15, 0.7).fillRect(-7.5, 3.2, 15, 0.7);
      break;
    case 'CAMION':
      // A delivery van: a white panel with a stripe, boxes behind the windscreen.
      g.fillStyle(0xfbf7ee, 0.95).fillRect(-9.5, -3.6, 13, 7.2);
      g.fillStyle(0x2f7de1).fillRect(-9.5, -0.8, 13, 1.6);
      g.fillStyle(0xf2c230).fillRect(-9.5, -3.6, 13, 0.8).fillRect(-9.5, 2.8, 13, 0.8);
      break;
    default:
      break;
  }
  return scene.add.container(0, 0, [...picture, g, ...carLights(scene, length)]).setDepth(29).setScale(CAR_SCALE);
}

/** Body colours of the garage's getaway cars (the picture is tinted with them). */
const GETAWAY_LOOKS: Record<string, { body: number }> = {
  SPORTIVE: { body: 0xd4202c },
  CABRIOLET: { body: 0xf2c230 },
  MUSCLE: { body: 0x3a3d45 },
  RETRO: { body: 0x9fe3c9 },
  CAMION: { body: 0xe8863a },
};

/** The officer on foot, seen from above, wearing the garage's headgear (`outfit`). */
export function createOfficer(scene: Phaser.Scene, colours: PoliceColours = CLASSIC_COLOURS, outfit = 'CASQUETTE'): Phaser.GameObjects.Container {
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
  drawHeadgear(g, outfit, uniform);
  // About the size of the people walking in town (a car is three times as long); a soft
  // ring underneath keeps the player easy to find.
  const ring = scene.add.circle(0, 0, 6.5, 0xffffff, 0.22).setStrokeStyle(0.8, uniform, 0.8).setName('ring');
  return scene.add.container(0, 0, [ring, ...parts, g]).setDepth(31).setScale(OFFICER_SCALE);
}

/** The officer's head from above: the police cap, or the garage's choice. */
function drawHeadgear(g: Phaser.GameObjects.Graphics, outfit: string, uniform: number): void {
  const cap = () => {
    g.fillStyle(0x0f1a30).fillEllipse(1.9, 0, 1.7, 3.4); // cap peak
    g.fillStyle(0x16233d).fillCircle(0.2, 0, 2.3); // cap
    g.lineStyle(0.45, OUTLINE, 0.9).strokeCircle(0.2, 0, 2.3);
    g.fillStyle(0x24365a).fillCircle(-0.1, -0.3, 1.3); // light on the crown
    g.fillStyle(0xe8c547).fillCircle(1.7, 0, 0.6); // badge on the cap peak
  };
  switch (outfit) {
    case 'LUNETTES':
      cap();
      g.fillStyle(0x111111).fillRoundedRect(2.3, -1.6, 0.7, 1.4, 0.3).fillRoundedRect(2.3, 0.2, 0.7, 1.4, 0.3);
      g.lineStyle(0.3, 0xdddddd, 0.9).lineBetween(2.65, -0.2, 2.65, 0.2);
      break;
    case 'CASQUE':
      g.fillStyle(0xf4f4f0).fillCircle(0.2, 0, 2.6);
      g.lineStyle(0.45, OUTLINE, 0.9).strokeCircle(0.2, 0, 2.6);
      g.fillStyle(uniform).fillRect(-2.2, -0.4, 4.6, 0.8);
      g.fillStyle(0x1b2230).fillEllipse(2.3, 0, 1, 3);
      break;
    case 'BERET':
      g.fillStyle(0x8a1c2b).fillEllipse(-0.1, -0.5, 5, 4.4);
      g.lineStyle(0.45, OUTLINE, 0.9).strokeEllipse(-0.1, -0.5, 5, 4.4);
      g.fillStyle(0xe8c547).fillCircle(1.3, 0.6, 0.6);
      break;
    case 'CARNAVAL': {
      // A fan of feathers behind the head, in mas colours, on a gold band.
      const feathers = [0xff4fa3, 0xf2c230, 0x2ed3a0, 0x29b6ff, 0xff7a29];
      feathers.forEach((colour, i) => {
        const a = Math.PI + (i - 2) * 0.38;
        g.fillStyle(colour).fillEllipse(0.2 + Math.cos(a) * 3, Math.sin(a) * 3, 3.6, 1.3);
      });
      g.fillStyle(0xf2c230).fillCircle(0.2, 0, 2.2);
      g.lineStyle(0.45, OUTLINE, 0.9).strokeCircle(0.2, 0, 2.2);
      g.fillStyle(0xff4fa3).fillCircle(1.4, 0, 0.6);
      break;
    }
    case 'PAILLE':
      // A wide straw hat with a dark band.
      g.fillStyle(0xe9d28a).fillCircle(0.2, 0, 3.3);
      g.lineStyle(0.45, OUTLINE, 0.9).strokeCircle(0.2, 0, 3.3);
      g.lineStyle(0.35, 0xc9ae5c, 0.8).strokeCircle(0.2, 0, 2.8);
      g.fillStyle(0xd9bc6c).fillCircle(0.2, 0, 2);
      g.lineStyle(0.6, uniform, 1).strokeCircle(0.2, 0, 2);
      break;
    case 'BANDANA':
      // A red bandana knotted at the back, hair showing in front.
      g.fillStyle(0x2a1d17).fillCircle(0.2, 0, 2.3);
      g.fillStyle(0xd23b30).fillEllipse(-0.3, 0, 3.8, 4.6);
      g.lineStyle(0.45, OUTLINE, 0.9).strokeEllipse(-0.3, 0, 3.8, 4.6);
      g.fillStyle(0xd23b30).fillTriangle(-2, -0.6, -3.6, -1.9, -2.4, 0.4).fillTriangle(-2, 0.6, -3.6, 1.9, -2.4, -0.4);
      g.fillStyle(0xffffff, 0.8).fillCircle(-0.8, -0.9, 0.3).fillCircle(0.4, 0.8, 0.3).fillCircle(-1.2, 1, 0.3);
      break;
    case 'COURONNE':
      // A gold crown with jewels, over the cap.
      cap();
      g.fillStyle(0xf0c53c).fillCircle(0.2, 0, 2.1);
      g.lineStyle(0.4, 0xb8860b, 1).strokeCircle(0.2, 0, 2.1);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.fillStyle(0xf0c53c).fillTriangle(0.2 + Math.cos(a) * 2, Math.sin(a) * 2, 0.2 + Math.cos(a + 0.5) * 2, Math.sin(a + 0.5) * 2, 0.2 + Math.cos(a + 0.25) * 3, Math.sin(a + 0.25) * 3);
        g.fillStyle([0xd4202c, 0x2f7de1, 0x2ed3a0][i % 3]!).fillCircle(0.2 + Math.cos(a + 0.25) * 1.4, Math.sin(a + 0.25) * 1.4, 0.35);
      }
      break;
    case 'NOEL':
      g.fillStyle(0xd23b30).fillCircle(0.2, 0, 2.3);
      g.fillStyle(0xd23b30).fillTriangle(-0.6, -1.2, -0.6, 1.2, -3.6, 1.6);
      g.fillStyle(0xffffff).fillCircle(-3.8, 1.7, 0.8);
      g.lineStyle(0.9, 0xffffff).strokeCircle(0.2, 0, 2.1);
      break;
    default:
      cap();
  }
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
export function createSuspectRunner(scene: Phaser.Scene, outfit = 'ROUGE'): Phaser.GameObjects.Container {
  const top = (FUGITIVE_LOOKS[outfit] ?? FUGITIVE_LOOKS.ROUGE!).top;
  const parts = [
    foot(scene, 'footL', -1.6, 0xf4f1e8),
    foot(scene, 'footR', 1.6, 0xf4f1e8),
    arm(scene, 'armL', -3.3, top, SKIN[2]),
    arm(scene, 'armR', 3.3, top, SKIN[2]),
  ];
  const g = scene.add.graphics();
  drawRunner(g, outfit);
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
