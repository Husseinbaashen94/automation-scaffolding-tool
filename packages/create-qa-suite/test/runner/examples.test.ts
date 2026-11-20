import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/model/load.js';
import { validateProject } from '../../src/model/validate.js';
import { exampleProjectDir } from '../helpers/example-project.js';

const template = join(import.meta.dirname, '../../template');
const read = (path: string) => readFileSync(join(template, path), 'utf8');
const envFile = (text: string) =>
  new Map(text.split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)] as const));

describe('the example coverage', () => {
  const dir = exampleProjectDir();
  const project = loadProject(dir);
  const coverageText = [...['_shared/roles', '_shared/endpoints', '_shared/pages'], ...project.features.flatMap((f) => ['api', 'ui', 'acl'].map((k) => `${f.name}/${k}`))]
    .map((f) => readFileSync(join(dir, `coverage/${f}.json`), 'utf8'))
    .join('\n');
  const envNames = [...new Set([...coverageText.matchAll(/env:([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]!))];

  it('has the three example features and passes validation', () => {
    expect(project.settings.features).toEqual(['login', 'cart', 'bookings']);
    expect(validateProject(project)).toEqual([]);
  });

  it('has a positive control for every protected endpoint (an allowed role on the same endpoint)', () => {
    const rules = project.features.flatMap((f) => f.acl).filter((r) => 'endpoint' in r.target);
    for (const r of rules.filter((x) => 'status' in x.expect && x.expect.status >= 400)) {
      const endpoint = (r.target as { endpoint: string }).endpoint;
      expect(rules.some((x) => (x.target as { endpoint: string }).endpoint === endpoint && 'status' in x.expect && x.expect.status < 400), endpoint).toBe(true);
    }
  });

  it('keeps credentials out of coverage files', () => {
    expect(coverageText).not.toMatch(/secret_sauce|password123/);
  });

  it('lists every env variable it uses in .env.example (empty) and in the demo env file (filled)', () => {
    const example = envFile(read('examples/.env.example'));
    const demo = envFile(read('examples/env'));
    for (const name of envNames) {
      expect(example.get(name), name).toBe('');
      expect(demo.get(name), name).not.toBe('');
    }
    for (const value of example.values()) expect(value).toBe('');
  });
});

describe('the template', () => {
  it('pins exact dependency versions', () => {
    const pkg = JSON.parse(read('base/package.json.tmpl').replace('{{name}}', 'x'));
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.engines.node).toBe('>=22');
  });

  it('retries on CI and gives slow practice apps 30 seconds', () => {
    const config = read('base/playwright.config.ts');
    expect(config).toContain('retries: process.env.CI ? 2 : 0');
    expect(config).toContain('timeout: 30_000');
  });

  it('has an empty .env.example', () => {
    for (const value of envFile(read('base/.env.example')).values()) expect(value).toBe('');
  });
});
