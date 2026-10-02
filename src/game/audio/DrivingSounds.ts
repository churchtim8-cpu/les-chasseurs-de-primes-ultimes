import type { ScannerAudio } from './ScannerAudio';

/**
 * Car sounds, synthesised live with Web Audio: an engine hum whose pitch
 * follows the speed, and a tyre screech on sharp turns at speed. They play on
 * the music bus, so they drop right down while the French is spoken. Silent
 * on foot. Sound design only (game code, not the engine).
 */

const ENGINE = {
  /** Engine level while driving (the French always comes first). */
  level: 0.07,
  /** Pitch (Hz) when stopped and at top speed. */
  idleHz: 38,
  topHz: 115,
  topSpeed: 115,
};

const SCREECH = {
  level: 0.11,
  /** Screech when turning faster than this (radians per second)... */
  turnRate: 1.6,
  /** ...above this speed. */
  minSpeed: 35,
  seconds: 0.45,
  /** No new screech for this long after one. */
  cooldown: 0.9,
};

export class DrivingSounds {
  private out: {
    ctx: AudioContext;
    gain: GainNode;
    engine: OscillatorNode[];
    tone: BiquadFilterNode;
    noise: AudioBuffer;
    bus: GainNode;
  } | null = null;
  private lastHeading: number | null = null;
  private lastScreech = -Infinity;

  constructor(private readonly audio: ScannerAudio) {}

  /** Call every frame. `driving` is false on foot, during the countdown and after the chase. */
  update(state: { driving: boolean; speed: number; heading: number }, deltaMs: number): void {
    const out = this.out ?? this.connect();
    if (!out) return;
    const { ctx, gain, engine, tone } = out;
    const now = ctx.currentTime;
    const speed = state.driving ? state.speed : 0;
    gain.gain.setTargetAtTime(state.driving ? ENGINE.level : 0, now, 0.15);
    const share = Math.min(1, speed / ENGINE.topSpeed);
    const hz = ENGINE.idleHz + (ENGINE.topHz - ENGINE.idleHz) * share;
    engine[0]!.frequency.setTargetAtTime(hz, now, 0.12);
    engine[1]!.frequency.setTargetAtTime(hz * 2.01, now, 0.12);
    tone.frequency.setTargetAtTime(300 + share * 900, now, 0.2);

    if (this.lastHeading !== null && state.driving && deltaMs > 0) {
      let turn = state.heading - this.lastHeading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const rate = Math.abs(turn) / (deltaMs / 1000);
      if (rate > SCREECH.turnRate && speed > SCREECH.minSpeed && now - this.lastScreech > SCREECH.cooldown) {
        this.lastScreech = now;
        this.screech(now, Math.min(1, speed / ENGINE.topSpeed));
      }
    }
    this.lastHeading = state.heading;
  }

  stop(): void {
    if (!this.out) return;
    const { ctx, gain, engine } = this.out;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    for (const osc of engine) osc.stop(ctx.currentTime + 0.6);
    this.out = null;
  }

  private connect(): DrivingSounds['out'] {
    const output = this.audio.musicOutput();
    if (!output) return null;
    const { ctx, bus } = output;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 400;
    tone.Q.value = 2;
    tone.connect(gain).connect(bus);
    const engine = (['sawtooth', 'square'] as OscillatorType[]).map((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = ENGINE.idleHz * (i + 1);
      const level = ctx.createGain();
      level.gain.value = i === 0 ? 1 : 0.35;
      osc.connect(level).connect(tone);
      osc.start();
      return osc;
    });
    const frames = Math.ceil(ctx.sampleRate * SCREECH.seconds);
    const noise = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    this.out = { ctx, gain, engine, tone, noise, bus };
    return this.out;
  }

  /** Tyre squeal: narrow-band noise that slides down in pitch. */
  private screech(t: number, strength: number): void {
    const { ctx, noise, bus } = this.out!;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 18;
    band.frequency.setValueAtTime(2600, t);
    band.frequency.linearRampToValueAtTime(1900, t + SCREECH.seconds);
    const gain = ctx.createGain();
    const peak = SCREECH.level * (0.6 + 0.4 * strength);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + SCREECH.seconds);
    source.connect(band).connect(gain).connect(bus);
    source.start(t);
    source.stop(t + SCREECH.seconds + 0.05);
  }
}
