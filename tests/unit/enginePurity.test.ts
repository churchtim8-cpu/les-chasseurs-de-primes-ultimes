import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The engine must stay free of rendering and browser code, and must never use
// unseeded randomness, so chases are reproducible and testable in Node.
const ENGINE_DIR = join(__dirname, '../../src/engine');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('engine purity', () => {
  const files = sourceFiles(ENGINE_DIR);

  it('finds engine files', () => expect(files.length).toBeGreaterThan(0));

  it.each(files)('%s has no Phaser, DOM or Math.random', (file) => {
    // Comments may mention forbidden names when explaining why they are forbidden.
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/from ['"]phaser['"]/);
    expect(code).not.toMatch(/\b(window|document|localStorage)\./);
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/from ['"]\.\.\/(\.\.\/)?game\//);
  });
});
