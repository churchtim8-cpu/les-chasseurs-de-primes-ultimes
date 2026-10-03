import { D2, D3, D4, note, Synth } from './synth';
import type { ScannerAudio } from './ScannerAudio';

/**
 * Dramatic title theme for the menus (title, case folder, briefing,
 * practice), synthesised live with Web Audio. It keeps playing from one menu
 * screen to the next and stops when a chase starts. An 8-bar loop in D minor
 * (Dm, B♭, Gm, A): timpani, brass stabs and a string ostinato build for four
 * bars, then a heroic brass melody comes in. Uses the same on/off choice as
 * the chase music (B).
 */

const BPM = 96;
const LEVEL = 0.3;
/** Notes are booked this far ahead on the audio clock (s), so a busy computer does not make them late. */
const LOOKAHEAD = 0.6;
const MUTE_KEY = 'bellevue.music';

const n = null;
/** Per bar of the progression: chord (semitones above D3) and root (above D2). */
const CHORDS: { pad: number[]; root: number }[] = [
  { pad: [0, 3, 7], root: 0 }, // D minor
  { pad: [-4, 0, 3], root: -4 }, // B♭ major
  { pad: [5, 8, 12], root: 5 }, // G minor
  { pad: [7, 11, 14], root: 7 }, // A major
];
/** Melody (semitones above D4) for each bar of the second half. */
const MELODY: (number | null)[][] = [
  [0, n, n, n, 7, n, n, n, 5, n, 3, n, 2, n, n, n],
  [-2, n, n, n, 5, n, n, n, 3, n, 2, n, 0, n, n, n],
  [-2, n, 0, n, 2, n, 3, n, 5, n, n, n, 7, n, n, n],
  [7, n, n, n, 2, n, n, n, -1, n, 2, n, 7, n, n, n],
];
const STABS = [0, 3, 6];

export class MenuMusic {
  private timer: number | null = null;
  private synth: Synth | null = null;
  private gain: GainNode | null = null;
  private step = 0;
  private bar = 0;
  private nextTime = 0;

  constructor(private readonly audio: ScannerAudio) {}

  static get muted(): boolean {
    try {
      if (window.localStorage.getItem(MUTE_KEY) === 'off') return true;
    } catch {
      // storage blocked: music on
    }
    return new URLSearchParams(window.location.search).get('music') === '0';
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** Start (or keep playing); it begins as soon as the browser allows sound. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 30);
  }

  stop(fade = 0.4): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.gain && this.synth) {
      const old = this.gain;
      old.gain.setTargetAtTime(0, this.synth.ctx.currentTime, fade / 3);
      window.setTimeout(() => old.disconnect(), fade * 1000 + 600);
    }
    this.gain = null;
    this.synth = null;
  }

  /** B on a menu screen: turn music off or on (remembered with the chase music's choice). */
  toggleMute(): void {
    const muted = !MenuMusic.muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? 'off' : 'on');
    } catch {
      // storage blocked
    }
    if (this.gain && this.synth) this.gain.gain.setTargetAtTime(muted ? 0 : LEVEL, this.synth.ctx.currentTime, 0.1);
  }

  private tick(): void {
    if (!this.synth) {
      const output = this.audio.musicOutput();
      if (!output) return;
      this.gain = output.ctx.createGain();
      this.gain.gain.value = MenuMusic.muted ? 0 : LEVEL;
      this.gain.connect(output.bus);
      this.synth = new Synth(output.ctx, this.gain);
      this.step = 0;
      this.bar = 0;
      this.nextTime = output.ctx.currentTime + 0.1;
      // A big opening hit.
      this.synth.timpani(this.nextTime, D2, 0.7);
      this.synth.noiseHit(this.nextTime, 0.16, 1.8, 'highpass', 4000);
    }
    const synth = this.synth;
    // After a long stall (a hidden tab), skip the missed beats rather than play them all at once.
    if (this.nextTime < synth.ctx.currentTime) this.nextTime = synth.ctx.currentTime + 0.05;
    while (this.nextTime < synth.ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.nextTime);
      this.nextTime += 60 / BPM / 4;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar = (this.bar + 1) % 8;
    }
  }

  private playStep(t: number): void {
    const synth = this.synth!;
    const s = this.step;
    const chord = CHORDS[this.bar % 4]!;
    const barSeconds = (60 / BPM) * 4;
    const sixteenth = 60 / BPM / 4;

    if (s === 0) for (const p of chord.pad) synth.strings(t, note(D3, p), barSeconds - 0.1);
    // Timpani on the beat that starts each bar and a pickup; a roll into the loop's end.
    if (s === 0 || s === 10) synth.timpani(t, note(D2, chord.root), s === 0 ? 0.55 : 0.35);
    if (this.bar % 4 === 3 && s >= 12) synth.timpani(t, note(D2, chord.root), 0.18 + (s - 12) * 0.06);
    // "Dun, dun, dun" brass stabs.
    if (STABS.includes(s)) for (const p of chord.pad) synth.brass(t, note(D3, p), sixteenth * 1.6, 0.045);
    // String ostinato on eighth notes.
    if (s % 2 === 0) {
      const octave = s % 4 === 0 ? 12 : 0;
      synth.osc('sawtooth', note(D3, chord.root + octave), t, sixteenth * 1.4, synth.lowpass(1800, synth.env(t, 0.05, 0.005, sixteenth * 1.3)));
    }
    if (this.bar >= 2 && s % 4 === 2) synth.noiseHit(t, 0.035, 0.05, 'highpass', 7500);
    if (s === 0 && this.bar % 4 === 0) synth.noiseHit(t, 0.08, 1.4, 'highpass', 5000);

    // Melody in the second half of the loop.
    if (this.bar >= 4) {
      const line = MELODY[this.bar - 4]!;
      const pitch = line[s];
      if (pitch !== null && pitch !== undefined) {
        let length = 1;
        while (s + length < 16 && line[s + length] === null) length++;
        synth.brass(t, note(D4, pitch), sixteenth * length * 0.92, 0.07);
      }
    }
  }
}
