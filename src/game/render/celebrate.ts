import Phaser from 'phaser';
import { FONT_FAMILY } from '../palette';

/**
 * After the arrest (Mr Henry, 2026-10-04): the garage's arrest effect over
 * the suspect (a comic-book "ARRÊTÉ !" stamp, a confetti burst, sparkling
 * handcuffs, or all three) and the officer's victory pose. Drawing only.
 */
const CELEBRATE = {
  /** How long the pose lasts (ms); the results follow the scanner's line as before. */
  poseMs: 1500,
  confetti: 46,
  sparkles: 9,
};

const CONFETTI_COLOURS = [0xe0463a, 0xf2c230, 0x2ed3a0, 0x2f7de1, 0xff4fa3, 0xffffff];

/**
 * Plays the arrest effect at the suspect (`at`, world position). `toScreen`
 * puts an object on the interface camera (the stamp is drawn over the map,
 * not in it); `stampSize` shrinks the stamp for a small preview.
 */
export function arrestEffect(
  scene: Phaser.Scene,
  kind: string,
  at: { x: number; y: number },
  toScreen: (o: Phaser.GameObjects.GameObject) => void,
  toWorld: (o: Phaser.GameObjects.GameObject) => void,
  stampSize = 1,
): void {
  const all = kind === 'TOUT';
  if (kind === 'TAMPON' || all) stamp(scene, toScreen, stampSize);
  if (kind === 'CONFETTIS' || all) confetti(scene, at, toWorld);
  if (kind === 'ETINCELLES' || all) sparkle(scene, at, toWorld);
  if (kind === 'FEUX' || all) fireworks(scene, at, toWorld);
  if (kind === 'ETOILES' || all) shootingStars(scene, at, toWorld);
}

/** Rockets go up from the suspect and burst into coloured sparks, one after another. */
function fireworks(scene: Phaser.Scene, at: { x: number; y: number }, toWorld: (o: Phaser.GameObjects.GameObject) => void): void {
  const colours = [0xff4fa3, 0xf2c230, 0x2ed3a0, 0x4fa8ff, 0xffffff];
  for (let n = 0; n < 4; n++) {
    const burstAt = { x: at.x + (n - 1.5) * 12, y: at.y - 14 - (n % 2) * 8 };
    const rocket = scene.add.circle(at.x, at.y, 0.7, 0xfff1a8).setDepth(41);
    toWorld(rocket);
    scene.tweens.add({
      targets: rocket,
      x: burstAt.x,
      y: burstAt.y,
      delay: n * 350,
      duration: 420,
      ease: 'Quad.easeOut',
      onComplete: () => {
        rocket.destroy();
        const colour = colours[n % colours.length]!;
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const spark = scene.add.circle(burstAt.x, burstAt.y, 0.8, i % 3 === 0 ? 0xffffff : colour).setDepth(41);
          toWorld(spark);
          const d = 7 + (i % 2) * 4;
          scene.tweens.add({ targets: spark, x: burstAt.x + Math.cos(a) * d, y: burstAt.y + Math.sin(a) * d + 3, scale: 0.2, alpha: 0, duration: 700, ease: 'Quad.easeOut', onComplete: () => spark.destroy() });
        }
        const flash = scene.add.circle(burstAt.x, burstAt.y, 4, colour, 0.6).setDepth(40);
        toWorld(flash);
        scene.tweens.add({ targets: flash, scale: 2.5, alpha: 0, duration: 350, onComplete: () => flash.destroy() });
      },
    });
  }
}

