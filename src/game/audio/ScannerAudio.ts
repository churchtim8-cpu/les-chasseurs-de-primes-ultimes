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
  duckSeconds: 0.15,
  /** Radio band: telephone-like, still clear enough for learners. */
  radioLowCut: 300,
  radioHighCut: 3400,
  gapSeconds: 0.18,
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
  private buses?: { scanner: GainNode; effects: GainNode; music: GainNode; radio: AudioNode };
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private sources: AudioScheduledSourceNode[] = [];
  private busy: Promise<void> = Promise.resolve();
  private generation = 0;
  /** The radio filter can be switched off (?radio=0) to hear the clean recordings. */
  radioFilter = new URLSearchParams(window.location.search).get('radio') !== '0';

  constructor(private readonly baseUrl: string) {
    // Browsers only start sound after a key press or tap.
    const unlock = () => this.unlock();
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
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
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null; // no Web Audio: the game still works with text
    }
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
    this.busy = this.busy.then(() => (ticket === this.generation ? this.sequence(lines, ticket) : undefined));
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

  /** Stop everything now (leaving the chase). */
  stop(): void {
    this.generation++;
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
    const ctx = new Ctx();
    const master = ctx.createDynamicsCompressor();
    master.connect(ctx.destination);
    const bus = (level: number) => {
      const gain = ctx.createGain();
      gain.gain.value = level;
      gain.connect(master);
      return gain;
    };
    const scanner = bus(MIX.scanner);
    const effects = bus(MIX.effects);
    const music = bus(1);
    const low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = MIX.radioLowCut;
    const high = ctx.createBiquadFilter();
    high.type = 'lowpass';
    high.frequency.value = MIX.radioHighCut;
    low.connect(high).connect(scanner);
    this.buses = { scanner, effects, music, radio: low };
    return ctx;
  }

  private async sequence(lines: SpokenLine[], ticket: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.buses || ctx.state !== 'running') return;
    const buffers = await Promise.all(lines.map((line) => this.buffer(line.audioId)));
    if (ticket !== this.generation) return;

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
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, (t - ctx.currentTime) * 1000)));
    if (ticket === this.generation) this.duck(false);
  }

  private duck(on: boolean): void {
    const music = this.buses?.music;
    if (!music || !this.ctx) return;
    music.gain.setTargetAtTime(on ? MIX.duckTo : 1, this.ctx.currentTime, MIX.duckSeconds / 3);
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
    osc.connect(gain).connect(this.buses!.effects);
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
    source.connect(band).connect(gain).connect(this.buses!.effects);
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
    }
    return pending;
  }

  private async decode(url: string): Promise<AudioBuffer | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await this.ctx!.decodeAudioData(await response.arrayBuffer());
    } catch {
      return null; // a missing or broken clip falls back to text
    }
  }
}

export const scannerAudio = new ScannerAudio(import.meta.env.BASE_URL);
