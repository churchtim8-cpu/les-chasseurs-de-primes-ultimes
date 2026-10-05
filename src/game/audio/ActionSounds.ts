import { scannerAudio, type ScannerAudio } from './ScannerAudio';
import { Synth } from './synth';

/**
 * Sound effects for the action moments of a chase (arrests, crashes, the
 * suspect dodging away), synthesised live with Web Audio on the effects bus,
 * so they are not ducked under the French. No files, no credits.
 */
export class ActionSounds {
  private readonly synths = new Map<AudioNode, Synth>();

  constructor(private readonly audio: ScannerAudio) {}

  /** Tyres locking up: a squealing whine over hiss, sliding down in pitch. */
  screech(seconds = 1.2, level = 0.24): void {
    const s = this.synth();
    if (!s) return;
    const t = s.ctx.currentTime + 0.01;
    const end = t + seconds;
    const gain = s.hold(t, level, 0.04, seconds - 0.25, 0.25);
    const whine = s.osc('sawtooth', 1250, t, seconds + 0.1, s.lowpass(2600, this.band(s, 1150, 3, gain)));
    whine.frequency.linearRampToValueAtTime(820, end);
    const wobble = s.ctx.createOscillator();
    wobble.frequency.value = 26;
    const depth = s.ctx.createGain();
    depth.gain.value = 60;
    wobble.connect(depth).connect(whine.frequency);
    wobble.start(t);
    wobble.stop(end + 0.1);
    s.noiseHit(t, level * 1.4, seconds, 'bandpass', 2300, gain);
  }

  /** A heartbeat ("lub-dub"): two deep soft thumps, for the police right behind in Escape Mode. */
  heartbeat(level = 0.3): void {
    const s = this.synth();
    if (!s) return;
    const t = s.ctx.currentTime + 0.01;
    for (const [at, f, lv] of [
      [0, 64, level],
      [0.15, 54, level * 0.65],
    ] as const) {
      const thump = s.osc('sine', f, t + at, 0.24, s.lowpass(160, s.env(t + at, lv, 0.008, 0.2)));
      thump.frequency.exponentialRampToValueAtTime(f * 0.6, t + at + 0.2);
    }
  }

  /** A body hitting the ground: a deep thump with a soft scuff. */
  thud(level = 0.5): void {
    const s = this.synth();
    if (!s) return;
    const t = s.ctx.currentTime + 0.01;
    const body = s.osc('sine', 95, t, 0.4, s.env(t, level, 0.004, 0.32));
    body.frequency.exponentialRampToValueAtTime(42, t + 0.25);
    s.noiseHit(t, level * 0.5, 0.18, 'lowpass', 500);
    s.noiseHit(t + 0.04, level * 0.18, 0.35, 'bandpass', 1400);
  }

  /** A winded grunt as someone is knocked down. */
  oof(level = 0.16): void {
    const s = this.synth();
    if (!s) return;
    const t = s.ctx.currentTime + 0.02;
    const voice = s.osc('sawtooth', 190, t, 0.3, this.band(s, 700, 4, s.env(t, level, 0.02, 0.24)));
    voice.frequency.exponentialRampToValueAtTime(110, t + 0.25);
  }

  /** Handcuffs: two quick metallic clicks and a ratchet. */
  cuffs(delay = 0): void {
    const s = this.synth();
    if (!s) return;
    const t = s.ctx.currentTime + 0.01 + delay;
    for (const at of [0, 0.16]) {
      s.noiseHit(t + at, 0.3, 0.03, 'highpass', 3500);
      s.osc('square', 2400, t + at, 0.05, this.band(s, 2400, 8, s.env(t + at, 0.08, 0.002, 0.045)));
    }
    for (let i = 0; i < 6; i++) s.noiseHit(t + 0.32 + i * 0.03, 0.12, 0.012, 'highpass', 5000);
  }

  /** A car crash: a heavy bang, a metal clang and broken glass tinkling down. */
  crash(): void {
    const s = this.synth();
    if (!s) return;
    const t = s.ctx.currentTime + 0.01;
    s.noiseHit(t, 0.55, 0.5, 'lowpass', 1600);
    const boom = s.osc('sine', 80, t, 0.6, s.env(t, 0.6, 0.004, 0.5));
    boom.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    for (const f of [523, 787, 1131, 1490]) s.osc('triangle', f, t, 0.9, s.env(t, 0.06, 0.003, 0.8));
    for (let i = 0; i < 14; i++) {
      const at = t + 0.05 + Math.random() * 0.7;
      s.osc('sine', 3000 + Math.random() * 4000, at, 0.12, s.env(at, 0.04 + Math.random() * 0.04, 0.002, 0.1));
    }
  }

  /** Steam hissing out of a crashed car's bonnet. */
  steam(seconds = 2.5): void {
    const s = this.synth();
    if (!s) return;
    const t = s.ctx.currentTime + 0.3;
    const gain = s.hold(t, 0.06, 0.2, seconds, 0.8);
    const source = s.ctx.createBufferSource();
    source.buffer = s.noise;
    source.loop = true;
    const band = s.ctx.createBiquadFilter();
    band.type = 'highpass';
    band.frequency.value = 3000;
    source.connect(band).connect(gain);
    source.start(t);
    source.stop(t + seconds + 1);
  }

  /** A quick swish as the suspect dodges. */
  whoosh(): void {
    const s = this.synth();
    if (!s) return;
    const t = s.ctx.currentTime + 0.01;
    const band = s.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2;
    band.frequency.setValueAtTime(400, t);
    band.frequency.exponentialRampToValueAtTime(2200, t + 0.3);
    band.connect(s.hold(t, 0.3, 0.08, 0.15, 0.15));
    const source = s.ctx.createBufferSource();
    source.buffer = s.noise;
    source.connect(band);
    source.start(t);
    source.stop(t + 0.5);
  }

  /** The police siren's short "whoop" as the suspect is stopped. */
  whoop(): void {
    const s = this.synth();
    if (!s) return;
    const t = s.ctx.currentTime + 0.01;
    const voice = s.osc('square', 650, t, 0.6, s.lowpass(2400, s.env(t, 0.07, 0.02, 0.55)));
    voice.frequency.exponentialRampToValueAtTime(1400, t + 0.25);
    voice.frequency.exponentialRampToValueAtTime(700, t + 0.55);
  }

  private band(s: Synth, f: number, q: number, into: AudioNode): BiquadFilterNode {
    const filter = s.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = f;
    filter.Q.value = q;
    filter.connect(into);
    return filter;
  }

  private synth(): Synth | null {
    const out = this.audio.effectsOutput();
    if (!out) return null;
    let synth = this.synths.get(out.bus);
    if (!synth) this.synths.set(out.bus, (synth = new Synth(out.ctx, out.bus)));
    return synth;
  }
}

export const actionSounds = new ActionSounds(scannerAudio);
