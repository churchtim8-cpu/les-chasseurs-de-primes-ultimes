/**
 * The audio manifest (public/audio/manifest.json): which recordings exist.
 * Written by the audio import step, read by the game at start-up.
 *
 * Pipeline step "MATCH PRE-GENERATED AUDIO": once any clip exists, the
 * generator only chooses sentences that have a recording, so the game never
 * shows a line it cannot say. With no clips at all (before the first
 * recording session) every sentence is allowed and shown as text.
 */

import type { AudioCheck } from '../language/generate';
import type { Voice } from './script';

export interface ManifestClip {
  /** Path relative to the audio folder, e.g. "dispatcher/dir.turn.left.mp3". */
  file: string;
  text: string;
  voice: Voice;
  durationMs: number;
}

export interface AudioManifest {
  version: 1;
  /** Model and voices used, so every clip in the library matches. */
  model: string | null;
  voices: Partial<Record<Voice, string>>;
  clips: Record<string, ManifestClip>;
}

export const EMPTY_MANIFEST: AudioManifest = { version: 1, model: null, voices: {}, clips: {} };

export function hasClips(manifest: AudioManifest): boolean {
  return Object.keys(manifest.clips).length > 0;
}

/** Which audio IDs the generator may use with this library. */
export function audioCheck(manifest: AudioManifest): AudioCheck {
  if (!hasClips(manifest)) return () => true;
  return (audioId) => audioId in manifest.clips;
}
