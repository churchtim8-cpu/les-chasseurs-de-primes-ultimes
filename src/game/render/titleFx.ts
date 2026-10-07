import Phaser from 'phaser';
import { lightGraphics } from './graphicsMode';
import { GAME_HEIGHT, GAME_WIDTH } from '../layout';

/**
 * Title-screen motion, drawn in code (no pictures): soft red and blue police
 * glows breathing at the screen edges, speed streaks racing past, a police
 * light bar flashing above the title, a scanner sweep across the panel and a
 * gently pulsing title. Everything is a handful of shapes moved by tweens, so
 * it stays light on school laptops. With "reduce motion" asked for by the
 * device, only the still shapes are drawn.
 */
export const TITLE_FX = {
  red: 0xff2a3d,
  blue: 0x2f6bff,
  /** Edge glows: how far in from the edge they reach (px) and their strongest opacity; one full red-to-blue swap takes `period` ms. */
  glow: { radius: 230, alpha: 1, period: 1400 },
  /** Light bar above the title: size (px) and how long each step of the flash pattern lasts (ms). */
  bar: { width: 236, height: 20, step: 140 },
  /** Scanner sweep: band width (px), crossing time and pause between crossings (ms). */
  sweep: { width: 90, duration: 1600, pause: 2600, alpha: 0.32 },
  /** Speed streaks: how many, their bands of the screen (px) and crossing time range (ms). */
  streaks: { count: 9, bands: [[18, 128], [540, 700]] as const, minMs: 700, maxMs: 1500 },
  /** Title pulse: how much it grows (scale) and how long one breath lasts (ms). */
  pulse: { scale: 1.03, period: 1100 },
} as const;

const reducedMotion = (): boolean => {
  // Light graphics keep the title screen still too.
  if (lightGraphics()) return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Behind the panel: the police glows at the screen edges and the speed streaks. */
export function titleBackdropFx(scene: Phaser.Scene): void {
  const { red, blue, glow } = TITLE_FX;
  const still = reducedMotion();
  const halo = (x: number, colour: number) => {
    // A tall tinted wash (normal blend, so it shows on the bright picture);
    // concentric ellipses give a soft fade without a texture.
    const g = scene.add.graphics({ x, y: GAME_HEIGHT / 2 });
    for (let k = 1; k <= 6; k++) g.fillStyle(colour, 0.09).fillEllipse(0, 0, (glow.radius * 2 * k) / 6, (GAME_HEIGHT * 1.5 * k) / 6);
    return g;
  };
  const left = halo(0, red).setAlpha(still ? glow.alpha / 2 : 0);
  const right = halo(GAME_WIDTH, blue).setAlpha(still ? glow.alpha / 2 : glow.alpha);
  if (still) return;
  scene.tweens.add({ targets: left, alpha: glow.alpha, duration: glow.period / 2, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  scene.tweens.add({ targets: right, alpha: 0, duration: glow.period / 2, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

  const { count, bands, minMs, maxMs } = TITLE_FX.streaks;
  for (let i = 0; i < count; i++) {
    const [top, bottom] = i % 2 === 0 ? bands[0] : bands[1];
    const length = Phaser.Math.Between(70, 180);
    const streak = scene.add.rectangle(0, 0, length, 2, 0xffffff, Phaser.Math.FloatBetween(0.25, 0.5)).setOrigin(0, 0.5);
    const run = () => {
      streak.setPosition(GAME_WIDTH + Phaser.Math.Between(0, 400), Phaser.Math.Between(top, bottom));
      scene.tweens.add({
        targets: streak,
        x: -length,
        duration: Phaser.Math.Between(minMs, maxMs),
        delay: Phaser.Math.Between(0, 1200),
        onComplete: run,
      });
    };
    run();
  }
}

/**
 * Over the panel: the flashing light bar centred on its top edge, the scanner
 * sweep (clipped to the panel) and the title's pulse.
 */
export function titleFrontFx(
  scene: Phaser.Scene,
  panel: { x: number; y: number; w: number; h: number },
  title: Phaser.GameObjects.Text,
): void {
  const { red, blue, bar, sweep, pulse } = TITLE_FX;
  const still = reducedMotion();

  // The light bar: a dark housing with a red half and a blue half, each with its own glow.
  const cx = panel.x + panel.w / 2;
  const cy = panel.y;
  const half = bar.width / 2;
  scene.add.rectangle(cx, cy, bar.width + 12, bar.height + 10, 0x10161c).setStrokeStyle(2, 0x5a6670);
  const lamp = (side: -1 | 1, colour: number) => {
    const x = cx + (side * half) / 2;
    const glowG = scene.add.graphics({ x, y: cy }).setBlendMode(Phaser.BlendModes.ADD);
    for (let k = 1; k <= 4; k++) glowG.fillStyle(colour, 0.12).fillEllipse(0, 0, half * (0.9 + k * 0.45), bar.height * (1 + k * 1.1));
    const dim = scene.add.rectangle(x, cy, half - 6, bar.height, colour, 0.3);
    const lit = scene.add.rectangle(x, cy, half - 6, bar.height, colour).setStrokeStyle(1, 0xffffff, 0.6);
    return { glowG, lit, dim };
  };
  const lamps = [lamp(-1, red), lamp(1, blue)];
  scene.add.rectangle(cx, cy, 8, bar.height + 4, 0x10161c);
  // Which halves are lit: 'R' red, 'B' blue, '-' neither, 'RB' both.
  const show = (on: string) =>
    lamps.forEach((l, i) => {
      const visible = on.includes(i === 0 ? 'R' : 'B');
      l.lit.setVisible(visible);
      l.glowG.setVisible(visible);
    });
  if (still) {
    show('RB');
  } else {
    // Red, red, blue, blue: the classic double flash.
    const pattern = 'R-R-B-B-';
    let step = 0;
    show(pattern.charAt(0));
    scene.time.addEvent({ delay: bar.step, loop: true, callback: () => show(pattern.charAt((step = (step + 1) % pattern.length))) });
  }

  if (still) return;
  // The scanner sweep: a slanted band of light crossing the panel now and then.
  const band = scene.add.graphics({ x: panel.x - sweep.width * 2, y: panel.y });
  const slant = panel.h * 0.35;
  band.fillStyle(0xffffff, sweep.alpha / 2).fillPoints(
    [new Phaser.Math.Vector2(slant, 0), new Phaser.Math.Vector2(slant + sweep.width, 0), new Phaser.Math.Vector2(sweep.width, panel.h), new Phaser.Math.Vector2(0, panel.h)],
    true,
  );
  band.fillStyle(0xffffff, sweep.alpha).fillPoints(
    [new Phaser.Math.Vector2(slant + sweep.width * 0.35, 0), new Phaser.Math.Vector2(slant + sweep.width * 0.65, 0), new Phaser.Math.Vector2(sweep.width * 0.65, panel.h), new Phaser.Math.Vector2(sweep.width * 0.35, panel.h)],
    true,
  );
  const clip = scene.make.graphics({}, false).fillRect(panel.x, panel.y, panel.w, panel.h);
  band.setMask(clip.createGeometryMask());
  scene.tweens.add({
    targets: band,
    x: panel.x + panel.w,
    duration: sweep.duration,
    delay: 600,
    repeatDelay: sweep.pause,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });

  scene.tweens.add({ targets: title, scale: pulse.scale, duration: pulse.period / 2, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
}
