/** Regression tests for the final review's findings (one block per finding). */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaffold } from '../src/commands/create.js';
import { featureGrep } from '../src/engine/run-tests.js';
import { loadProject } from '../src/model/load.js';
import { validateProject } from '../src/model/validate.js';
import { pagePattern } from '../template/base/support/steps.js';
import { exampleProject, run, tempDir } from './helpers/run.js';
import { findInCoverage } from './helpers/stale.js';

const readJson = (dir: string, p: string) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
const writeJson = (dir: string, p: string, v: unknown) => writeFileSync(join(dir, p), JSON.stringify(v, null, 2) + '\n');

describe('#1 every failure maps to a deliberate exit code with a plain message', () => {
  it('a write failure exits 2 with "Nothing was changed", no stack trace, files untouched', async () => {
    const dir = await exampleProject();
    const before = readFileSync(join(dir, 'coverage/bookings/api.json'), 'utf8');
    chmodSync(join(dir, 'coverage/_shared'), 0o555);
    try {
      const r = await run('update', [dir, '--feature', 'bookings', '--endpoint', 'get-booking', '--to', '/bookings/{bookingId}', '--no-run']);
      expect(r.code).toBe(2);
      expect(r.err).toContain('Nothing was changed');
      expect(r.err).not.toMatch(/\n\s+at /);
    } finally {
      chmodSync(join(dir, 'coverage/_shared'), 0o755);
    }
    expect(readFileSync(join(dir, 'coverage/bookings/api.json'), 'utf8')).toBe(before);
    expect(loadProject(dir).endpoints.find((e) => e.id === 'get-booking')!.path).toBe('/booking/{bookingId}');
  });

  it('a .qa-suite.json whose features is not a list is reported as a coverage problem (exit 2)', async () => {
    const dir = await exampleProject();
    writeJson(dir, '.qa-suite.json', { ...readJson(dir, '.qa-suite.json'), features: 'cart' });
    const r = await run('update', [dir, '--feature', 'cart', '--page', 'inventory', '--element', 'cart-badge', '--expect', 'text=1', '--from', '2']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('.qa-suite.json features: must be array');
  });

  it('create pointed at a file exits 2 and says so', async () => {
    const file = join(tempDir(), 'a-file');
    writeFileSync(file, 'x');
    const r = await run('create', [file, '--yes', '--skip-install']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('is a file, not a folder');
  });

  it('when installing fails after the project is written, it says the project exists and exits 1', async () => {
    const dir = join(tempDir(), 'shop');
    const io = await import('./helpers/io.js');
    const { main } = await import('../src/cli/main.js');
    const cap = io.captureIo();
    const code = await main('create', [dir, '--yes'], cap, { install: async () => { throw new Error('npm install failed'); }, runTests: async () => 0 });
    expect(code).toBe(1);
    expect(cap.stderr()).toContain('The project was created');
    expect(cap.stderr()).toContain('npm install failed');
    expect(loadProject(dir).settings.features).toHaveLength(3);
  });
});

async function withListEndpoint(): Promise<string> {
  const dir = await exampleProject();
  expect((await run('create', [dir, '--feature', 'listing', '--endpoint', 'GET /booking', '--no-run'])).code).toBe(0);
  const eps = readJson(dir, 'coverage/_shared/endpoints.json');
  eps.endpoints.find((e: { id: string }) => e.id === 'get-booking-2').response = { type: 'array', items: { type: 'object', required: ['bookingid'], properties: { bookingid: { type: 'number' } } } };
  writeJson(dir, 'coverage/_shared/endpoints.json', eps);
  const api = readJson(dir, 'coverage/listing/api.json');
  api.checks[0].expect.values = { '0.bookingid': 1 };
  api.checks[0].save = { firstId: '0.bookingid' };
  writeJson(dir, 'coverage/listing/api.json', api);
  return dir;
}

describe('#2 response fields inside lists', () => {
  it('renaming a field of an array response also renames "0.field" values and saves', async () => {
    const dir = await withListEndpoint();
    const r = await run('update', [dir, '--feature', 'listing', '--endpoint', 'GET /booking', '--response-field', 'bookingid', '--rename', 'id', '--no-run']);
    expect(r.code, r.err).toBe(0);
    const check = readJson(dir, 'coverage/listing/api.json').checks[0];
    expect(check.expect.values).toEqual({ '0.id': 1 });
    expect(check.save).toEqual({ firstId: '0.id' });
  });

  it('removing it is refused while "0.field" readers exist', async () => {
    const dir = await withListEndpoint();
    const r = await run('update', [dir, '--feature', 'listing', '--endpoint', 'GET /booking', '--response-field', 'bookingid', '--remove', '--no-run']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('expect.values.0.bookingid');
  });
});

describe('#3 test titles are unique, so Playwright can always load the suite', () => {
  it('create gives repeated endpoints distinct titles', async () => {
    const dir = await exampleProject();
    expect((await run('create', [dir, '--feature', 'orders', '--endpoint', 'POST /orders', '--endpoint', 'post /orders', '--no-run'])).code).toBe(0);
    const titles = loadProject(dir).features.find((f) => f.name === 'orders')!.api.map((c) => c.title);
    expect(new Set(titles).size).toBe(2);
  });

  it('validation rejects duplicate titles in a feature', async () => {
    const dir = await exampleProject();
    const p = loadProject(dir);
    const cart = p.features.find((f) => f.name === 'cart')!;
    cart.ui.checks[1]!.title = cart.ui.checks[0]!.title;
    expect(validateProject(p).map((x) => x.message)).toContain(`duplicate title "${cart.ui.checks[0]!.title}" in this feature (also checks[0]): Playwright needs unique test titles`);
  });

  it('access-rule test titles include the rule id', () => {
    expect(readFileSync(join(import.meta.dirname, '../template/base/tests/acl.spec.ts'), 'utf8')).toContain('(${rule.id})');
  });
});

describe('#4 a feature with nothing to run does not fail', () => {
  it('create --feature with no flags does not run tests, and the runner passes when no tests match', async () => {
    const dir = await exampleProject();
    const r = await run('create', [dir, '--feature', 'checkout']);
    expect(r.code).toBe(0);
    expect(r.tests).toEqual([]);
    const calls: string[][] = [];
    const { runFeatureTests } = await import('../src/engine/run-tests.js');
    await runFeatureTests('/p', ['x'], async (_c, args) => (calls.push(args), 0));
    expect(calls[0]).toContain('--pass-with-no-tests');
    expect(featureGrep(['x'])).toBe('(@x)(?![\\w-])');
  });
});

describe('#5 renaming onto a name that already exists is refused', () => {
  it('request field', async () => {
    const dir = await exampleProject();
    const r = await run('update', [dir, '--feature', 'bookings', '--endpoint', 'create-booking', '--request-field', 'firstname', '--rename', 'lastname', '--no-run']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('"lastname" already exists');
  });

  it('response field', async () => {
    const dir = await exampleProject();
    const r = await run('update', [dir, '--feature', 'bookings', '--endpoint', 'create-booking', '--response-field', 'bookingid', '--rename', 'booking', '--no-run']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('"booking" already exists');
  });
});

describe('#6 a denied page rule cannot pass while the browser is on that page', () => {
  it('the ACL spec also asserts the URL is not the denied page', () => {
    const spec = readFileSync(join(import.meta.dirname, '../template/base/tests/acl.spec.ts'), 'utf8');
    expect(spec).toContain('not.toHaveURL(pagePattern(');
  });

  it('pagePattern matches the page path exactly', () => {
    expect(pagePattern('/inventory.html').test('https://shop.example/inventory.html?x')).toBe(true);
    expect(pagePattern('/inventory.html').test('https://shop.example/')).toBe(false);
  });
});

describe('#7 a role login that calls a changed endpoint follows the change', () => {
  async function withAuthEndpoint() {
    const dir = await exampleProject();
    expect((await run('create', [dir, '--feature', 'auth', '--endpoint', 'POST /auth', '--no-run'])).code).toBe(0);
    const eps = readJson(dir, 'coverage/_shared/endpoints.json');
    eps.endpoints.find((e: { id: string }) => e.id === 'post-auth').response = { type: 'object', properties: { token: { type: 'string' } } };
    writeJson(dir, 'coverage/_shared/endpoints.json', eps);
    return dir;
  }

  it('an endpoint change updates the login path of roles that use it', async () => {
    const dir = await withAuthEndpoint();
    const r = await run('update', [dir, '--feature', 'auth', '--endpoint', 'POST /auth', '--to', 'POST /login', '--no-run']);
    expect(r.code, r.err).toBe(0);
    expect(loadProject(dir).roles.find((x) => x.id === 'admin')!.api).toMatchObject({ login: { method: 'POST', path: '/login' } });
    expect(r.out).toContain('Role admin logs in through it');
    expect(r.out).toContain('Affected features: bookings, auth');
  });

  it('a response field rename updates the tokenPath of roles that log in through it', async () => {
    const dir = await withAuthEndpoint();
    const r = await run('update', [dir, '--feature', 'auth', '--endpoint', 'post-auth', '--response-field', 'token', '--rename', 'access_token', '--no-run']);
    expect(r.code, r.err).toBe(0);
    expect(loadProject(dir).roles.find((x) => x.id === 'admin')!.api).toMatchObject({ tokenPath: 'access_token' });
    expect(findInCoverage(dir, /^token$/).filter((h) => !h.includes('cookieName'))).toEqual([]);
  });
});

describe('re-graded: the generated README never tells an example project to overwrite its .env', () => {
  it('with examples it says .env already holds the demo logins; without, it says to copy .env.example', () => {
    const opts = { dir: '/x', name: 'x', uiBaseUrl: 'https://a', apiBaseUrl: 'https://b' };
    const withExamples = scaffold({ ...opts, examples: true }).get('README.md')!;
    const empty = scaffold({ ...opts, examples: false }).get('README.md')!;
    expect(withExamples).not.toContain('Copy `.env.example` to `.env`');
    expect(withExamples).toContain('already holds');
    expect(empty).toContain('Copy `.env.example` to `.env`');
  });
});

describe("re-graded: the README's CI claims match ci.yml", () => {
  it('does not claim CI runs on every push', () => {
    const readme = readFileSync(join(import.meta.dirname, '../../../README.md'), 'utf8');
    expect(readme).not.toMatch(/on every push/);
    expect(readme).toContain('on pushes to `main`');
  });
});