/** Gold stars streak down across the suspect, trailing light, and wink out. */
function shootingStars(scene: Phaser.Scene, at: { x: number; y: number }, toWorld: (o: Phaser.GameObjects.GameObject) => void): void {
  for (let i = 0; i < 8; i++) {
    const from = { x: at.x - 30 + i * 6, y: at.y - 28 - (i % 3) * 5 };
    const to = { x: from.x + 24, y: from.y + 26 };
    const trail = scene.add.line(0, 0, 0, 0, -6, -6.5, 0xfff1a8, 0.9).setLineWidth(0.7).setDepth(40).setPosition(from.x, from.y).setAlpha(0);
    const star = scene.add.star(from.x, from.y, 5, 0.6, 1.4, 0xf2c230).setDepth(41).setAlpha(0);
    toWorld(trail);
    toWorld(star);
    const delay = i * 140;
    scene.tweens.add({ targets: [star, trail], alpha: 1, delay, duration: 120 });
    scene.tweens.add({ targets: [star, trail], x: to.x, y: to.y, delay, duration: 520, ease: 'Quad.easeIn' });
    scene.tweens.add({ targets: star, angle: 180, delay, duration: 520 });
    scene.tweens.add({
      targets: [star, trail],
      alpha: 0,
      delay: delay + 420,
      duration: 200,
      onComplete: () => {
        star.destroy();
        trail.destroy();
      },
    });
  }
}

/** "ARRÊTÉ !" slammed on like a rubber stamp, red and slightly crooked. */
function stamp(scene: Phaser.Scene, toScreen: (o: Phaser.GameObjects.GameObject) => void, size: number): void {
  const { width, height } = scene.scale;
  const label = scene.add
    .text(0, 0, 'ARRÊTÉ !', { fontFamily: FONT_FAMILY, fontSize: '84px', fontStyle: 'bold', color: '#d4202c' })
    .setOrigin(0.5);
  const frame = scene.add.rectangle(0, 0, label.width + 50, label.height + 22).setStrokeStyle(9, 0xd4202c);
  const inner = scene.add.rectangle(0, 0, label.width + 30, label.height + 6).setStrokeStyle(3, 0xd4202c);
  const box = scene.add.container(width / 2, height / 2 - 205, [frame, inner, label]).setDepth(160).setRotation(-0.2).setScale(3 * size).setAlpha(0);
  toScreen(box);
  scene.tweens.add({
    targets: box,
    scale: size,
    alpha: 0.92,
    duration: 220,
    ease: 'Quad.easeIn',
    onComplete: () => {
      scene.cameras.main.shake(160, 0.006);
      scene.tweens.add({ targets: box, alpha: 0, delay: 1700, duration: 500, onComplete: () => box.destroy() });
    },
  });
}

/** A burst of paper confetti that flutters down and fades. */
function confetti(scene: Phaser.Scene, at: { x: number; y: number }, toWorld: (o: Phaser.GameObjects.GameObject) => void): void {
  for (let i = 0; i < CELEBRATE.confetti; i++) {
    const piece = scene.add
      .rectangle(at.x, at.y, Phaser.Math.FloatBetween(1, 1.8), Phaser.Math.FloatBetween(0.5, 0.9), CONFETTI_COLOURS[i % CONFETTI_COLOURS.length]!)
      .setDepth(40)
      .setRotation(Phaser.Math.FloatBetween(0, Math.PI));
    toWorld(piece);
    const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const d = Phaser.Math.FloatBetween(6, 22);
    scene.tweens.add({
      targets: piece,
      x: at.x + Math.cos(a) * d,
      y: at.y + Math.sin(a) * d,
      rotation: piece.rotation + Phaser.Math.FloatBetween(-8, 8),
      scaleX: { from: 1, to: 0.3, yoyo: true, repeat: 3, duration: 180 },
      duration: Phaser.Math.Between(900, 1500),
      ease: 'Cubic.easeOut',
    });
    scene.tweens.add({ targets: piece, alpha: 0, delay: 900, duration: 700, onComplete: () => piece.destroy() });
  }
}

/** The handcuffs flash silver: star glints popping round the suspect and a bright ring. */
function sparkle(scene: Phaser.Scene, at: { x: number; y: number }, toWorld: (o: Phaser.GameObjects.GameObject) => void): void {
  const ring = scene.add.circle(at.x, at.y, 3).setStrokeStyle(0.8, 0xe8f4ff, 1).setDepth(40);
  toWorld(ring);
  scene.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 600, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
  for (let i = 0; i < CELEBRATE.sparkles; i++) {
    const a = (i / CELEBRATE.sparkles) * Math.PI * 2;
    const r = Phaser.Math.FloatBetween(3, 8);
    const glint = scene.add.star(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r, 4, 0.25, 1.6, i % 3 === 0 ? 0xf2c230 : 0xffffff).setDepth(41).setScale(0).setAlpha(1);
    toWorld(glint);
    scene.tweens.add({
      targets: glint,
      scale: { from: 0, to: 1.2 },
      angle: 90,
      delay: i * 90,
      duration: 260,
      yoyo: true,
      repeat: 2,
      onComplete: () => glint.destroy(),
    });
  }
}

