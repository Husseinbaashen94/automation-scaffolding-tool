import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const template = join(import.meta.dirname, '../../template');

/**
 * A throwaway copy of the example project (template base + example coverage), assembled by hand.
 * Task 4's scaffold() replaces this for command tests.
 */
export function exampleProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qa-example-'));
  cpSync(join(template, 'base'), dir, { recursive: true });
  cpSync(join(template, 'examples'), dir, { recursive: true, filter: (src) => !src.endsWith('/env') });
  const settings = JSON.parse(readFileSync(join(dir, '.qa-suite.json'), 'utf8'));
  writeFileSync(join(dir, '.qa-suite.json'), JSON.stringify(settings, null, 2) + '\n');
  return dir;
}
