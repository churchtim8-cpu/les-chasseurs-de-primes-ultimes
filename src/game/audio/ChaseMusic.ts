import type { TravelMode } from '../../engine/world/graph';
import type { ScannerAudio } from './ScannerAudio';
import { glide } from './synth';
import { Lookahead } from './lookahead';

/**
 * Dramatic chase music, synthesised live with Web Audio (no files, no
 * credits). It plays on the scanner's music bus, so it drops right down while
 * the French is spoken. Two grooves make the two kinds of chase feel
 * different:
 *
 *   CAR:  driving D minor bass ostinato, big drums, string stabs.
 *   FOOT: faster, lighter: heartbeat kick, ticking shaker, high plucks.
 *
 * `intensity` (0..1, how close the suspect is) opens the filter and adds
 * more percussion as the player closes in. Sound design only: it may use
 * Math.random (this is game code, not the engine).
 */

interface Groove {
  bpm: number;
  /** 16 steps per bar. */
  kick: number[];
  snare: number[];
  hat: number[];
  /** Bass note per step (semitones above D2), or null for a rest. */
  bass: (number | null)[];
  /** Pluck/stab note per step (semitones above D4), or null. */
  lead: (number | null)[];
}

const n = null;
const GROOVES: Record<TravelMode, Groove[]> = {
  CAR: [
    {
      bpm: 132,
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
      bass: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 3, 3, 1, 1],
      lead: [0, n, n, n, n, n, n, n, 3, n, n, n, 2, n, n, n],
    },
    {
      bpm: 132,
      kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1],
      hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1],
      bass: [-2, -2, 10, -2, -2, -2, 10, -2, -4, -4, 8, -4, -5, -5, -3, -1],
      lead: [-2, n, n, n, n, n, n, n, -4, n, n, n, -5, n, 1, n],
    },
  ],
  FOOT: [
    {
      bpm: 150,
      kick: [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      bass: [0, n, n, n, n, n, n, n, 0, n, n, n, n, n, n, n],
      lead: [12, n, 15, n, 14, n, 12, n, 10, n, 12, n, 7, n, 8, n],
    },
    {
      bpm: 150,
      kick: [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
      hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      bass: [-2, n, n, n, n, n, n, n, -4, n, n, n, n, n, n, n],
      lead: [10, n, 14, n, 12, n, 10, n, 8, n, 10, n, 13, n, 12, n],
    },
  ],
};

/** Overall music level (the French always comes first). */
const LEVEL = 0.32;
/**
 * Notes are booked this far ahead on the audio clock (s). A slow school
 * computer can leave the timer waiting several tenths of a second between
 * ticks, so a short look-ahead made notes land late and the music stutter.
 */
const LOOKAHEAD = 0.6;
const MUTE_KEY = 'bellevue.music';

export class ChaseMusic {
  private mode: TravelMode = 'CAR';
  private intensity = 0;
  private timer: number | null = null;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private readonly ahead = new Lookahead(LOOKAHEAD);
  private out: { ctx: BaseAudioContext; gain: GainNode; filter: BiquadFilterNode; noise: AudioBuffer } | null = null;
  private muted: boolean;

  constructor(private readonly audio: ScannerAudio | null) {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(MUTE_KEY);
    } catch {
      // storage blocked: music on
    }
    this.muted = stored === 'off' || new URLSearchParams(window.location.search).get('music') === '0';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.out) {
      const { ctx, gain } = this.out;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      const old = gain;
      window.setTimeout(() => old.disconnect(), 800);
    }
    this.out = null;
  }

  setMode(mode: TravelMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Start the new groove on the next bar, with a crash to mark the change.
    this.step = 0;
    this.bar = 0;
    if (this.out) this.crash(this.nextTime);
  }

  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      window.localStorage.setItem(MUTE_KEY, this.muted ? 'off' : 'on');
    } catch {
      // storage blocked: the choice lasts this visit only
    }
    if (this.out) this.out.gain.gain.setTargetAtTime(this.muted ? 0 : LEVEL, this.out.ctx.currentTime, 0.1);
    return this.muted;
  }

  /** Render `seconds` of one groove without playing it (to listen to or check the music offline). */
  static async render(mode: TravelMode, seconds: number, intensity = 0.5): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
    const music = new ChaseMusic(null);
    music.muted = false;
    music.mode = mode;
    music.intensity = intensity;
    music.connect(ctx, ctx.destination);
    music.schedule(seconds);
    return ctx.startRendering();
  }

  private connect(ctx: BaseAudioContext, bus: AudioNode): void {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(this.muted ? 0 : LEVEL, ctx.currentTime, 0.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600 + this.intensity * 5000;
    filter.connect(gain).connect(bus);
    const frames = ctx.sampleRate;
    const noise = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    this.out = { ctx, gain, filter, noise };
    this.nextTime = ctx.currentTime + 0.1;
  }

  private tick(): void {
    // The sound system was rebuilt (see ScannerAudio's watchdog): start again on the new one.
    if (this.out && this.audio && !this.audio.owns(this.out.ctx)) this.out = null;
    if (!this.out) {
      const output = this.audio?.musicOutput();
      if (!output) return;
      this.connect(output.ctx, output.bus);
    }
    const { ctx, filter } = this.out!;
    glide(filter.frequency, 1600 + this.intensity * 5000, ctx.currentTime, 0.5);
    // After a long stall (a hidden tab), skip the missed beats rather than play them all at once.
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    this.schedule(ctx.currentTime + this.ahead.next());
  }

  /** Schedule every step that starts before `until` (seconds on the audio clock). */
  private schedule(until: number): void {
    while (this.nextTime < until) {
      this.playStep(this.nextTime);
      const groove = this.groove();
      this.nextTime += 60 / groove.bpm / 4;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  private groove(): Groove {
    const grooves = GROOVES[this.mode];
    return grooves[Math.floor(this.bar / 2) % grooves.length]!;
  }

  private playStep(t: number): void {
    const g = this.groove();
    const s = this.step;
    const foot = this.mode === 'FOOT';
    if (g.kick[s]) this.kick(t, foot ? 0.9 : 1);
    if (g.snare[s]) this.snare(t);
    const extraHats = this.intensity > 0.6 && !foot;
    if (g.hat[s] || (extraHats && s % 2 === 1)) this.hat(t, foot ? 0.05 : s % 4 === 0 ? 0.09 : 0.05);
    const bass = g.bass[s];
    if (bass !== null && bass !== undefined) this.bass(t, 73.42 * 2 ** (bass / 12), foot ? 0.5 : 0.11);
    const lead = g.lead[s];
    if (lead !== null && lead !== undefined) {
      const f = 293.66 * 2 ** (lead / 12);
      if (foot) this.pluck(t, f);
      else this.stab(t, f);
    }
    if (s === 0 && this.bar % 4 === 0) this.crash(t);
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const gain = this.out!.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return gain;
  }

  private osc(type: OscillatorType, f: number, t: number, length: number, into: AudioNode): OscillatorNode {
    const osc = this.out!.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    osc.connect(into);
    osc.start(t);
    osc.stop(t + length);
    return osc;
  }

  private kick(t: number, level: number): void {
    const gain = this.env(t, level, 0.003, 0.35);
    gain.connect(this.out!.filter);
    const osc = this.osc('sine', 120, t, 0.4, gain);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.25);
  }

  private noiseHit(t: number, level: number, length: number, type: BiquadFilterType, f: number): void {
    const { ctx, noise, filter } = this.out!;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = type;
    band.frequency.value = f;
    const gain = this.env(t, level, 0.002, length);
    source.connect(band).connect(gain).connect(filter);
    source.start(t, Math.random() * 0.5);
    source.stop(t + length + 0.05);
  }

  private snare(t: number): void {
    this.noiseHit(t, 0.35, 0.18, 'bandpass', 1800);
    const gain = this.env(t, 0.25, 0.002, 0.1);
    gain.connect(this.out!.filter);
    this.osc('triangle', 190, t, 0.12, gain);
  }

  private hat(t: number, level: number): void {
    this.noiseHit(t, level, 0.04, 'highpass', 8000);
  }

  private crash(t: number): void {
    this.noiseHit(t, 0.12, 1.2, 'highpass', 5000);
  }

  private bass(t: number, f: number, length: number): void {
    const { ctx, filter } = this.out!;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(900, t);
    tone.frequency.exponentialRampToValueAtTime(180, t + length);
    const gain = this.env(t, 0.32, 0.005, length);
    tone.connect(gain).connect(filter);
    this.osc('sawtooth', f, t, length + 0.05, tone);
    this.osc('square', f / 2, t, length + 0.05, tone);
  }

  /** Short brass-like stab: a minor chord on detuned saws. */
  private stab(t: number, f: number): void {
    const gain = this.env(t, 0.1, 0.01, 0.5);
    gain.connect(this.out!.filter);
    for (const ratio of [1, 1.189, 1.498]) {
      this.osc('sawtooth', f * ratio, t, 0.6, gain).detune.value = (Math.random() - 0.5) * 14;
    }
  }

  private pluck(t: number, f: number): void {
    const gain = this.env(t, 0.13, 0.003, 0.18);
    gain.connect(this.out!.filter);
    this.osc('triangle', f, t, 0.22, gain);
    const click = this.env(t, 0.03, 0.002, 0.06);
    click.connect(this.out!.filter);
    this.osc('square', f * 2, t, 0.08, click);
  }
}