/**
 * The officer's victory pose, seen from above: a salute (hand up to the cap),
 * a fist pumped in the air, or a little dance on the spot.
 */
export function victoryPose(scene: Phaser.Scene, officer: Phaser.GameObjects.Container, pose: string): void {
  const part = (name: string) => officer.getByName(name) as Phaser.GameObjects.Container | null;
  const armR = part('armR');
  const armL = part('armL');
  if (!armR || !armL) return;
  const base = { rotation: officer.rotation, ry: armR.y, ly: armL.y };
  if (pose === 'POING') {
    // The fist punches up past the head, three times.
    scene.tweens.add({ targets: armR, x: 3.4, y: 1.6, duration: 160, yoyo: true, repeat: 3, ease: 'Back.easeOut' });
    scene.tweens.add({ targets: officer, scale: officer.scale * 1.08, duration: 160, yoyo: true, repeat: 3 });
  } else if (pose === 'PIROUETTE') {
    // A full spin on the spot, arms out wide, then back to face the way they were.
    scene.tweens.add({ targets: armR, y: base.ry + 1.4, duration: 200, yoyo: true, hold: 700 });
    scene.tweens.add({ targets: armL, y: base.ly - 1.4, duration: 200, yoyo: true, hold: 700 });
    scene.tweens.add({ targets: officer, rotation: base.rotation + Math.PI * 2, duration: 1000, ease: 'Cubic.easeInOut', onComplete: () => officer.setRotation(base.rotation) });
  } else if (pose === 'SAUT') {
    // A star jump: up with arms and legs spread, twice, with a bounce of the shadow ring.
    const footL = part('footL');
    const footR = part('footR');
    scene.tweens.add({ targets: officer, scale: officer.scale * 1.3, duration: 260, yoyo: true, repeat: 1, ease: 'Quad.easeOut' });
    scene.tweens.add({ targets: armR, y: base.ry + 1.6, x: 2, duration: 260, yoyo: true, repeat: 1 });
    scene.tweens.add({ targets: armL, y: base.ly - 1.6, x: 2, duration: 260, yoyo: true, repeat: 1 });
    if (footL && footR) {
      scene.tweens.add({ targets: footL, y: -3, duration: 260, yoyo: true, repeat: 1 });
      scene.tweens.add({ targets: footR, y: 3, duration: 260, yoyo: true, repeat: 1 });
    }
  } else if (pose === 'DANSE') {
    // Swaying side to side, arms swinging opposite ways.
    scene.tweens.add({ targets: officer, rotation: base.rotation + 0.5, duration: 190, yoyo: true, repeat: 3, ease: 'Sine.easeInOut' });
    scene.tweens.add({ targets: armR, x: 2.6, duration: 190, yoyo: true, repeat: 3 });
    scene.tweens.add({ targets: armL, x: -2.6, duration: 190, yoyo: true, repeat: 3 });
  } else {
    // A smart salute: the right hand comes up to the cap's peak and holds.
    scene.tweens.add({ targets: armR, x: 2.2, y: 1.2, duration: 240, hold: CELEBRATE.poseMs - 600, yoyo: true, ease: 'Quad.easeOut' });
  }
  scene.time.delayedCall(CELEBRATE.poseMs, () => {
    armR.setY(base.ry);
    armL.setY(base.ly);
    (part('footL') as unknown as Phaser.GameObjects.Components.Transform | null)?.setY(-1.6);
    (part('footR') as unknown as Phaser.GameObjects.Components.Transform | null)?.setY(1.6);
  });
}
