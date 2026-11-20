import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from '../helpers/run.js';

const pkg = join(import.meta.dirname, '../..');
const packages = join(pkg, '..');
const BINS = {
  create: join(pkg, 'dist/cli/create.js'),
  update: join(packages, 'update-qa-suite/bin.js'),
  delete: join(packages, 'delete-qa-suite/bin.js'),
};
const cli = (cmd: keyof typeof BINS, ...args: string[]) => {
  const r = spawnSync(process.execPath, [BINS[cmd], ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: pkg, stdio: 'ignore' });
}, 120_000);

describe('the published binaries', () => {
  it.each(Object.keys(BINS))('%s-qa-suite --help exits 0', (cmd) => {
    const r = cli(cmd as keyof typeof BINS, '--help');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(`Usage: ${cmd}-qa-suite`);
  });

  it('run the whole life cycle: create → add feature → every kind of update → delete', () => {
    const dir = join(tempDir(), 'shop');
    const steps: [keyof typeof BINS, string[], number][] = [
      ['create', [dir, '--yes', '--skip-install'], 0],
      ['create', [dir, '--feature', 'orders', '--endpoint', 'POST /orders', '--status', '201', '--no-run'], 0],
      ['update', [dir, '--feature', 'bookings', '--endpoint', 'POST /booking', '--to', 'POST /bookings', '--no-run'], 0],
      ['update', [dir, '--feature', 'bookings', '--endpoint', 'create-booking', '--request-field', 'firstname', '--rename', 'first_name', '--no-run'], 0],
      ['update', [dir, '--feature', 'bookings', '--endpoint', 'create-booking', '--response-field', 'bookingid', '--rename', 'id', '--no-run'], 0],
      ['update', [dir, '--feature', 'login', '--page', 'login', '--element', 'login-button', '--locator', '[data-test="sign-in"]', '--no-run'], 0],
      ['update', [dir, '--feature', 'cart', '--page', 'inventory', '--element', 'cart-badge', '--expect', 'text=3', '--from', '2', '--no-run'], 0],
      ['update', [dir, '--feature', 'cart', '--page', 'inventory', '--element', 'cart-badge', '--expect', 'text=3', '--no-run'], 2],
      ['delete', [dir, '--feature', 'orders', '--yes', '--no-run'], 0],
      ['delete', [dir, '--feature', 'orders', '--yes', '--no-run'], 2],
    ];
    for (const [cmd, args, expected] of steps) {
      const r = cli(cmd, ...args);
      expect(r.code, `${cmd} ${args.slice(1).join(' ')}\n${r.err}`).toBe(expected);
    }
    expect(existsSync(join(dir, 'coverage/orders'))).toBe(false);
    expect(readFileSync(join(dir, 'coverage/_shared/endpoints.json'), 'utf8')).toContain('"/bookings"');
  });
});
