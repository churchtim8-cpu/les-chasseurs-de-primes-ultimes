import type { ScannerAudio } from './ScannerAudio';
import { glide } from './synth';

/**
 * Car sounds, synthesised live with Web Audio: an engine hum whose pitch
 * follows the speed, a long tyre screech as the car drifts round a corner,
 * and a classic American police siren (the rising and falling "wail") while
 * the chase is on. They play on
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
  level: 0.26,
  /** Screech when turning faster than this (radians per second)... */
  turnRate: 0.9,
  /** ...above this speed. */
  minSpeed: 20,
  /** A squeal that lasts the whole drift round the corner. */
  seconds: 0.7,
  /** No new screech for this long after one. */
  cooldown: 0.8,
  /** Pitch of the tyre whine (Hz), with a fast wobble. */
  whineHz: 1150,
  wobbleHz: 28,
  wobbleDepth: 70,
};

const SIREN = {
  /** Siren level while driving (below the engine's share of the mix once it ducks). */
  level: 0.04,
  /** The wail sweeps smoothly between these pitches (Hz)... */
  lowHz: 650,
  highHz: 1350,
  /** ...rising and falling once every this many seconds. */
  sweepSeconds: 3.6,
};

export class DrivingSounds {
  private out: {
    ctx: AudioContext;
    gain: GainNode;
    engine: OscillatorNode[];
    tone: BiquadFilterNode;
    noise: AudioBuffer;
    bus: GainNode;
    siren: GainNode;
    sirenNodes: OscillatorNode[];
  } | null = null;
  private lastHeading: number | null = null;
  private lastScreech = -Infinity;

  constructor(private readonly audio: ScannerAudio) {}

  /**
   * Call every frame. `driving` is false on foot, during the countdown and
   * after the chase. `siren` (default: while driving) is false for a car with
   * no siren: the fugitive's in Escape Mode, which hears the police's instead
   * when they are close.
   */
  update(state: { driving: boolean; speed: number; heading: number; siren?: boolean }, deltaMs: number): void {
    // The sound system was rebuilt (see ScannerAudio's watchdog): reconnect to the new one.
    if (this.out && !this.audio.owns(this.out.ctx)) this.out = null;
    const out = this.out ?? this.connect();
    if (!out) return;
    const { ctx, gain, engine, tone } = out;
    const now = ctx.currentTime;
    const speed = state.driving ? state.speed : 0;
    glide(gain.gain, state.driving ? ENGINE.level : 0, now, 0.15);
    const share = Math.min(1, speed / ENGINE.topSpeed);
    const hz = ENGINE.idleHz + (ENGINE.topHz - ENGINE.idleHz) * share;
    glide(engine[0]!.frequency, hz, now, 0.12);
    glide(engine[1]!.frequency, hz * 2.01, now, 0.12);
    glide(tone.frequency, 300 + share * 900, now, 0.2);
    glide(out.siren.gain, (state.siren ?? state.driving) ? SIREN.level : 0, now, 0.25);

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
    const { ctx, gain, engine, siren, sirenNodes } = this.out;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    siren.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    for (const osc of [...engine, ...sirenNodes]) osc.stop(ctx.currentTime + 0.6);
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
    const { siren, nodes: sirenNodes } = this.connectSiren(ctx, bus);
    this.out = { ctx, gain, engine, tone, noise, bus, siren, sirenNodes };
    return this.out;
  }

  /**
   * American "wail" siren: one horn-like voice whose pitch glides smoothly up
   * and down between the two pitches, driven by a slow triangle wave, with a
   * second voice an octave below for body and a filter to keep it from
   * sounding harsh.
   */
  private connectSiren(ctx: AudioContext, bus: GainNode): { siren: GainNode; nodes: OscillatorNode[] } {
    const siren = ctx.createGain();
    siren.gain.value = 0;
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 2600;
    soften.connect(siren).connect(bus);
    const middle = (SIREN.lowHz + SIREN.highHz) / 2;
    const sweep = ctx.createOscillator();
    sweep.type = 'triangle';
    sweep.frequency.value = 1 / SIREN.sweepSeconds;
    const voices = (['square', 'triangle'] as OscillatorType[]).map((type, i) => {
      const voice = ctx.createOscillator();
      voice.type = type;
      const octave = i === 0 ? 1 : 0.5;
      voice.frequency.value = middle * octave;
      const depth = ctx.createGain();
      depth.gain.value = ((SIREN.highHz - SIREN.lowHz) / 2) * octave;
      sweep.connect(depth).connect(voice.frequency);
      const level = ctx.createGain();
      level.gain.value = i === 0 ? 0.35 : 1;
      voice.connect(level).connect(soften);
      return voice;
    });
    for (const osc of [sweep, ...voices]) osc.start();
    return { siren, nodes: [sweep, ...voices] };
  }

  /** Tyre squeal: a wobbling whine over a band of hiss, sliding down in pitch. */
  private screech(t: number, strength: number): void {
    const { ctx, noise, bus } = this.out!;
    const end = t + SCREECH.seconds;
    const gain = ctx.createGain();
    const peak = SCREECH.level * (0.6 + 0.4 * strength);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    gain.gain.setValueAtTime(peak, end - 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(bus);

    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.setValueAtTime(SCREECH.whineHz, t);
    whine.frequency.linearRampToValueAtTime(SCREECH.whineHz * 0.8, end);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = SCREECH.wobbleHz;
    const depth = ctx.createGain();
    depth.gain.value = SCREECH.wobbleDepth;
    wobble.connect(depth).connect(whine.frequency);
    const whineBand = ctx.createBiquadFilter();
    whineBand.type = 'bandpass';
    whineBand.frequency.value = SCREECH.whineHz;
    whineBand.Q.value = 3;
    const whineLevel = ctx.createGain();
    whineLevel.gain.value = 0.35;
    whine.connect(whineBand).connect(whineLevel).connect(gain);

    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    const hissBand = ctx.createBiquadFilter();
    hissBand.type = 'bandpass';
    hissBand.Q.value = 5;
    hissBand.frequency.setValueAtTime(2400, t);
    hissBand.frequency.linearRampToValueAtTime(1800, end);
    hiss.connect(hissBand).connect(gain);

    for (const source of [whine, wobble, hiss]) {
      source.start(t);
      source.stop(end + 0.05);
    }
  }
}
