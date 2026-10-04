import type { ScannerAudio } from './ScannerAudio';
import { glide } from './synth';

/**
 * Foot-chase sounds, synthesised live with Web Audio: a soft footstep with
 * every stride and faint, quick breathing that gets heavier at a run. They
 * play on the music bus, so they drop right down while the French is spoken.
 * Silent in the car. Sound design only (game code, not the engine).
 */

const STEP = {
  /** Footstep level, and how long each one lasts (s). */
  level: 0.16,
  seconds: 0.07,
  /** Pitch of the thud (Hz, low-pass cutoff). */
  toneHz: 520,
};

const BREATH = {
  /** Breathing level at a run, and walking (a share of it). */
  level: 0.035,
  walking: 0.4,
  /** One breath (in and out) lasts this long at a run, and walking (s). */
  runSeconds: 0.75,
  walkSeconds: 1.6,
  /** Running speed (game units) for the full effect. */
  runSpeed: 26,
  /** Breath hiss band (Hz) for breathing in and out. */
  inHz: 1500,
  outHz: 900,
};

export class FootSounds {
  private out: {
    ctx: AudioContext;
    bus: GainNode;
    noise: AudioBuffer;
    breath: GainNode;
    breathBand: BiquadFilterNode;
    hiss: AudioBufferSourceNode;
  } | null = null;
  private lastStep: number | null = null;
  private phase = 0;

  constructor(private readonly audio: ScannerAudio) {}

  /** Call every frame. `running` is false in the car, during the countdown and after the chase. */
  update(state: { running: boolean; speed: number; stride: number }, deltaMs: number): void {
    // The sound system was rebuilt (see ScannerAudio's watchdog): reconnect to the new one.
    if (this.out && !this.audio.owns(this.out.ctx)) this.out = null;
    const out = this.out ?? this.connect();
    if (!out) return;
    const { ctx, breath, breathBand } = out;
    const now = ctx.currentTime;
    const effort = state.running ? Math.min(1, state.speed / BREATH.runSpeed) : 0;

    // A step each half stride (the runner's feet swing on sin(stride)).
    const step = Math.floor(state.stride / Math.PI);
    if (state.running && state.speed > 1 && this.lastStep !== null && step !== this.lastStep) this.footstep(now, effort);
    this.lastStep = step;

    // Breathing: in, then out, faster and louder at a run.
    const seconds = BREATH.walkSeconds + (BREATH.runSeconds - BREATH.walkSeconds) * effort;
    this.phase = (this.phase + deltaMs / 1000 / seconds) % 1;
    const shape = Math.pow(Math.sin(this.phase * Math.PI * 2) ** 2, 1.5);
    const level = state.running ? BREATH.level * (BREATH.walking + (1 - BREATH.walking) * effort) * shape : 0;
    glide(breath.gain, level, now, 0.03);
    glide(breathBand.frequency, this.phase < 0.5 ? BREATH.inHz : BREATH.outHz, now, 0.05);
  }

  stop(): void {
    if (!this.out) return;
    const { ctx, breath, hiss } = this.out;
    breath.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    hiss.stop(ctx.currentTime + 0.3);
    this.out = null;
  }

  private connect(): FootSounds['out'] {
    const output = this.audio.musicOutput();
    if (!output) return null;
    const { ctx, bus } = output;
    const frames = ctx.sampleRate * 2;
    const noise = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const breath = ctx.createGain();
    breath.gain.value = 0;
    const breathBand = ctx.createBiquadFilter();
    breathBand.type = 'bandpass';
    breathBand.frequency.value = BREATH.inHz;
    breathBand.Q.value = 0.9;
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    hiss.connect(breathBand).connect(breath).connect(bus);
    hiss.start();
    this.out = { ctx, bus, noise, breath, breathBand, hiss };
    return this.out;
  }

  /** A soft thud on the pavement: a short burst of low noise. */
  private footstep(t: number, effort: number): void {
    const { ctx, bus, noise } = this.out!;
    const end = t + STEP.seconds;
    const gain = ctx.createGain();
    const peak = STEP.level * (0.55 + 0.45 * effort);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    // Slight variation so the steps do not sound machine-made.
    tone.frequency.value = STEP.toneHz * (0.85 + Math.random() * 0.3);
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.connect(tone).connect(gain).connect(bus);
    source.start(t, Math.random() * 1.5, STEP.seconds + 0.02);
  }
}
