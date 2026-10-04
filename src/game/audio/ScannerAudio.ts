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
  /**
   * A call waits this long for its clips to download; one still on its way is
   * left out this time (the call still shows as text) and kept for next time.
   */
  fetchSeconds: 5,
  /** Unpacked clips kept ready (the rest are downloaded again, from the browser's cache, when needed). */
  keepClips: 120,
  /** A download that has not even started answering by then is given up on. */
  connectSeconds: 15,
  /** At most this many calls wait their turn; older waiting ones are dropped. */
  maxWaiting: 2,
  /**
   * A call is waited on by the sound clock, but never more than this much
   * longer by the wall clock: if the computer's sound output stalls, later
   * calls are not held up behind it.
   */
  waitSpareSeconds: 1.5,
  /** A call that is cut off fades out over this long, without a click. */
  cutSeconds: 0.06,
} as const;

/**
 * The sound watchdog (Mr Henry, 2026-10-04: "after playing for a while the
 * audio becomes distorted and then cuts out for long periods"). Once a
 * second it checks that the sound clock is still moving with real time; if
 * the computer's sound output has stalled while the game is on screen, it
 * restarts the sound, then rebuilds it from scratch if that did not help.
 */
const WATCH = {
  everyMs: 1000,
  /** The sound clock moving at less than this share of real time counts as stalled... */
  slowShare: 0.5,
  /** ...and after this long stalled, the sound is restarted. */
  stalledSeconds: 2,
  /** A second stall this soon after a restart rebuilds the sound from scratch. */
  rebuildWithin: 20,
  /** At most this many rebuilds in this many seconds. */
  rebuildTries: 3,
  rebuildBackoff: 60,
  /** The page itself frozen this long (the computer busy) is noted in the sound check. */
  freezeSeconds: 0.5,
  /** The safety limiter squeezing harder than this (dB) means the mix is too loud: it distorts. */
  squashDb: -3,
} as const;

