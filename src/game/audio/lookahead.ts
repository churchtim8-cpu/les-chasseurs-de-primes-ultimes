/**
 * How far ahead the music books its notes. Normally a fixed look-ahead is
 * plenty, but a busy computer (or a browser that slows a page's timers) can
 * leave longer gaps between ticks; then notes run out before the next tick
 * and the music breaks up. This stretches the look-ahead to cover the
 * longest recent gap, and lets it shrink back slowly once ticks are regular.
 */
export class Lookahead {
  private last = -1;
  private seconds: number;

  constructor(
    private readonly base: number,
    private readonly max = 2.5,
  ) {
    this.seconds = base;
  }

  /** Call once per tick; returns the look-ahead to use now (s). */
  next(): number {
    const now = performance.now();
    if (this.last >= 0) {
      const gap = (now - this.last) / 1000;
      // A gap of many seconds is a hidden or frozen page, not a slow one: ignore it.
      if (gap < this.max * 2) this.seconds = Math.max(this.seconds * 0.995, Math.min(this.max, gap * 2 + 0.1));
      this.seconds = Math.max(this.base, this.seconds);
    }
    this.last = now;
    return this.seconds;
  }
}
