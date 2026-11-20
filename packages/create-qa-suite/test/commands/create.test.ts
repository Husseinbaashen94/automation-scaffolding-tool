import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaffold } from '../../src/commands/create.js';
import { loadProject } from '../../src/model/load.js';
import { validateProject } from '../../src/model/validate.js';
import { exampleProject, run, tempDir } from '../helpers/run.js';

const read = (dir: string, p: string) => readFileSync(join(dir, p), 'utf8');
const envValues = (text: string) => text.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[1]);
const coverageText = (dir: string) => {
  const p = loadProject(dir);
  return ['coverage/_shared/roles.json', 'coverage/_shared/endpoints.json', 'coverage/_shared/pages.json', ...p.features.flatMap((f) => ['api', 'ui', 'acl'].map((k) => `coverage/${f.name}/${k}.json`))].map((f) => read(dir, f)).join('\n');
};

describe('create-qa-suite: a new project', () => {
  it('creates a valid example project, then installs it', async () => {
    const dir = join(tempDir(), 'my-shop');
    const r = await run('create', [dir, '--yes']);
    expect(r.code).toBe(0);
    expect(r.installs).toBe(1);
    const p = loadProject(dir);
    expect(p.settings.features).toEqual(['login', 'cart', 'bookings']);
    expect(validateProject(p)).toEqual([]);
    expect(JSON.parse(read(dir, 'package.json')).name).toBe('my-shop');
    expect(r.out).toContain('npm test');
  });

  it('puts the public demo logins in .env (git-ignored) and nowhere else', async () => {
    const dir = await exampleProject();
    expect(read(dir, '.env')).toContain('SAUCE_PASSWORD=secret_sauce');
    expect(read(dir, '.gitignore')).toMatch(/^\.env$/m);
    expect(envValues(read(dir, '.env.example')).every((v) => v === '')).toBe(true);
    expect(coverageText(dir)).not.toMatch(/secret_sauce|password123/);
    expect(read(dir, '.github/workflows/tests.yml')).toContain('SAUCE_PASSWORD: ${{ secrets.SAUCE_PASSWORD }}');
    expect(read(dir, '.github/workflows/tests.yml')).not.toMatch(/\{\{\w+\}\}/);
  });

  it('--empty creates a project with no features, no .env and no env block in CI', async () => {
    const dir = join(tempDir(), 'blank');
    const r = await run('create', [dir, '--empty', '--yes', '--skip-install', '--ui-base-url', 'https://app.example', '--api-base-url', 'https://api.example']);
    expect(r.code).toBe(0);
    const p = loadProject(dir);
    expect(p.features).toEqual([]);
    expect(p.settings).toMatchObject({ uiBaseUrl: 'https://app.example', apiBaseUrl: 'https://api.example' });
    expect(existsSync(join(dir, '.env'))).toBe(false);
    expect(read(dir, '.github/workflows/tests.yml')).not.toMatch(/env:|\{\{/);
  });

  it('asks three questions in a terminal, with the example apps as defaults', async () => {
    const dir = join(tempDir(), 'asked');
    const r = await run('create', [dir, '--skip-install'], { isTTY: true, answers: ['', 'https://api.mine.example', 'n'] });
    expect(r.code).toBe(0);
    expect(r.asked).toHaveLength(3);
    const p = loadProject(dir);
    expect(p.settings).toMatchObject({ uiBaseUrl: 'https://www.saucedemo.com', apiBaseUrl: 'https://api.mine.example', features: [] });
  });

  it('refuses a folder that is not empty (exit 2) and writes nothing', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    const r = await run('create', [dir, '--yes', '--skip-install']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('is not empty');
    expect(existsSync(join(dir, '.qa-suite.json'))).toBe(false);
  });

  it('--dry-run lists the files and writes nothing', async () => {
    const dir = join(tempDir(), 'dry');
    const r = await run('create', [dir, '--yes', '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('+ .qa-suite.json');
    expect(r.installs).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  it('scaffold() fills every placeholder and keeps the template files npm would drop', () => {
    const files = scaffold({ dir: '/x/demo', name: 'demo', uiBaseUrl: 'https://a', apiBaseUrl: 'https://b', examples: true });
    for (const [path, text] of files) expect(text, path).not.toMatch(/\{\{\w+\}\}/);
    expect(files.has('.gitignore')).toBe(true);
    expect(files.has('gitignore')).toBe(false);
    expect(files.has('package.json.tmpl')).toBe(false);
    expect(files.has('schemas/api.schema.json')).toBe(true);
  });
});

describe('create-qa-suite --feature: add coverage for a feature', () => {
  it('adds draft API checks, a page check and access rules that validate', async () => {
    const dir = await exampleProject();
    const r = await run('create', [dir, '--feature', 'orders', '--endpoint', 'POST /orders', '--endpoint', 'GET /orders/{orderId}', '--status', '201', '--role', 'admin',
      '--page', 'checkout', '--path', '/checkout-step-one.html', '--rule', 'guest POST /orders 401', '--rule', 'guest page:checkout denied']);
    expect(r.code, r.err).toBe(0);
    const p = loadProject(dir);
    const orders = p.features.find((f) => f.name === 'orders')!;
    expect(orders.api.map((c) => [c.endpoint, c.role, c.expect.status, c.draft])).toEqual([
      ['post-orders', 'admin', 201, true],
      ['get-orders-orderid', 'admin', 201, true],
    ]);
    expect(orders.api[1]!.params).toEqual({ orderId: 'fill-in' });
    expect(orders.ui.pages[0]).toMatchObject({ id: 'checkout', path: '/checkout-step-one.html' });
    expect(orders.ui.checks[0]).toMatchObject({ start: 'checkout', draft: true });
    expect(orders.acl.map((x) => [x.role, x.target, x.expect])).toEqual([
      ['guest', { endpoint: 'post-orders' }, { status: 401 }],
      ['guest', { page: 'checkout' }, { allowed: false }],
    ]);
    expect(validateProject(p)).toEqual([]);
    expect(r.out).toContain('Drafts to fill in');
    expect(r.tests).toEqual([['orders']]);
  });

  it('reuses an endpoint that already exists instead of duplicating it', async () => {
    const dir = await exampleProject();
    const r = await run('create', [dir, '--feature', 'reports', '--endpoint', 'GET /booking/{bookingId}', '--no-run']);
    expect(r.code, r.err).toBe(0);
    const p = loadProject(dir);
    expect(p.endpoints.filter((e) => e.method === 'GET' && e.path === '/booking/{bookingId}')).toHaveLength(1);
    expect(p.features.find((f) => f.name === 'reports')!.api[0]!.endpoint).toBe('get-booking');
  });

  it('refuses an existing feature, a bad name, an unknown role and a --page without --path (exit 2, nothing written)', async () => {
    const dir = await exampleProject();
    const before = read(dir, '.qa-suite.json');
    for (const [args, message] of [
      [['--feature', 'cart'], 'already exists'],
      [['--feature', 'Orders'], 'lower-case'],
      [['--feature', 'orders', '--endpoint', 'POST /orders', '--role', 'boss'], 'Unknown role "boss"'],
      [['--feature', 'orders', '--page', 'checkout'], 'one --path for each --page'],
      [['--feature', 'orders', '--endpoint', 'FETCH /orders'], 'METHOD /path'],
      [['--feature', 'orders', '--rule', 'guest page:nowhere denied'], 'Unknown page "nowhere"'],
    ] as const) {
      const r = await run('create', [dir, ...args]);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.err, args.join(' ')).toContain(message);
    }
    expect(read(dir, '.qa-suite.json')).toBe(before);
  });
});

describe('create-qa-suite in a project folder without --feature', () => {
  it('explains how to add a feature (exit 2)', async () => {
    const dir = await exampleProject();
    const r = await run('create', [dir]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--feature');
  });

  it('refuses --feature on a folder that is not a project yet', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'x'));
    const r = await run('create', [join(dir, 'x'), '--feature', 'orders']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('not a QA suite project');
  });
});
