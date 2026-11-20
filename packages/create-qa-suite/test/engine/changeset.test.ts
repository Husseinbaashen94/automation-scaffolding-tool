import * as realFs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyChanges, diffFiles } from '../../src/engine/changeset.js';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'qa-cs-'));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
}
const listAll = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name).slice(dir.length + 1)).sort();

describe('diffFiles', () => {
  it('lists only real differences: created, changed and deleted files, sorted by path', () => {
    const dir = project({ 'a.json': 'A', 'b.json': 'B', 'c.json': 'C' });
    const changes = diffFiles(dir, new Map([['c.json', 'C2'], ['a.json', 'A'], ['b.json', null], ['new/d.json', 'D'], ['gone.json', null]]));
    expect(changes).toEqual([
      { path: 'b.json', before: 'B', after: null },
      { path: 'c.json', before: 'C', after: 'C2' },
      { path: 'new/d.json', before: null, after: 'D' },
    ]);
  });
});

describe('applyChanges', () => {
  it('writes, creates and deletes files, and removes folders left empty', () => {
    const dir = project({ 'a.json': 'A', 'feature/x.json': 'X', 'keep/y.json': 'Y' });
    applyChanges(dir, diffFiles(dir, new Map([['a.json', 'A2'], ['feature/x.json', null], ['new/z.json', 'Z']])));
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('A2');
    expect(readFileSync(join(dir, 'new/z.json'), 'utf8')).toBe('Z');
    expect(existsSync(join(dir, 'feature'))).toBe(false);
    expect(listAll(dir)).toEqual(['a.json', 'keep/y.json', 'new/z.json']);
  });

  it('puts every file back exactly as it was if a write fails halfway, and leaves no temporary files', () => {
    const dir = project({ 'a.json': 'A', 'b.json': 'B', 'c.json': 'C', 'd.json': 'D' });
    const before = Object.fromEntries(listAll(dir).map((p) => [p, readFileSync(join(dir, p), 'utf8')]));
    let renames = 0;
    const failingFs = {
      ...realFs,
      renameSync: (from: string, to: string) => {
        if (++renames === 3) throw new Error('disk full');
        realFs.renameSync(from, to);
      },
    };
    const changes = diffFiles(dir, new Map([['a.json', 'A2'], ['b.json', 'B2'], ['c.json', null], ['e.json', 'E']]));
    expect(() => applyChanges(dir, changes, failingFs as never)).toThrow('disk full');
    expect(listAll(dir)).toEqual(Object.keys(before));
    for (const [p, text] of Object.entries(before)) expect(readFileSync(join(dir, p), 'utf8'), p).toBe(text);
  });
});
