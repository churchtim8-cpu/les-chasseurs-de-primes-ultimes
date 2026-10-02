import { MenuMusic } from './MenuMusic';
import { scannerAudio, type ScannerAudio } from './ScannerAudio';
import { D2, D3, D4, note, Synth } from './synth';

/**
 * Short sounds outside the chase, synthesised live with Web Audio: a tick
 * when a menu choice is highlighted, a confirm blip when one is pressed, a
 * victory fanfare for a capture and a sad trombone for an escape.
 */
export class Jingles {
  constructor(private readonly audio: ScannerAudio) {}

  /** Highlighting a different button. */
  move(): void {
    const s = this.effects();
    if (!s) return;
    const t = s.ctx.currentTime + 0.005;
    s.osc('sine', 1180, t, 0.06, s.env(t, 0.18, 0.003, 0.05));
  }

  /** Pressing a button: two quick rising notes. */
  select(): void {
    const s = this.effects();
    if (!s) return;
    const t = s.ctx.currentTime + 0.005;
    s.osc('square', 660, t, 0.08, s.lowpass(2400, s.env(t, 0.12, 0.003, 0.07)));
    s.osc('square', 990, t + 0.07, 0.12, s.lowpass(2800, s.env(t + 0.07, 0.14, 0.003, 0.11)));
  }

  /** Capture: a brass fanfare in D major with timpani and cymbal, about five seconds. */
  victory(): void {
    const s = this.music();
    if (!s) return;
    const t = s.ctx.currentTime + 0.05;
    const triplet = 0.13;
    // Da-da-da DAAA, da-da-da DAAA (higher), then a held D major chord.
    const calls: [number, number, number][] = [
      [0, 0, triplet], [triplet, 0, triplet], [triplet * 2, 0, triplet], [triplet * 3, 7, 0.55],
      [0.95, 5, triplet], [0.95 + triplet, 5, triplet], [0.95 + triplet * 2, 5, triplet], [0.95 + triplet * 3, 9, 0.55],
      [1.9, 12, 2.2],
    ];
    for (const [at, pitch, length] of calls) s.brass(t + at, note(D4, pitch), length, 0.11);
    for (const p of [0, 4, 7]) s.brass(t + 1.9, note(D3, p), 2.2, 0.07);
    for (const p of [0, 4, 7, 12]) s.strings(t + 1.9, note(D3, p + 12), 2.4, 0.04);
    s.timpani(t, note(D2, 0), 0.5);
    s.timpani(t + 0.95, note(D2, 7), 0.5);
    for (let i = 0; i < 8; i++) s.timpani(t + 1.5 + i * 0.05, note(D2, 0), 0.15 + i * 0.04);
    s.timpani(t + 1.9, note(D2, 0), 0.7);
    s.noiseHit(t + 1.9, 0.22, 2.4, 'highpass', 4500);
  }

  /** Escape: a sad "wah wah wah waaah" trombone sliding down, then a low minor chord. */
  defeat(): void {
    const s = this.music();
    if (!s) return;
    const t = s.ctx.currentTime + 0.05;
    const steps: [number, number, number][] = [
      [0, -2, 0.4], [0.45, -3, 0.4], [0.9, -4, 0.4], [1.35, -5, 1.4],
    ];
    for (const [at, pitch, length] of steps) {
      const start = t + at;
      // The "wah": the filter opens and closes on each note, like a plunger mute.
      const wah = s.ctx.createBiquadFilter();
      wah.type = 'lowpass';
      wah.Q.value = 4;
      wah.frequency.setValueAtTime(350, start);
      wah.frequency.linearRampToValueAtTime(1500, start + 0.12);
      wah.frequency.linearRampToValueAtTime(500, start + length);
      wah.connect(s.hold(start, 0.16, 0.04, length, 0.25));
      const f = note(D3, pitch);
      const voice = s.osc('sawtooth', f, start, length + 0.3, wah);
      if (length > 1) {
        // The last note wobbles.
        const wobble = s.ctx.createOscillator();
        wobble.frequency.value = 5.5;
        const depth = s.ctx.createGain();
        depth.gain.value = f * 0.03;
        wobble.connect(depth).connect(voice.frequency);
        wobble.start(start + 0.3);
        wobble.stop(start + length + 0.3);
      }
    }
    for (const p of [-17, -14, -10]) s.strings(t + 1.35, note(D3, p + 12), 2.2, 0.05);
    s.timpani(t + 1.35, note(D2, -5), 0.45);
  }

  private readonly synths = new Map<AudioNode, Synth>();

  private effects(): Synth | null {
    return this.synthFor(this.audio.effectsOutput());
  }

  private music(): Synth | null {
    return MenuMusic.muted ? null : this.synthFor(this.audio.musicOutput());
  }

  private synthFor(out: { ctx: AudioContext; bus: GainNode } | null): Synth | null {
    if (!out) return null;
    let synth = this.synths.get(out.bus);
    if (!synth) this.synths.set(out.bus, (synth = new Synth(out.ctx, out.bus)));
    return synth;
  }
}

export const jingles = new Jingles(scannerAudio);
export const menuMusic = new MenuMusic(scannerAudio);
