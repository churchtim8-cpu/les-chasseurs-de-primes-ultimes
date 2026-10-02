/**
 * Small Web Audio building blocks shared by the menu music, the results
 * jingles and the interface sounds: envelopes, oscillators, noise hits and a
 * few instruments (timpani, brass, strings). Everything is synthesised live,
 * so there are no files to load and no credits to spend. Game code, so it
 * may use Math.random.
 */
export class Synth {
  readonly noise: AudioBuffer;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly out: AudioNode,
  ) {
    const frames = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Attack-decay envelope: silent, up to `peak` in `attack` seconds, then down over `decay`. */
  env(t: number, peak: number, attack: number, decay: number, into: AudioNode = this.out): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    gain.connect(into);
    return gain;
  }

  /** Attack, hold, release envelope for held notes. */
  hold(t: number, peak: number, attack: number, length: number, release: number, into: AudioNode = this.out): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, t + Math.max(attack, length));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, length) + release);
    gain.connect(into);
    return gain;
  }

  osc(type: OscillatorType, f: number, t: number, length: number, into: AudioNode): OscillatorNode {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    osc.connect(into);
    osc.start(t);
    osc.stop(t + length);
    return osc;
  }

  lowpass(f: number, into: AudioNode, q = 0.8): BiquadFilterNode {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = f;
    filter.Q.value = q;
    filter.connect(into);
    return filter;
  }

  noiseHit(t: number, level: number, length: number, type: BiquadFilterType, f: number, into: AudioNode = this.out): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = type;
    band.frequency.value = f;
    source.connect(band).connect(this.env(t, level, 0.002, length, into));
    source.start(t, Math.random() * 0.4);
    source.stop(t + length + 0.05);
  }

  /** Orchestral drum: a low sine that drops in pitch, with a soft skin thud. */
  timpani(t: number, f: number, level = 0.5): void {
    const gain = this.env(t, level, 0.004, 1.1);
    const osc = this.osc('sine', f * 1.5, t, 1.2, gain);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    this.osc('sine', f * 2.01, t, 0.5, this.env(t, level * 0.25, 0.004, 0.4));
    this.noiseHit(t, level * 0.3, 0.12, 'lowpass', 600);
  }

  /** Brass: detuned saws whose filter opens as the note speaks. */
  brass(t: number, f: number, length: number, level = 0.12): void {
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 1.5;
    tone.frequency.setValueAtTime(400, t);
    tone.frequency.exponentialRampToValueAtTime(2600, t + 0.08);
    tone.frequency.exponentialRampToValueAtTime(1400, t + Math.max(0.1, length));
    tone.connect(this.hold(t, level, 0.03, length, 0.18));
    for (const detune of [-8, 0, 8]) this.osc('sawtooth', f, t, length + 0.25, tone).detune.value = detune;
  }

  /** Soft string pad: slow attack, detuned saws through a gentle filter. */
  strings(t: number, f: number, length: number, level = 0.05): void {
    const tone = this.lowpass(1300, this.hold(t, level, 0.35, length, 0.5));
    for (const detune of [-12, -4, 5, 11]) this.osc('sawtooth', f, t, length + 0.6, tone).detune.value = detune;
  }
}

/** Frequency of a note `semitones` above a base frequency. */
export const note = (base: number, semitones: number): number => base * 2 ** (semitones / 12);

export const D2 = 73.42;
export const D3 = 146.83;
export const D4 = 293.66;
