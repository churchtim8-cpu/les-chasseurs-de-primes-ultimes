/**
 * Developer/debug mode (blueprint section 24).
 *
 * Turn on with `?debug=1` in the address bar, or press the backtick key (`)
 * or F2 at any time. The choice is remembered in this browser.
 */

const STORAGE_KEY = 'bellevue.debug';

type Listener = (enabled: boolean) => void;

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStored(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage can be unavailable (private windows, blocked site data); debug still works.
  }
}

class DebugState {
  private enabled: boolean;
  private readonly listeners = new Set<Listener>();
  /** Key/value lines shown in the overlay, set by whichever scene is running. */
  readonly info = new Map<string, string>();

  constructor() {
    const param = new URLSearchParams(window.location.search).get('debug');
    this.enabled = param === null ? readStored() : param === '1' || param === 'true';
    if (param !== null) writeStored(this.enabled);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  set(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    writeStored(enabled);
    this.listeners.forEach((listener) => listener(enabled));
  }

  toggle(): void {
    this.set(!this.enabled);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const debugState = new DebugState();
