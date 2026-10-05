import type Phaser from 'phaser';
import type { ScannerAudio } from './ScannerAudio';

const STORAGE_KEY = 'chasseurs.soundcheck';

/** On with `?soundcheck=1`, off with `?soundcheck=0`; remembered in this browser in between. */
function soundCheckOn(): boolean {
  const param = new URLSearchParams(window.location.search).get('soundcheck');
  try {
    if (param !== null) window.localStorage.setItem(STORAGE_KEY, param === '1' ? '1' : '0');
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return param === '1';
  }
}

/**
 * The sound check (Mr Henry, 2026-10-04: the sound distorts, then cuts out
 * after a while). A small box in the corner that shows, live, what the sound
 * watchdog has seen on this computer: stalls of the sound output, the page
 * freezing, the mix squeezed or clipping, calls skipped. Play with it open
 * until the sound goes wrong, then take a photo of the box: it tells us which
 * of those it was.
 */
export function startSoundCheck(audio: ScannerAudio, game: Phaser.Game): void {
  if (!soundCheckOn()) return;
  const box = document.createElement('pre');
  box.id = 'sound-check';
  Object.assign(box.style, {
    position: 'fixed',
    left: '6px',
    bottom: '6px',
    zIndex: '10',
    margin: '0',
    padding: '6px 8px',
    font: '11px/1.35 monospace',
    color: '#eaf6ff',
    background: 'rgba(5, 18, 26, 0.82)',
    border: '1px solid #6fb3d9',
    borderRadius: '6px',
    pointerEvents: 'none',
    whiteSpace: 'pre',
  });
  document.body.appendChild(box);
  const started = performance.now();
  let fpsLow = Infinity;
  const memory = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  const browser = (navigator.userAgent.match(/(Edg|OPR|Chrome|Firefox|Version)\/[\d]+/)?.[0] ?? 'browser').replace('Version', 'Safari');
  const update = () => {
    const r = audio.soundReport();
    const fps = Math.round(game.loop.actualFps);
    if (performance.now() - started > 5000) fpsLow = Math.min(fpsLow, fps);
    const heap = memory();
    const minutes = Math.floor((performance.now() - started) / 60000);
    const lines = [
      `SOUND CHECK  ${minutes} min  ${browser}`,
      `sound: ${r.state}  ${r.sampleRate} Hz  delay ${r.latencyMs} ms  playing ${r.playing}`,
      `stalls: ${r.stalls} (${Math.round(r.stalledSeconds)} s)  restarts ${r.restarts}  rebuilds ${r.rebuilds}`,
      `page froze: ${r.freezes}x  longest ${r.longestFreeze} s  fps ${fps} (low ${Number.isFinite(fpsLow) ? fpsLow : '-'})`,
      `too loud: squeezed ${Math.round(r.squashedSeconds)} s  clipped ${Math.round(r.clippedSeconds)} s  peak ${r.peak}`,
      `glitches: ${r.glitches === null ? 'not shown by this browser' : `${r.glitches} (${r.glitchMs} ms of sound missed)`}`,
      `calls: played ${r.callsPlayed}  skipped ${r.callsSkipped}  clips failed ${r.clipsFailed}`,
      `memory: ${heap ? `${Math.round(heap / 1e6)} MB` : '-'}  cores ${navigator.hardwareConcurrency ?? '-'}`,
      ...r.log,
    ];
    box.textContent = lines.join('\n');
  };
  update();
  window.setInterval(update, 1000);
}
