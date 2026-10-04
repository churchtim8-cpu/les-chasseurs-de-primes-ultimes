import { EMPTY_MANIFEST, hasClips, type AudioManifest } from '../../engine/audio/manifest';

/** One spoken line in a sequence; `radio` lines go through the scanner filter. */
export interface SpokenLine {
  audioId: string;
  radio: boolean;
}

/** Mixer levels and scanner timings. Provisional: tune by ear in playtesting. */
const MIX = {
  scanner: 1,
  effects: 0.35,
  /** Music and ambience level while French is playing (blueprint section 17). */
  duckTo: 0.18,
  /** Sound effects drop to this share while French is playing, so a crash never drowns a call. */
  effectsDuckTo: 0.5,
  duckSeconds: 0.15,
  /** Radio band: telephone-like, still clear enough for learners. */
  radioLowCut: 300,
  radioHighCut: 3400,
  gapSeconds: 0.18,
  /**
   * Everything is turned down this much before the safety limiter, so the
   * limiter (which squashes the whole mix, the French included) almost never
   * has to act: when it did, calls and music audibly dipped and distorted.
   */
  master: 0.72,
  /** A clip that has not downloaded by then is given up on (the call still shows as text). */
  fetchSeconds: 5,
  /** At most this many calls wait their turn; older waiting ones are dropped. */
  maxWaiting: 2,
} as const;

/**
 * The police scanner's sound (blueprint section 17): radio beep, a little
 * static, the pre-recorded French, then a click. Clips come from the audio
 * manifest; a line with no recording still gets the beep and static so the
 * call is heard arriving while its text is shown.
 *
 * Buses: scanner (French), effects (beeps, static) and a music bus that ducks
 * while French plays, ready for the music and ambience of later milestones.
 */
export class ScannerAudio {
  private manifest: AudioManifest = EMPTY_MANIFEST;
  private ctx: AudioContext | null = null;
  private buses?: { scanner: GainNode; effects: GainNode; music: GainNode; radio: AudioNode; chirps: GainNode };
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private sources: AudioScheduledSourceNode[] = [];
  private busy: Promise<void> = Promise.resolve();
  private generation = 0;
  /** Calls up to this ticket were stopped (see stop). */
  private cancelled = 0;
  /** Calls queued that have not started yet. */
  private waiting = 0;
  /** The game is paused: sound stays frozen until it carries on (see pause). */
  private paused = false;
  /** Ends the wait for the call playing now (see stop). */
  private wake: (() => void) | null = null;
  /** The radio filter can be switched off (?radio=0) to hear the clean recordings. */
  radioFilter = new URLSearchParams(window.location.search).get('radio') !== '0';

