import type { TravelMode } from '../../engine/world/graph';
import type { ScannerAudio } from './ScannerAudio';
import { glide } from './synth';
import { LOOP_RATE, endLoop, playLoop, renderLoop } from './loopRender';

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
const MUTE_KEY = 'bellevue.music';

type LoopName = 'CAR' | 'CAR_HOT' | 'FOOT';
/** Notes still ringing past a loop's end (s), folded back onto its start. */
const TAIL = 1.6;
/** Bars in each recorded loop: both grooves of the mode, two bars each, a crash at the start. */
const LOOP_BARS = 4;
/** The extra off-beat hats join in when the suspect is this close (intensity). */
const HOT = 0.6;

let recording: Promise<Record<LoopName, AudioBuffer>> | null = null;
let recorded: Record<LoopName, AudioBuffer> | null = null;

interface LiveLoop {
  mode: TravelMode;
  main: { source: AudioBufferSourceNode; gain: GainNode };
  /** CAR only: the extra off-beat hats, in step with the main loop, faded in when the suspect is close. */
  hot: { source: AudioBufferSourceNode; gain: GainNode } | null;
}

export class ChaseMusic {
  private mode: TravelMode = 'CAR';
  private intensity = 0;
  private timer: number | null = null;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  /** Recording only the extra hats a close suspect adds (see `HOT`). */
  private extrasOnly = false;
  /** Where notes go while a loop is being recorded. */
  private out: { ctx: BaseAudioContext; filter: AudioNode; noise: AudioBuffer } | null = null;
  /** The recorded loops playing on the live sound system. */
  private live: { ctx: BaseAudioContext; gain: GainNode; filter: BiquadFilterNode; loop: LiveLoop | null } | null = null;
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

  /** Record the chase loops (once per visit), ready before the first chase. */
  static prepare(): Promise<Record<LoopName, AudioBuffer>> {
    recording ??= (async () => {
      const loops = {
        CAR: await ChaseMusic.record('CAR', false),
        CAR_HOT: await ChaseMusic.record('CAR', true),
        FOOT: await ChaseMusic.record('FOOT', false),
      };
      recorded = loops;
      return loops;
    })();
    return recording;
  }

  private static record(mode: TravelMode, hot: boolean): Promise<AudioBuffer> {
    const seconds = (LOOP_BARS * 4 * 60) / GROOVES[mode][0]!.bpm;
    return renderLoop(seconds, TAIL, (ctx, out) => {
      const music = new ChaseMusic(null);
      music.mode = mode;
      music.intensity = hot ? 1 : 0;
      music.extrasOnly = hot;
      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      music.out = { ctx, filter: out, noise };
      music.nextTime = 0;
      music.schedule(seconds - 1e-6);
    });
  }

  get isMuted(): boolean {
    return this.muted;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 50);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.live) {
      const { ctx, gain, loop } = this.live;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      if (loop) this.endLoop(loop, 0.8);
      window.setTimeout(() => gain.disconnect(), 1200);
    }
    this.live = null;
  }

  setMode(mode: TravelMode): void {
    // The new mode's loop starts from its first bar, with its crash, on the next tick.
    this.mode = mode;
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
    if (this.live) this.live.gain.gain.setTargetAtTime(this.muted ? 0 : LEVEL, this.live.ctx.currentTime, 0.1);
    return this.muted;
  }

  /** Render `seconds` of one groove without playing it (to listen to or check the music offline). */
  static async render(mode: TravelMode, seconds: number, intensity = 0.5): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(2, Math.ceil(LOOP_RATE * seconds), LOOP_RATE);
    const music = new ChaseMusic(null);
    music.mode = mode;
    music.intensity = intensity;
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    music.out = { ctx, filter: ctx.destination, noise };
    music.nextTime = 0;
    music.schedule(seconds);
    return ctx.startRendering();
  }

  private tick(): void {
    // The sound system was rebuilt (see ScannerAudio's watchdog): start again on the new one.
    if (this.live && this.audio && !this.audio.owns(this.live.ctx)) this.live = null;
    if (!this.live) {
      const output = this.audio?.musicOutput();
      if (!output) return;
      const { ctx, bus } = output;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(this.muted ? 0 : LEVEL, ctx.currentTime, 0.4);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1600 + this.intensity * 5000;
      filter.connect(gain).connect(bus);
      this.live = { ctx, gain, filter, loop: null };
    }
    const live = this.live;
    const now = live.ctx.currentTime;
    glide(live.filter.frequency, 1600 + this.intensity * 5000, now, 0.5);
    // Switched off: nothing plays at all.
    if (this.muted) {
      if (live.loop) this.endLoop(live.loop);
      live.loop = null;
      return;
    }
    if (!recorded) {
      void ChaseMusic.prepare();
      return;
    }
    if (live.loop?.mode !== this.mode) {
      if (live.loop) this.endLoop(live.loop);
      const when = now + 0.05;
      const main = playLoop(live.ctx, this.mode === 'CAR' ? recorded.CAR : recorded.FOOT, live.filter, when);
      const hot = this.mode === 'CAR' ? playLoop(live.ctx, recorded.CAR_HOT, live.filter, when) : null;
      if (hot) hot.gain.gain.value = this.intensity > HOT ? 1 : 0;
      live.loop = { mode: this.mode, main, hot };
    }
    const loop = live.loop!;
    if (loop.hot) {
      // Closing in brings in the extra hats.
      glide(loop.hot.gain.gain, this.intensity > HOT ? 1 : 0, now, 0.15);
    }
  }

  private endLoop(loop: LiveLoop, fade = 0.08): void {
    if (!this.live) return;
    endLoop(this.live.ctx, loop.main, fade);
    if (loop.hot) endLoop(this.live.ctx, loop.hot, fade);
  }

  /** Schedule every step that starts before `until` (seconds on the recording's clock). */
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
    const extraHats = this.intensity > HOT && !foot;
    if (this.extrasOnly) {
      if (extraHats && s % 2 === 1 && !g.hat[s]) this.hat(t, 0.05);
      return;
    }
    if (g.kick[s]) this.kick(t, foot ? 0.9 : 1);
    if (g.snare[s]) this.snare(t);
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
