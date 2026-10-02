import type { ScannerAudio } from './ScannerAudio';

/**
 * Car sounds, synthesised live with Web Audio: an engine hum whose pitch
 * follows the speed, a tyre screech on sharp turns at speed, and the police
 * siren (the French two-tone "pin-pon") while the chase is on. They play on
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
  level: 0.22,
  /** Screech when turning faster than this (radians per second)... */
  turnRate: 0.9,
  /** ...above this speed. */
  minSpeed: 20,
  /** A short squeal at every corner. */
  seconds: 0.32,
  /** No new screech for this long after one. */
  cooldown: 0.6,
  /** Pitch of the tyre whine (Hz), with a fast wobble. */
  whineHz: 1150,
  wobbleHz: 28,
  wobbleDepth: 70,
};

const SIREN = {
  /** Siren level while driving (below the engine's share of the mix once it ducks). */
  level: 0.045,
  /** The two notes (Hz) and how long each lasts (s). */
  lowHz: 435,
  highHz: 580,
  noteSeconds: 0.55,
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

  /** Call every frame. `driving` is false on foot, during the countdown and after the chase. */
  update(state: { driving: boolean; speed: number; heading: number }, deltaMs: number): void {
    const out = this.out ?? this.connect();
    if (!out) return;
    const { ctx, gain, engine, tone } = out;
    const now = ctx.currentTime;
    const speed = state.driving ? state.speed : 0;
    gain.gain.setTargetAtTime(state.driving ? ENGINE.level : 0, now, 0.15);
    const share = Math.min(1, speed / ENGINE.topSpeed);
    const hz = ENGINE.idleHz + (ENGINE.topHz - ENGINE.idleHz) * share;
    engine[0]!.frequency.setTargetAtTime(hz, now, 0.12);
    engine[1]!.frequency.setTargetAtTime(hz * 2.01, now, 0.12);
    tone.frequency.setTargetAtTime(300 + share * 900, now, 0.2);
    out.siren.gain.setTargetAtTime(state.driving ? SIREN.level : 0, now, 0.25);

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
   * Two-tone siren: a slow square wave flips the pitch between the two notes,
   * and a gentle filter keeps it from sounding harsh.
   */
  private connectSiren(ctx: AudioContext, bus: GainNode): { siren: GainNode; nodes: OscillatorNode[] } {
    const siren = ctx.createGain();
    siren.gain.value = 0;
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 1800;
    soften.connect(siren).connect(bus);
    const voice = ctx.createOscillator();
    voice.type = 'triangle';
    voice.frequency.value = (SIREN.lowHz + SIREN.highHz) / 2;
    const flip = ctx.createOscillator();
    flip.type = 'square';
    flip.frequency.value = 1 / (2 * SIREN.noteSeconds);
    const depth = ctx.createGain();
    depth.gain.value = (SIREN.highHz - SIREN.lowHz) / 2;
    flip.connect(depth).connect(voice.frequency);
    // A touch of the octave above gives the horn its edge.
    const edge = ctx.createOscillator();
    edge.type = 'square';
    edge.frequency.value = SIREN.lowHz + SIREN.highHz;
    const edgeDepth = ctx.createGain();
    edgeDepth.gain.value = SIREN.highHz - SIREN.lowHz;
    flip.connect(edgeDepth).connect(edge.frequency);
    const edgeLevel = ctx.createGain();
    edgeLevel.gain.value = 0.18;
    voice.connect(soften);
    edge.connect(edgeLevel).connect(soften);
    for (const osc of [voice, flip, edge]) osc.start();
    return { siren, nodes: [voice, flip, edge] };
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
