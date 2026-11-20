import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/model/load.js';
import { projectFiles } from '../../src/model/serialize.js';

const dir = join(import.meta.dirname, '../fixtures/projects/valid');

describe('projectFiles', () => {
  it('reproduces every coverage file byte for byte', () => {
    const files = projectFiles(loadProject(dir));
    expect([...files.keys()].sort()).toEqual([
      '.qa-suite.json',
      'coverage/_shared/endpoints.json',
      'coverage/_shared/pages.json',
      'coverage/_shared/roles.json',
      'coverage/bookings/acl.json',
      'coverage/bookings/api.json',
      'coverage/bookings/ui.json',
      'coverage/login/acl.json',
      'coverage/login/api.json',
      'coverage/login/ui.json',
    ]);
    for (const [path, text] of files) expect(text, path).toBe(readFileSync(join(dir, path), 'utf8'));
  });
});
