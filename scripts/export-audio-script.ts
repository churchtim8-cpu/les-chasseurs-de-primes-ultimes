/**
 * Writes the recording script (every French line the game can play) to
 * docs/audio/script.csv, for review and for batch recording with ElevenLabs.
 *
 *   npm run audio:script
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { BELLEVUE } from '../src/content/map/bellevue';
import { buildScript, type ScriptLine } from '../src/engine/audio/script';
import { DIFFICULTIES } from '../src/engine/difficulty';
import { TownGraph } from '../src/engine/world/graph';

const TYPE: Record<string, string> = {
  E1: 'Simple direction',
  E2: 'Continue to a place',
  E3: 'Turn at / after a place',
  I1: 'Turn before a place',
  I2: 'Count the streets',
  I3: 'Two steps (puis)',
  RB: 'Roundabout exit',
  R: 'Wrong-turn correction',
  REPEAT: 'Officer asks for a repeat',
  OUTCOME: 'End of chase',
};

const LEVEL = { EASY: 'Easy', INTERMEDIATE: 'Intermediate', HARD: 'Hard', EXPERT: 'Expert' } as const;

function levels(line: ScriptLine): string {
  if (line.levels.length === DIFFICULTIES.length) return 'All levels';
  const first = DIFFICULTIES.find((d) => line.levels.includes(d))!;
  return `${LEVEL[first]} and up`;
}

const csvCell = (value: string | number) => {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const lines = buildScript(new TownGraph(BELLEVUE));
const rows = [
  ['#', 'Levels', 'Type', 'French (exactly as recorded)', 'Voice', 'Characters', 'Audio ID'],
  ...lines.map((l, i) => [
    i + 1,
    levels(l),
    TYPE[l.template ?? l.category] ?? l.category,
    l.text,
    l.voice === 'OFFICER' ? 'Officer (urgent)' : 'Dispatcher (calm)',
    l.text.length,
    l.audioId,
  ]),
];
mkdirSync('docs/audio', { recursive: true });
// A byte-order mark so Excel opens the accents correctly.
writeFileSync('docs/audio/script.csv', '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
writeFileSync('docs/audio/script.json', JSON.stringify(lines, null, 2) + '\n');
const characters = lines.reduce((n, l) => n + l.text.length, 0);
console.log(`Wrote ${lines.length} lines (${characters} characters) to docs/audio/script.csv and script.json`);
