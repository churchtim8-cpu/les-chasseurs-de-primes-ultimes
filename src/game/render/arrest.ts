import Phaser from 'phaser';
import { actionSounds } from '../audio/ActionSounds';
import type { DriftEffects } from './drift';

/**
 * The arrest, played out on the map before "Le suspect est arrêté !" (drawing
 * and sound only: the chase has already been won).
 *
 * In the car, the police car overtakes the suspect and swings across its
 * path; the suspect's car skids to a screeching halt in tyre smoke. On foot,
 * the officer dives and tackles the suspect to the ground with a thud, and
 * the handcuffs click.
 */
const ARREST = {
  /** Seconds for the car block and how far (map units) the suspect slides to a stop. */
  carSeconds: 1.7,
  maxSlide: 30,
  /** Where the police car ends up: this far ahead of the stopped suspect, turned across the road. */
  blockAhead: 26,
  blockAngle: 1.15,
  /** Seconds for the tackle: the last strides, the dive, then lying pinned down. */
  footRun: 0.6,
  footDive: 0.4,
  footPinned: 0.6,
  /** How far behind (map units) the officer is when the dive starts. */
  diveFrom: 9,
  /** Pause after the action before the scanner speaks (s). */
  settle: 0.5,
  /** Further apart than this (map units, e.g. a debug skip), there is no scene to play. */
  maxGap: 80,
  /** Closer than this (e.g. a debug jump onto the suspect), the police start the scene this far behind instead. */
  minGap: { car: 18, foot: 15 },
};

export interface ArrestActors {
  police: Phaser.GameObjects.Container;
  suspect: Phaser.GameObjects.Container;
  /** Police and suspect headings as drawn (radians). */
  policeHeading: number;
  suspectHeading: number;
  /** The suspect's speed (map units per second). */
  suspectSpeed: number;
  /** 'BLOCK': both in cars. 'TACKLE': both on foot. 'PULL_UP': anything else (a suspect caught changing transport). */
  kind: 'BLOCK' | 'TACKLE' | 'PULL_UP';
}

export function arrestKind(policeMode: 'CAR' | 'FOOT', suspectIsCar: boolean): ArrestActors['kind'] {
  if (policeMode === 'CAR' && suspectIsCar) return 'BLOCK';
  if (policeMode === 'FOOT' && !suspectIsCar) return 'TACKLE';
  return 'PULL_UP';
}

/** Plays the arrest; resolves when it is over (at once if the two are too far apart). */
export function playArrest(scene: Phaser.Scene, drift: DriftEffects, actors: ArrestActors): Promise<void> {
  const { police, suspect } = actors;
  suspect.setAlpha(1);
  const gap = Phaser.Math.Distance.Between(police.x, police.y, suspect.x, suspect.y);
  if (gap > ARREST.maxGap) return Promise.resolve();
  const minGap = actors.kind === 'TACKLE' ? ARREST.minGap.foot : ARREST.minGap.car;
  if (actors.kind !== 'PULL_UP' && gap < minGap) {
    police.setPosition(suspect.x - Math.cos(actors.suspectHeading) * minGap, suspect.y - Math.sin(actors.suspectHeading) * minGap);
  }
  const done = actors.kind === 'BLOCK' ? block(scene, drift, actors) : actors.kind === 'TACKLE' ? tackle(scene, drift, actors) : pullUp(scene, actors);
  return done.then(() => new Promise((resolve) => scene.time.delayedCall(ARREST.settle * 1000, resolve)));
}

function forward(heading: number, d: number): { x: number; y: number } {
  return { x: Math.cos(heading) * d, y: Math.sin(heading) * d };
}

/** Runs `step(share, dt)` every frame for `seconds`, then resolves. */
function animate(scene: Phaser.Scene, seconds: number, step: (share: number, dt: number) => void): Promise<void> {
  return new Promise((resolve) => {
    let elapsed = 0;
    const tick = (_time: number, delta: number) => {
      const dt = Math.min(delta, 50) / 1000;
      elapsed += dt;
      const share = Math.min(1, elapsed / seconds);
      step(share, dt);
      if (share >= 1) {
        stop();
        resolve();
      }
    };
    // Leaving the chase mid-scene (ÉCHAP) drops it; the promise never resolves.
    const stop = () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, tick);
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, stop);
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, stop);
  });
}