  constructor(private readonly baseUrl: string) {
    // Browsers only start sound after a key press or tap. Every press also
    // wakes the sound back up if the browser or computer paused it.
    const unlock = () => this.unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.resume();
    });
  }

  setManifest(manifest: AudioManifest | undefined): void {
    this.manifest = manifest?.clips ? manifest : EMPTY_MANIFEST;
  }

  get library(): AudioManifest {
    return this.manifest;
  }

  get clipCount(): number {
    return Object.keys(this.manifest.clips).length;
  }

  has(audioId: string): boolean {
    return hasClips(this.manifest) && audioId in this.manifest.clips;
  }

  unlock(): void {
    try {
      if (!this.ctx) this.ctx = this.createContext();
      this.resume();
    } catch {
      this.ctx = null; // no Web Audio: the game still works with text
    }
  }

  /** Start the sound again if it was paused (another app took the speakers, a power saver, a hidden tab). */
  private resume(): void {
    const ctx = this.ctx;
    if (this.paused) return;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => undefined);
  }

  /** Start decoding clips in the background so the first call plays without delay. */
  preload(audioIds: Iterable<string>): void {
    for (const id of audioIds) void this.buffer(id);
  }

  /**
   * Play a scanner call. A newer call replaces one that is still waiting, and
   * the promise resolves when this call has finished (or been replaced).
   */
  play(lines: SpokenLine[]): Promise<void> {
    const ticket = ++this.generation;
    this.waiting++;
    // Calls play in order, one after another: the chase times each one to be heard in full.
    // (Two calls sent at once used to drop the first: an announcement just before a direction.)
    this.busy = this.busy.then(() => {
      this.waiting--;
      if (ticket <= this.cancelled || this.waiting >= MIX.maxWaiting) return undefined;
      return this.sequence(lines, ticket);
    });
    return this.busy;
  }

  /**
   * Where background music plays: the music bus, which ducks under the French.
   * Null until the browser allows sound (after the first key press or tap).
   */
  musicOutput(): { ctx: AudioContext; bus: GainNode } | null {
    if (!this.ctx || !this.buses || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, bus: this.buses.music };
  }

  /** Where short interface sounds play: the effects bus (it does not duck). Null until sound is allowed. */
  effectsOutput(): { ctx: AudioContext; bus: GainNode } | null {
    if (!this.ctx || !this.buses || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, bus: this.buses.effects };
  }

  /** True once the browser lets the game make sound. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * The pause menu freezes every sound where it is (a call carries on
   * mid-word afterwards); `pause(false)` lets it play on.
   */
  pause(on: boolean): void {
    this.paused = on;
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    if (on) ctx.suspend().catch(() => undefined);
    else this.resume();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Urgent news: cut off whatever is being said and say this now. */
  interrupt(lines: SpokenLine[]): Promise<void> {
    this.stop();
    return this.play(lines);
  }

  /** Stop everything now (leaving the chase). */
  stop(): void {
    this.cancelled = ++this.generation;
    this.duck(false);
    this.wake?.();
    this.wake = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sources = [];
  }

  private createContext(): AudioContext | null {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    // 'playback' asks for a bigger sound buffer: a little more delay, but no
    // crackles or drop-outs when a slow school computer is busy drawing the town.
    let ctx: AudioContext;
    try {
      ctx = new Ctx({ latencyHint: 'playback' });
    } catch {
      ctx = new Ctx();
    }
    // If the browser or computer pauses the sound, start it again as soon as it is allowed.
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running' && ctx.state !== 'closed') this.resume();
    });
    // A last-moment safety limiter for rare peaks, after plenty of headroom (MIX.master).
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 2;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = MIX.master;
    master.connect(limiter);
    // Music and effects share a gentle compressor; the French bypasses it, so loud
    // drums, sirens or crashes never squash the voice. (The browser's default
    // settings squeezed hard and boosted quiet parts, so the music pumped.)
    const sounds = ctx.createDynamicsCompressor();
    sounds.threshold.value = -14;
    sounds.knee.value = 10;
    sounds.ratio.value = 3;
    sounds.attack.value = 0.01;
    sounds.release.value = 0.3;
    sounds.connect(master);
    const bus = (level: number, into: AudioNode) => {
      const gain = ctx.createGain();
      gain.gain.value = level;
      gain.connect(into);
      return gain;
    };
    const scanner = bus(MIX.scanner, master);
    const effects = bus(MIX.effects, sounds);
    const music = bus(1, sounds);
    // The scanner's own beep, static and click: part of the call, so never ducked.
    const chirps = bus(MIX.effects, sounds);
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = MIX.radioLowCut;
    const high = ctx.createBiquadFilter();
    high.type = 'lowpass';
    high.frequency.value = MIX.radioHighCut;
    low.connect(high).connect(scanner);
    this.buses = { scanner, effects, music, radio: low, chirps };
    return ctx;
  }

  private async sequence(lines: SpokenLine[], ticket: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.buses || ctx.state !== 'running') return;
    const buffers = await Promise.all(lines.map((line) => this.buffer(line.audioId)));
    if (ticket <= this.cancelled) return;

    this.duck(true);
    let t = ctx.currentTime + 0.02;
    const radioAt = lines.findIndex((l) => l.radio);
    for (const [i, line] of lines.entries()) {
      if (i === radioAt) t = this.beepAndStatic(t);
      const buffer = buffers[i];
      if (buffer) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(line.radio && this.radioFilter ? this.buses.radio : this.buses.scanner);
        this.track(source).start(t);
        t += buffer.duration + MIX.gapSeconds;
      }
    }
    if (radioAt !== -1) t = this.click(t);
    await new Promise<void>((resolve) => {
      this.wake = resolve; // stop() ends the wait at once
      // Measured on the sound clock, so a paused game (see pause) keeps waiting until the call is really over.
      const check = () => {
        const left = t - ctx.currentTime;
        if (left <= 0.005) resolve();
        else setTimeout(check, left * 1000 + 15);
      };
      check();
    });
    // The music comes back up only when no other call follows straight on (no pumping between calls).
    if (ticket > this.cancelled && this.waiting === 0) this.duck(false);
  }

  private duck(on: boolean): void {
    if (!this.buses || !this.ctx) return;
    const { music, effects } = this.buses;
    music.gain.setTargetAtTime(on ? MIX.duckTo : 1, this.ctx.currentTime, MIX.duckSeconds / 3);
    effects.gain.setTargetAtTime(MIX.effects * (on ? MIX.effectsDuckTo : 1), this.ctx.currentTime, MIX.duckSeconds / 3);
  }

  /** Radio beep then a short burst of static. Returns when the voice can start. */
  private beepAndStatic(t: number): number {
    this.tone(t, 1250, 0.09);
    this.noise(t + 0.1, 0.22, 0.25);
    return t + 0.32;
  }

  /** End of transmission: a squelch click and a lower beep. */
  private click(t: number): number {
    this.noise(t, 0.03, 0.5);
    this.tone(t + 0.05, 880, 0.07);
    return t + 0.15;
  }

  private tone(t: number, frequency: number, seconds: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.01);
    gain.gain.setValueAtTime(0.5, t + seconds - 0.02);
    gain.gain.linearRampToValueAtTime(0, t + seconds);
    osc.connect(gain).connect(this.buses!.chirps);
    this.track(osc).start(t);
    osc.stop(t + seconds);
  }

  private noise(t: number, seconds: number, level: number): void {
    const ctx = this.ctx!;
    const frames = Math.ceil(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Static is sound design, not gameplay, so it does not need the seeded Rng.
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    const gain = ctx.createGain();
    gain.gain.value = level;
    source.connect(band).connect(gain).connect(this.buses!.chirps);
    this.track(source).start(t);
  }

  private track<T extends AudioScheduledSourceNode>(source: T): T {
    this.sources.push(source);
    source.onended = () => (this.sources = this.sources.filter((s) => s !== source));
    return source;
  }

  private buffer(audioId: string): Promise<AudioBuffer | null> {
    const clip = this.manifest.clips[audioId];
    if (!clip || !this.ctx) return Promise.resolve(null);
    let pending = this.buffers.get(audioId);
    if (!pending) {
      pending = this.decode(`${this.baseUrl}audio/${clip.file}`);
      this.buffers.set(audioId, pending);
      // A clip that failed (a slow or dropped connection) is tried again next time.
      void pending.then((buffer) => {
        if (!buffer) this.buffers.delete(audioId);
      });
    }
    return pending;
  }

  private async decode(url: string): Promise<AudioBuffer | null> {
    // A stalled download must not hold up every call after it.
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), MIX.fetchSeconds * 1000);
    try {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) return null;
      const data = await response.arrayBuffer();
      window.clearTimeout(timer);
      return await this.ctx!.decodeAudioData(data);
    } catch {
      return null; // a missing, slow or broken clip falls back to text
    } finally {
      window.clearTimeout(timer);
    }
  }
}

export const scannerAudio = new ScannerAudio(import.meta.env.BASE_URL);
