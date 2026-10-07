import { D2, D3, D4, note, Synth } from './synth';
import type { ScannerAudio } from './ScannerAudio';
import { endLoop, playLoop, renderLoop } from './loopRender';

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

/** Bars in the loop and notes still ringing past its end (s), folded back onto its start. */
const LOOP_BARS = 8;
const TAIL = 2.5;

let recording: Promise<AudioBuffer> | null = null;
let recorded: AudioBuffer | null = null;

export class MenuMusic {
  private timer: number | null = null;
  private synth: Synth | null = null;
  private step = 0;
  private bar = 0;
  /** The recorded loop playing on the live sound system. */
  private live: { ctx: BaseAudioContext; gain: GainNode; loop: { source: AudioBufferSourceNode; gain: GainNode } | null } | null = null;

  constructor(private readonly audio: ScannerAudio) {}

  /** Record the loop once per visit (see loopRender): ready a moment after the game opens. */
  static prepare(): Promise<AudioBuffer> {
    recording ??= renderLoop((LOOP_BARS * 4 * 60) / BPM, TAIL, (ctx, out) => {
      const music = new MenuMusic(null as unknown as ScannerAudio);
      music.synth = new Synth(ctx, out);
      let t = 0;
      for (let k = 0; k < LOOP_BARS * 16; k++) {
        music.playStep(t);
        t += 60 / BPM / 4;
        music.step = (music.step + 1) % 16;
        if (music.step === 0) music.bar = (music.bar + 1) % 8;
      }
    }).then((loop) => (recorded = loop));
    return recording;
  }

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
    this.timer = window.setInterval(() => this.tick(), 100);
    this.tick();
  }

  stop(fade = 0.4): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.live) {
      const { ctx, gain, loop } = this.live;
      gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
      if (loop) endLoop(ctx, loop, fade + 0.5);
      window.setTimeout(() => gain.disconnect(), fade * 1000 + 600);
    }
    this.live = null;
  }

  /** B on a menu screen: turn music off or on (remembered with the chase music's choice). */
  toggleMute(): void {
    const muted = !MenuMusic.muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? 'off' : 'on');
    } catch {
      // storage blocked
    }
    if (this.live) this.live.gain.gain.setTargetAtTime(muted ? 0 : LEVEL, this.live.ctx.currentTime, 0.1);
  }

  private tick(): void {
    // The sound system was rebuilt (see ScannerAudio's watchdog): start again on the new one.
    if (this.live && !this.audio.owns(this.live.ctx)) this.live = null;
    if (!this.live) {
      const output = this.audio.musicOutput();
      if (!output) return;
      const gain = output.ctx.createGain();
      gain.gain.value = MenuMusic.muted ? 0 : LEVEL;
      gain.connect(output.bus);
      this.live = { ctx: output.ctx, gain, loop: null };
    }
    const live = this.live;
    // Switched off: nothing plays at all.
    if (MenuMusic.muted) {
      if (live.loop) endLoop(live.ctx, live.loop);
      live.loop = null;
      return;
    }
    if (!recorded) {
      void MenuMusic.prepare();
      return;
    }
    live.loop ??= playLoop(live.ctx, recorded, live.gain, live.ctx.currentTime + 0.05);
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
