import Phaser from 'phaser';
import { Rng } from '../../engine/rng/prng';
import { pickWeather, WEATHER, WEATHERS, type Weather } from '../../engine/world/weather';

/** The title-screen choice: one weather always, or a different one each chase. */
export type WeatherChoice = Weather | 'RANDOM';
const CHOICES: readonly WeatherChoice[] = ['CLEAR', 'RAIN', 'FOG', 'RANDOM'];
const KEY = 'chasseurs.weather';

export const WEATHER_NAMES: Record<WeatherChoice, string> = { CLEAR: 'Sunny', RAIN: 'Rain', FOG: 'Fog', RANDOM: 'Random' };
export const WEATHER_ICONS: Record<WeatherChoice, string> = { CLEAR: '☀️', RAIN: '🌧️', FOG: '🌫️', RANDOM: '🎲' };

/** `?weather=rain|fog|clear|random` in the address, else the choice remembered on this device. */
export function weatherChoice(): WeatherChoice {
  const asked = new URLSearchParams(window.location.search).get('weather')?.toUpperCase();
  if (asked && (CHOICES as readonly string[]).includes(asked)) return asked as WeatherChoice;
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved && (CHOICES as readonly string[]).includes(saved) ? (saved as WeatherChoice) : 'CLEAR';
  } catch {
    return 'CLEAR';
  }
}

/** The next choice on the title-screen button. */
export function cycleWeather(): WeatherChoice {
  const next = CHOICES[(CHOICES.indexOf(weatherChoice()) + 1) % CHOICES.length] as WeatherChoice;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Private windows can refuse storage; the choice then lasts this visit only.
  }
  return next;
}

/** The weather for one chase: random choices follow the chase's seed, so a replay has the same weather. */
export function weatherFor(seed: string): Weather {
  const choice = weatherChoice();
  return choice === 'RANDOM' ? pickWeather(Rng.fromSeed(`${seed}/weather`)) : choice;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Draws the weather over the town, in screen space (seen only by the HUD
 * camera, under the HUD panels). `player` gives the player's position on
 * screen each frame, so the fog stays clear just around them. Returns the
 * objects made, for the main camera to ignore.
 */
export function drawWeather(scene: Phaser.Scene, weather: Weather, player: () => { x: number; y: number }, depth = 120): Phaser.GameObjects.GameObject[] {
  if (!(WEATHERS as readonly string[]).includes(weather) || weather === 'CLEAR') return [];
  return weather === 'RAIN' ? rain(scene, depth) : fog(scene, player, depth);
}

function rain(scene: Phaser.Scene, depth: number): Phaser.GameObjects.GameObject[] {
  const { width, height } = scene.scale;
  const cfg = WEATHER.rain;
  const gloom = scene.add.rectangle(0, 0, width, height, cfg.gloom.colour, cfg.gloom.alpha).setOrigin(0).setScrollFactor(0).setDepth(depth);
  const flash = scene.add.rectangle(0, 0, width, height, 0xf4f8ff, 0).setOrigin(0).setScrollFactor(0).setDepth(depth + 0.2);
  const g = scene.add.graphics().setScrollFactor(0).setDepth(depth + 0.1);
  const drops = Array.from({ length: cfg.drops }, () => ({
    x: rand(-60, width + 60),
    y: rand(-40, height),
    length: rand(cfg.length[0], cfg.length[1]),
    speed: rand(cfg.speed[0], cfg.speed[1]),
    alpha: rand(0.35, 0.7),
  }));
  const splashes: { x: number; y: number; age: number }[] = [];
  let nextFlash = rand(cfg.lightningEvery[0], cfg.lightningEvery[1]) * 1000;
  const tick = (_time: number, delta: number) => {
    const dt = Math.min(delta, 50) / 1000;
    g.clear();
    for (const d of drops) {
      d.y += d.speed * dt;
      d.x += d.speed * cfg.slant * dt;
      if (d.y > height + 20 || d.x > width + 60) {
        if (Math.random() < 0.35) splashes.push({ x: d.x - cfg.slant * 20, y: rand(0, height), age: 0 });
        d.y = rand(-60, -10);
        d.x = rand(-120, width);
      }
      g.lineStyle(2, 0xeef4fb, d.alpha).lineBetween(d.x, d.y, d.x - d.length * cfg.slant, d.y - d.length);
    }
    // Little rings where drops land on the road.
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i]!;
      s.age += dt;
      if (s.age > 0.35) {
        splashes.splice(i, 1);
        continue;
      }
      const k = s.age / 0.35;
      g.lineStyle(1.2, 0xdce8f4, 0.5 * (1 - k)).strokeEllipse(s.x, s.y, 4 + 14 * k, 2 + 6 * k);
    }
    nextFlash -= delta;
    if (nextFlash <= 0) {
      nextFlash = rand(cfg.lightningEvery[0], cfg.lightningEvery[1]) * 1000;
      scene.tweens.chain({
        targets: flash,
        tweens: [
          { alpha: 0.32, duration: 60 },
          { alpha: 0.05, duration: 90 },
          { alpha: 0.24, duration: 50 },
          { alpha: 0, duration: 380 },
        ],
      });
    }
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, tick));
  return [gloom, g, flash];
}