/** What the sound check (?soundcheck=1) shows: see soundCheck.ts. */
export interface SoundReport {
  state: string;
  sampleRate: number;
  latencyMs: number;
  /** Times the sound clock stalled, and for how long in all. */
  stalls: number;
  stalledSeconds: number;
  restarts: number;
  rebuilds: number;
  /** The page frozen (computer busy): how often, and the longest. */
  freezes: number;
  longestFreeze: number;
  /** Seconds the safety limiter squeezed hard (sounds distorted). */
  squashedSeconds: number;
  /** Seconds the output reached full scale (clipping). */
  clippedSeconds: number;
  callsPlayed: number;
  /** Calls not heard: sound not running, or too many waiting. */
  callsSkipped: number;
  clipsFailed: number;
  /** Sounds playing right now. */
  playing: number;
  /** Loud moments: the output's peak level over the last second (1 = full scale). */
  peak: number;
  log: string[];
}

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
  /** The current call's volume controls, faded out if it is cut off (see stop). */
  private fades: GainNode[] = [];
  /** The sound watchdog's findings (see WATCH and soundReport). */
  private readonly report = {
    stalls: 0,
    stalledSeconds: 0,
    restarts: 0,
    rebuilds: 0,
    freezes: 0,
    longestFreeze: 0,
    squashedSeconds: 0,
    clippedSeconds: 0,
    callsPlayed: 0,
    callsSkipped: 0,
    clipsFailed: 0,
    peak: 0,
    log: [] as string[],
  };
  private watchTimer: number | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private meter: AnalyserNode | null = null;
  private lastRestart = -Infinity;
  private rebuiltAt: number[] = [];
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
      if (ticket <= this.cancelled) return undefined;
      if (this.waiting >= MIX.maxWaiting) {
        this.report.callsSkipped++;
        return undefined;
      }
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

  /** True when `ctx` is the sound system in use (it is rebuilt if the computer's sound output stalls). */
  owns(ctx: BaseAudioContext): boolean {
    return ctx === this.ctx;
  }

  /** The sound watchdog's findings so far, for the sound check (?soundcheck=1). */
  soundReport(): SoundReport {
    const ctx = this.ctx;
    return {
      ...this.report,
      log: [...this.report.log],
      state: ctx?.state ?? 'not started',
      sampleRate: ctx?.sampleRate ?? 0,
      latencyMs: ctx ? Math.round(((ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0)) * 1000) : 0,
      playing: this.sources.length,
    };
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
    // A call cut off fades out over a few hundredths of a second: stopping a recording
    // mid-wave makes a click, and the dispatcher now cuts in often after wrong turns.
    const now = this.ctx?.currentTime ?? 0;
    for (const fade of this.fades) fade.gain.setTargetAtTime(0, now, MIX.cutSeconds / 3);
    this.fades = [];
    for (const source of this.sources) {
      try {
        source.stop(now + MIX.cutSeconds);
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
      if (ctx !== this.ctx) return;
      this.note(`sound ${ctx.state}${this.paused ? ' (pause menu)' : ''}`);
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
    // The sound check's level meter listens after the limiter (what reaches the speakers).
    const meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    limiter.connect(meter);
    this.limiter = limiter;
    this.meter = meter;
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
    this.watch(ctx);
    return ctx;
  }

  private async sequence(lines: SpokenLine[], ticket: number): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.buses || ctx.state !== 'running') {
      this.report.callsSkipped++;
      return;
    }
    const buffers = await Promise.all(lines.map((line) => this.bufferWithin(line.audioId, MIX.fetchSeconds)));
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
        source.connect(this.fadeInto(line.radio && this.radioFilter ? this.buses.radio : this.buses.scanner));
        this.track(source).start(t);
        t += buffer.duration + MIX.gapSeconds;
      }
    }
    if (radioAt !== -1) t = this.click(t);
    this.report.callsPlayed++;
    await new Promise<void>((resolve) => {
      this.wake = resolve; // stop() ends the wait at once
      // Measured on the sound clock, so a paused game (see pause) keeps waiting until the call is really over;
      // but if the sound clock stops while the game is not paused (the computer's sound output stalled),
      // real time runs the wait out, so the calls after it are not held up behind it.
      let spare = t - ctx.currentTime + MIX.waitSpareSeconds;
      let last = performance.now();
      const check = () => {
        const now = performance.now();
        if (!this.paused) spare -= (now - last) / 1000;
        last = now;
        const left = t - ctx.currentTime;
        if (left <= 0.005 || spare <= 0 || ctx !== this.ctx) resolve();
        else setTimeout(check, Math.min(left, Math.max(spare, 0.05)) * 1000 + 15);
      };
      check();
    });
    // Calls play one at a time, so this call's fades are all of them: done with.
    if (ticket > this.cancelled) this.fades = [];
    // The music comes back up only when no other call follows straight on (no pumping between calls).
    if (ticket > this.cancelled && this.waiting === 0) this.duck(false);
  }

  /**
   * Once a second: is the sound clock still moving with real time? A stall
   * while the game is on screen and not paused means the computer's sound
   * output has stopped: restart it, or rebuild the sound if a restart did not
   * help. Also notes page freezes and how hard the limiter is squeezing.
   */
  private watch(ctx: AudioContext): void {
    if (this.watchTimer !== null) window.clearInterval(this.watchTimer);
    let lastWall = performance.now();
    let lastAudio = ctx.currentTime;
    let stalledFor = 0;
    let stalled = false;
    const level = new Float32Array(this.meter?.fftSize ?? 2048);
    this.watchTimer = window.setInterval(() => {
      if (ctx !== this.ctx) return;
      const now = performance.now();
      const wall = (now - lastWall) / 1000;
      const moved = ctx.currentTime - lastAudio;
      lastWall = now;
      lastAudio = ctx.currentTime;
      const late = wall - WATCH.everyMs / 1000;
      if (late >= WATCH.freezeSeconds) {
        this.report.freezes++;
        this.report.longestFreeze = Math.max(this.report.longestFreeze, Math.round(late * 10) / 10);
      }
      const watching = ctx.state === 'running' && !this.paused && document.visibilityState === 'visible';
      if (!watching) {
        stalledFor = 0;
        stalled = false;
        return;
      }
      if (moved < wall * WATCH.slowShare) {
        if (!stalled) this.report.stalls++;
        stalled = true;
        stalledFor += wall;
        this.report.stalledSeconds += wall - Math.max(0, moved);
        if (stalledFor >= WATCH.stalledSeconds) {
          stalledFor = 0;
          this.restartSound(ctx);
        }
      } else {
        stalledFor = 0;
        stalled = false;
      }
      if (this.limiter && this.limiter.reduction < WATCH.squashDb) this.report.squashedSeconds += wall;
      if (this.meter) {
        this.meter.getFloatTimeDomainData(level);
        let peak = 0;
        for (const v of level) peak = Math.max(peak, Math.abs(v));
        this.report.peak = Math.round(peak * 100) / 100;
        if (peak >= 0.99) this.report.clippedSeconds += wall;
      }
    }, WATCH.everyMs);
  }

  /** The sound clock stalled: nudge the sound back on, or rebuild it from scratch the second time. */
  private restartSound(ctx: AudioContext): void {
    const now = performance.now() / 1000;
    if (now - this.lastRestart > WATCH.rebuildWithin) {
      this.lastRestart = now;
      this.report.restarts++;
      this.note('sound stalled: restarted');
      ctx
        .suspend()
        .then(() => (this.paused || ctx !== this.ctx ? undefined : ctx.resume()))
        .catch(() => undefined);
      return;
    }
    // A sound output that stays dead (headphones unplugged, another app holding it) is not
    // rebuilt over and over: a few tries, then once in a while.
    this.rebuiltAt = this.rebuiltAt.filter((at) => now - at < WATCH.rebuildBackoff);
    if (this.rebuiltAt.length >= WATCH.rebuildTries) return;
    this.rebuiltAt.push(now);
    this.lastRestart = -Infinity;
    this.report.rebuilds++;
    this.note('sound stalled again: rebuilt');
    // The music, engine and footsteps notice the new sound system (see owns) and reconnect to it.
    this.stop();
    this.ctx = null;
    this.buses = undefined;
    void ctx.close().catch(() => undefined);
    try {
      this.ctx = this.createContext();
      this.resume();
    } catch {
      this.ctx = null;
    }
  }

  private note(line: string): void {
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.report.log.push(`${at} ${line}`);
    if (this.report.log.length > 5) this.report.log.shift();
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

  /** A volume control into `bus` for one recording, so a cut-off call can fade out (see stop). */
  private fadeInto(bus: AudioNode): GainNode {
    const fade = this.ctx!.createGain();
    fade.connect(bus);
    this.fades.push(fade);
    return fade;
  }

  private track<T extends AudioScheduledSourceNode>(source: T): T {
    this.sources.push(source);
    source.onended = () => (this.sources = this.sources.filter((s) => s !== source));
    return source;
  }

  /** A clip, or null if it is not ready in time (it carries on downloading for next time). */
  private bufferWithin(audioId: string, seconds: number): Promise<AudioBuffer | null> {
    return Promise.race([this.buffer(audioId), new Promise<null>((resolve) => window.setTimeout(() => resolve(null), seconds * 1000))]);
  }

  private buffer(audioId: string): Promise<AudioBuffer | null> {
    const clip = this.manifest.clips[audioId];
    if (!clip || !this.ctx) return Promise.resolve(null);
    let pending = this.buffers.get(audioId);
    if (pending) {
      // Most recently used last, so the oldest clips are the ones let go.
      this.buffers.delete(audioId);
      this.buffers.set(audioId, pending);
    } else {
      pending = this.decode(`${this.baseUrl}audio/${clip.file}`);
      this.buffers.set(audioId, pending);
      // Unpacked clips take a lot of memory (about 0.4 MB each, 600 clips in all): keep the
      // recent ones only, so a long session does not fill up a school laptop's memory.
      for (const oldest of this.buffers.keys()) {
        if (this.buffers.size <= MIX.keepClips) break;
        this.buffers.delete(oldest);
      }
      // A clip that failed (a slow or dropped connection) is tried again next time.
      void pending.then((buffer) => {
        if (!buffer) this.buffers.delete(audioId);
      });
    }
    return pending;
  }

  private async decode(url: string): Promise<AudioBuffer | null> {
    // A server that never answers is given up on. Once it answers, the clip is never cut off:
    // the old 5-second limit on the whole download fired whenever the page froze for a moment
    // (a slow computer drawing the town), throwing away clips that had all but arrived, so
    // calls lost their voice (found with the sound check, 2026-10-04).
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), MIX.connectSeconds * 1000);
    try {
      const response = await fetch(url, { signal: abort.signal });
      window.clearTimeout(timer);
      if (!response.ok) {
        this.report.clipsFailed++;
        return null;
      }
      const data = await response.arrayBuffer();
      const ctx = this.ctx;
      if (!ctx) return null;
      return await ctx.decodeAudioData(data);
    } catch {
      this.report.clipsFailed++;
      return null; // a missing, slow or broken clip falls back to text
    } finally {
      window.clearTimeout(timer);
    }
  }
}

export const scannerAudio = new ScannerAudio(import.meta.env.BASE_URL);
