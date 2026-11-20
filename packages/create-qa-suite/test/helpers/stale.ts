import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every place in the coverage files where a key or string value still matches the needle, as "file:jsonPath".
 * Used to prove an update left no stale reference behind.
 */
export function findInCoverage(dir: string, needle: string | RegExp): string[] {
  const matches = (s: string) => (typeof needle === 'string' ? s.includes(needle) : needle.test(s));
  const hits: string[] = [];
  const walk = (file: string, v: unknown, path: string) => {
    if (typeof v === 'string' && matches(v)) hits.push(`${file}:${path}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(file, x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k !== '$schema' && matches(k)) hits.push(`${file}:${path}.${k} (key)`);
        walk(file, x, `${path}.${k}`);
      }
    }
  };
  const files = ['.qa-suite.json', ...readdirSync(join(dir, 'coverage'), { recursive: true }).map(String).filter((f) => f.endsWith('.json')).map((f) => `coverage/${f}`)];
  for (const f of files) walk(f, JSON.parse(readFileSync(join(dir, f), 'utf8')), '');
  return hits.sort();
}
