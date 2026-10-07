/**
 * The music is made from hundreds of tiny synthesised notes. Played live,
 * every note is work for the computer's sound thread, and on a busy laptop
 * the thread fell behind: the browser counted hundreds of sound glitches (the
 * "sticking"). So each music loop is now rendered once, off to the side, into
 * a recording, and that recording is looped: about 1/400 of the work.
 */

/** Rate the loops are recorded at (the browser converts it to the computer's own rate). */
export const LOOP_RATE = 44100;

/**
 * Record `seconds` of music drawn by `draw` (which books notes from time 0 into
 * `out`) as a seamless loop: notes still ringing at the end (`tail` seconds)
 * are folded back onto the start, where they would sound when the loop repeats.
 */
export async function renderLoop(
  seconds: number,
  tail: number,
  draw: (ctx: OfflineAudioContext, out: AudioNode) => void,
): Promise<AudioBuffer> {
  const Offline =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) throw new Error('no offline audio');
  const length = Math.round(seconds * LOOP_RATE);
  const extra = Math.round(tail * LOOP_RATE);
  const ctx = new Offline(2, length + extra, LOOP_RATE);
  draw(ctx, ctx.destination);
  const rendered = await ctx.startRendering();
  const loop = ctx.createBuffer(2, length, LOOP_RATE);
  for (let c = 0; c < 2; c++) {
    const from = rendered.getChannelData(c);
    const to = loop.getChannelData(c);
    to.set(from.subarray(0, length));
    for (let i = 0; i < extra && i < length; i++) to[i]! += from[length + i]!;
  }
  return loop;
}

/** A recorded loop playing on repeat from `when`, through its own gain (for fading it out). */
export function playLoop(ctx: BaseAudioContext, buffer: AudioBuffer, into: AudioNode, when: number): { source: AudioBufferSourceNode; gain: GainNode } {
  const gain = ctx.createGain();
  gain.connect(into);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain);
  source.start(when);
  return { source, gain };
}

/** Fade a playing loop out quickly and let it go. */
export function endLoop(ctx: BaseAudioContext, loop: { source: AudioBufferSourceNode; gain: GainNode }, fade = 0.08): void {
  const now = ctx.currentTime;
  loop.gain.gain.setTargetAtTime(0, now, fade / 3);
  try {
    loop.source.stop(now + fade * 2);
  } catch {
    // already stopped
  }
  window.setTimeout(() => loop.gain.disconnect(), fade * 2000 + 300);
}
