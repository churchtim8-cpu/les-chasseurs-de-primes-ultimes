/**
 * Light graphics for slow computers and phones. FULL draws everything; LIGHT
 * turns off edge smoothing (the biggest cost on a weak graphics chip) and
 * thins out decoration: fewer walkers, swimmers and butterflies, less tyre
 * smoke. The title screen keeps its flashing lights. AUTO (the default) starts in full and
 * switches this device to light, for good, once a chase runs slowly for a
 * while. Gameplay and the French are identical in both.
 *
 * The choice is made on the title screen (L) or with `?gfx=light|full|auto`.
 * Edge smoothing is fixed when the game loads, so it changes on the next load;
 * everything else changes from the next screen.
 */

export type GraphicsChoice = 'AUTO' | 'FULL' | 'LIGHT';

export const GRAPHICS = {
  /** AUTO goes light when a chase averages under `minFps` for `seconds` in a row. */
  minFps: 40,
  seconds: 6,
  /** Share of the decoration kept in light graphics (walkers, swimmers, butterflies, smoke puffs). */
  keep: 0.5,
} as const;

const CHOICE_KEY = 'chasseurs.gfx';
const SLOW_KEY = 'chasseurs.gfx.slow';
const ORDER: GraphicsChoice[] = ['AUTO', 'FULL', 'LIGHT'];

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts until the page closes
  }
}

/** Read once per page load (the frame watch asks every frame). */
let session: GraphicsChoice | null = null;
let slow: boolean | null = null;

export function graphicsChoice(): GraphicsChoice {
  if (session) return session;
  const asked = new URLSearchParams(window.location.search).get('gfx')?.toUpperCase();
  const stored = read(CHOICE_KEY)?.toUpperCase();
  session = 'AUTO';
  for (const c of [stored, asked]) if (c && (ORDER as string[]).includes(c)) session = c as GraphicsChoice;
  return session;
}

/** AUTO has found this device too slow (now or on an earlier visit). */
export function autoFoundSlow(): boolean {
  slow ??= read(SLOW_KEY) === '1';
  return slow;
}

/** Draw the lighter version of the game. */
export function lightGraphics(): boolean {
  const choice = graphicsChoice();
  return choice === 'LIGHT' || (choice === 'AUTO' && autoFoundSlow());
}

/** How many of `count` decorations to draw (all of them in full graphics). */
export function decorations(count: number): number {
  return lightGraphics() ? Math.max(1, Math.round(count * GRAPHICS.keep)) : count;
}

/** Title button: AUTO → FULL → LIGHT. */
export function cycleGraphics(): GraphicsChoice {
  const next = ORDER[(ORDER.indexOf(graphicsChoice()) + 1) % ORDER.length]!;
  session = next;
  write(CHOICE_KEY, next);
  // Choosing AUTO again gives this device a fresh test.
  if (next === 'AUTO') {
    write(SLOW_KEY, null);
    slow = false;
  }
  return next;
}

export function graphicsLabel(): string {
  const choice = graphicsChoice();
  const detail = choice === 'AUTO' ? (autoFoundSlow() ? ' (LIGHT)' : '') : '';
  return `⚡ GRAPHICS: ${choice}${detail}`;
}

/**
 * Watches the frame rate during a chase. Fed every frame; once the average
 * stays under `GRAPHICS.minFps` for `GRAPHICS.seconds`, AUTO remembers this
 * device as slow.
 */
export class FrameWatch {
  private frames = 0;
  private start = -1;
  private last = -1;
  private slowSeconds = 0;

  /** Call once per drawn frame. */
  update(now = performance.now()): void {
    if (graphicsChoice() !== 'AUTO' || autoFoundSlow()) return;
    // A long gap is a pause, a hidden tab or loading, not slowness: start counting again.
    if (this.last < 0 || now - this.last > 500) {
      this.frames = 0;
      this.start = now;
      this.slowSeconds = 0;
    }
    this.last = now;
    this.frames++;
    if (now - this.start < 1000) return;
    const fps = (this.frames * 1000) / (now - this.start);
    this.frames = 0;
    this.start = now;
    this.slowSeconds = fps < GRAPHICS.minFps ? this.slowSeconds + 1 : 0;
    if (this.slowSeconds >= GRAPHICS.seconds) {
      slow = true;
      write(SLOW_KEY, '1');
    }
  }
}
