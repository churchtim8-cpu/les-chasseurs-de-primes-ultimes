/**
 * Writes public/audio/manifest.json from the recordings in public/audio.
 *
 * Each clip is saved as public/audio/<voice>/<audio ID>.mp3 (for example
 * public/audio/dispatcher/dir.turn.left.mp3), recorded from the line with that
 * ID in docs/audio/script.json. Only lines in the current script are listed;
 * the game uses a sentence only when its clip is in the manifest.
 *
 *   npm run audio:manifest [-- --model eleven_v4 --dispatcher <voice id> --officer <voice id>]
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const script = JSON.parse(readFileSync('docs/audio/script.json', 'utf8'));
const previous = existsSync('public/audio/manifest.json')
  ? JSON.parse(readFileSync('public/audio/manifest.json', 'utf8'))
  : { voices: {}, model: null };

/** Bitrate (bits per second) from the first MPEG audio frame header, to estimate the duration. */
function mp3Bitrate(bytes) {
  const rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  let i = 0;
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3') {
    i = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  }
  for (; i < bytes.length - 4; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      const kbps = rates[bytes[i + 2] >> 4];
      if (kbps) return kbps * 1000;
    }
  }
  return 64_000;
}

const clips = {};
const missing = [];
for (const line of script) {
  const file = `${line.voice.toLowerCase()}/${line.audioId}.mp3`;
  const path = `public/audio/${file}`;
  if (!existsSync(path)) {
    missing.push(line.audioId);
    continue;
  }
  const bytes = readFileSync(path);
  clips[line.audioId] = {
    file,
    text: line.text,
    voice: line.voice,
    durationMs: Math.round((statSync(path).size * 8 * 1000) / mp3Bitrate(bytes)),
  };
}

const manifest = {
  version: 1,
  model: args.model ?? previous.model ?? null,
  voices: {
    ...previous.voices,
    ...(args.dispatcher ? { DISPATCHER: args.dispatcher } : {}),
    ...(args.officer ? { OFFICER: args.officer } : {}),
  },
  clips,
};
writeFileSync('public/audio/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(clips).length} of ${script.length} lines recorded; ${missing.length} missing.`);