function block(scene: Phaser.Scene, drift: DriftEffects, a: ArrestActors): Promise<void> {
  const { police, suspect } = a;
  const h = a.suspectHeading;
  const slide = Math.min(ARREST.maxSlide, Math.max(14, a.suspectSpeed * ARREST.carSeconds * 0.45));
  const s0 = { x: suspect.x, y: suspect.y };
  const stop = forward(h, slide);
  // Swing across on the side the police car is already on (or the left).
  const side = Math.sign(-Math.sin(h) * (police.x - s0.x) + Math.cos(h) * (police.y - s0.y)) || 1;
  const across = h + side * ARREST.blockAngle;
  const end = { x: s0.x + stop.x + Math.cos(h) * ARREST.blockAhead, y: s0.y + stop.y + Math.sin(h) * ARREST.blockAhead };
  const alongside = {
    x: s0.x + Math.cos(h) * slide * 0.6 - Math.sin(h) * side * 11,
    y: s0.y + Math.sin(h) * slide * 0.6 + Math.cos(h) * side * 11,
  };
  const curve = new Phaser.Curves.CubicBezier(
    new Phaser.Math.Vector2(police.x, police.y),
    new Phaser.Math.Vector2(alongside.x, alongside.y),
    new Phaser.Math.Vector2(end.x + Math.cos(h) * 6 - Math.sin(h) * side * 6, end.y + Math.sin(h) * 6 + Math.cos(h) * side * 6),
    new Phaser.Math.Vector2(end.x, end.y),
  );
  const startHeading = a.policeHeading;
  actionSounds.screech(1.5, 0.26);
  scene.time.delayedCall(ARREST.carSeconds * 520, () => actionSounds.screech(0.6, 0.18));
  scene.time.delayedCall(ARREST.carSeconds * 1000, () => actionSounds.whoop());
  return animate(scene, ARREST.carSeconds, (share, dt) => {
    // The suspect brakes hard: fast at first, then stopped, its tail kicking out a little.
    const braking = 1 - (1 - share) * (1 - share);
    suspect.setPosition(s0.x + stop.x * braking, s0.y + stop.y * braking).setRotation(h - side * 0.35 * braking);
    if (share < 1) drift.tyres('suspect', suspect.x, suspect.y, suspect.rotation, 1 - share * 0.5, dt);
    else drift.lift('suspect');
    // The police car overtakes and swings across in front, skidding the last part.
    const eased = Phaser.Math.Easing.Sine.Out(share);
    const p = curve.getPoint(eased);
    police.setPosition(p.x, p.y);
    const turn = share < 0.55 ? 0 : (share - 0.55) / 0.45;
    police.setRotation(startHeading + Phaser.Math.Angle.Wrap(across - startHeading) * Phaser.Math.Easing.Quadratic.InOut(turn));
    if (turn > 0 && share < 1) drift.tyres('police', police.x, police.y, police.rotation, turn, dt);
    else drift.lift('police');
  });
}

function tackle(scene: Phaser.Scene, drift: DriftEffects, a: ArrestActors): Promise<void> {
  const { police, suspect } = a;
  const h = a.suspectHeading;
  const run = Math.max(2, a.suspectSpeed * ARREST.footRun);
  const s0 = { x: suspect.x, y: suspect.y };
  const s1 = { x: s0.x + Math.cos(h) * run, y: s0.y + Math.sin(h) * run };
  const p0 = { x: police.x, y: police.y };
  const behind = { x: s1.x - Math.cos(h) * ARREST.diveFrom, y: s1.y - Math.sin(h) * ARREST.diveFrom };
  const officerScale = police.scale;
  const suspectScale = suspect.scale;
  // The last strides: the suspect runs on, the officer closes right in behind.
  return animate(scene, ARREST.footRun, (share) => {
    suspect.setPosition(Phaser.Math.Linear(s0.x, s1.x, share), Phaser.Math.Linear(s0.y, s1.y, share));
    police.setPosition(Phaser.Math.Linear(p0.x, behind.x, share), Phaser.Math.Linear(p0.y, behind.y, share));
    police.setRotation(h);
  }).then(() => {
    actionSounds.whoosh();
    // The "this is you" ring under the officer fades so the two can be seen on the ground.
    const ring = police.getByName('ring') as Phaser.GameObjects.Shape | null;
    if (ring) scene.tweens.add({ targets: ring, alpha: 0, duration: ARREST.footDive * 1000 });
    const land = { x: s1.x + Math.cos(h) * 4, y: s1.y + Math.sin(h) * 4 };
    let hit = false;
    // The dive: the officer stretches out and flies onto the suspect; both go down.
    return animate(scene, ARREST.footDive, (share) => {
      police.setPosition(Phaser.Math.Linear(behind.x, land.x - Math.cos(h) * 5.5, share), Phaser.Math.Linear(behind.y, land.y - Math.sin(h) * 5.5, share));
      police.setScale(officerScale * (1 + 0.35 * Math.sin(share * Math.PI)), officerScale);
      suspect.setPosition(Phaser.Math.Linear(s1.x, land.x, share), Phaser.Math.Linear(s1.y, land.y, share));
      if (share > 0.6 && !hit) {
        hit = true;
        actionSounds.thud();
        actionSounds.oof();
        drift.dust(land.x, land.y, 10);
      }
      // Knocked flat: turned sideways and stretched out on the ground.
      const down = Math.max(0, (share - 0.6) / 0.4);
      suspect.setRotation(h + down * 1.4).setScale(suspectScale * (1 + 0.3 * down), suspectScale * (1 - 0.15 * down));
    }).then(() => {
      police.setScale(officerScale * 1.15, officerScale);
      actionSounds.cuffs(0.35);
      return new Promise<void>((resolve) => scene.time.delayedCall(ARREST.footPinned * 1000, resolve));
    });
  });
}

/** A suspect caught while changing transport: the police pull up beside them and cuff them. */
function pullUp(scene: Phaser.Scene, a: ArrestActors): Promise<void> {
  const { police, suspect } = a;
  const from = { x: police.x, y: police.y };
  const angle = Phaser.Math.Angle.Between(from.x, from.y, suspect.x, suspect.y);
  const gap = Phaser.Math.Distance.Between(from.x, from.y, suspect.x, suspect.y);
  const stopAt = Math.max(0, gap - 10);
  actionSounds.screech(0.6, 0.18);
  return animate(scene, 0.6, (share) => {
    const d = stopAt * Phaser.Math.Easing.Quadratic.Out(share);
    police.setPosition(from.x + Math.cos(angle) * d, from.y + Math.sin(angle) * d);
  }).then(() => {
    actionSounds.cuffs(0.2);
  });
}