/** A soft fog: thick at the edges of the screen, clear around the player, with banks of mist drifting by. */
function fog(scene: Phaser.Scene, player: () => { x: number; y: number }, depth: number): Phaser.GameObjects.GameObject[] {
  const { width, height } = scene.scale;
  const cfg = WEATHER.fog;
  const colour = Phaser.Display.Color.IntegerToRGB(cfg.colour);
  const rgba = (a: number) => `rgba(${colour.r},${colour.g},${colour.b},${a})`;
  // One big picture of the fog, twice the screen so it can follow the player anywhere on it.
  const size = Math.ceil(Math.max(width, height) * 2);
  if (!scene.textures.exists('weather-fog')) {
    const tex = scene.textures.createCanvas('weather-fog', size, size);
    const ctx = tex?.getContext();
    if (tex && ctx) {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, height * cfg.clearRadius, size / 2, size / 2, height * cfg.thickRadius);
      gradient.addColorStop(0, rgba(0));
      gradient.addColorStop(0.45, rgba(cfg.thickAlpha * 0.55));
      gradient.addColorStop(1, rgba(cfg.thickAlpha));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      tex.refresh();
    }
  }
  if (!scene.textures.exists('weather-mist')) {
    const tex = scene.textures.createCanvas('weather-mist', 256, 128);
    const ctx = tex?.getContext();
    if (tex && ctx) {
      const gradient = ctx.createRadialGradient(128, 64, 4, 128, 64, 64);
      gradient.addColorStop(0, rgba(0.55));
      gradient.addColorStop(1, rgba(0));
      ctx.setTransform(2, 0, 0, 1, 0, 0);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      tex.refresh();
    }
  }
  const haze = scene.add.rectangle(0, 0, width, height, cfg.colour, 0.12).setOrigin(0).setScrollFactor(0).setDepth(depth);
  const veil = scene.add.image(width / 2, height / 2, 'weather-fog').setScrollFactor(0).setDepth(depth + 0.1);
  const banks = Array.from({ length: cfg.banks }, () =>
    scene.add
      .image(rand(0, width), rand(0, height), 'weather-mist')
      .setScrollFactor(0)
      .setDepth(depth + 0.15)
      .setScale(rand(2.2, 4), rand(1.6, 2.6))
      .setAlpha(rand(0.4, 0.8)),
  );
  const drift = banks.map(() => rand(14, 34));
  const tick = (_time: number, delta: number) => {
    const p = player();
    veil.setPosition(veil.x + (p.x - veil.x) * 0.2, veil.y + (p.y - veil.y) * 0.2);
    banks.forEach((b, i) => {
      b.x += (drift[i] as number) * (delta / 1000);
      if (b.x - b.displayWidth / 2 > width) b.setPosition(-b.displayWidth / 2, rand(0, height));
    });
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, tick));
  return [haze, veil, ...banks];
}

/** Where a point of the town is on screen, through a camera that may be zoomed and turned. */
export function onScreen(camera: Phaser.Cameras.Scene2D.Camera, x: number, y: number): { x: number; y: number } {
  // The camera's own screen-to-town mapping is affine: invert it from three points.
  const o = camera.getWorldPoint(0, 0);
  const a = camera.getWorldPoint(100, 0);
  const b = camera.getWorldPoint(0, 100);
  const ax = (a.x - o.x) / 100;
  const ay = (a.y - o.y) / 100;
  const bx = (b.x - o.x) / 100;
  const by = (b.y - o.y) / 100;
  const det = ax * by - bx * ay;
  if (Math.abs(det) < 1e-9) return { x: camera.width / 2, y: camera.height / 2 };
  const dx = x - o.x;
  const dy = y - o.y;
  return { x: (dx * by - dy * bx) / det, y: (ax * dy - ay * dx) / det };
}
