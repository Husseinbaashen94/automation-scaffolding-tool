import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packages = join(import.meta.dirname, '../..');
const pkg = (name: string) => JSON.parse(readFileSync(join(packages, name, 'package.json'), 'utf8'));
const main = pkg('create-qa-suite');

describe('the three npm packages', () => {
  it('share one version, and the wrappers pin create-qa-suite to it exactly', () => {
    for (const name of ['update-qa-suite', 'delete-qa-suite']) {
      const p = pkg(name);
      expect(p.version).toBe(main.version);
      expect(p.dependencies).toEqual({ 'create-qa-suite': main.version });
      expect(p.bin).toEqual({ [name]: 'bin.js' });
      expect(p.engines.node).toBe('>=22');
    }
  });

  it('create-qa-suite has no runtime dependencies and publishes its code and templates', () => {
    expect(main.dependencies ?? {}).toEqual({});
    expect(main.files).toEqual(expect.arrayContaining(['dist', 'template']));
    expect(main.bin).toEqual({ 'create-qa-suite': 'dist/cli/create.js' });
    expect(main.exports['./cli']).toBe('./dist/cli/main.js');
    expect(main.engines.node).toBe('>=22');
  });

  it('every package has a licence, a description and the repository', () => {
    for (const p of [main, pkg('update-qa-suite'), pkg('delete-qa-suite')]) {
      expect(p.license).toBe('MIT');
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.repository.url).toContain('github.com/Husseinbaashen94/automation-scaffolding-tool');
    }
  });
});
