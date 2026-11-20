import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/cli/main.js';
import { captureIo } from '../helpers/io.js';

describe('main', () => {
  it.each(['create', 'update', 'delete'] as const)('%s --help lists its flags and exits 0', async (cmd) => {
    const io = captureIo();
    expect(await main(cmd, ['--help'], io)).toBe(0);
    expect(io.stdout()).toContain(`Usage: ${cmd}-qa-suite <project-folder>`);
    for (const flag of ['--dry-run', '--no-run', '--help']) expect(io.stdout()).toContain(flag);
  });

  it('update and delete refuse a folder that is not a QA suite project (exit 2)', async () => {
    for (const cmd of ['update', 'delete'] as const) {
      const io = captureIo();
      expect(await main(cmd, [mkdtempSync(join(tmpdir(), 'qa-none-')), '--feature', 'x'], io)).toBe(2);
      expect(io.stderr()).toMatch(/not a QA suite project/);
    }
  });

  it('asks for the project folder when it is missing (exit 2)', async () => {
    const io = captureIo();
    expect(await main('update', ['--feature', 'x'], io)).toBe(2);
    expect(io.stderr()).toContain('Missing the project folder');
    expect(io.stderr()).toContain('update-qa-suite --help');
  });

  it('rejects an unknown flag (exit 2)', async () => {
    const io = captureIo();
    expect(await main('delete', ['p', '--force'], io)).toBe(2);
    expect(io.stderr()).toMatch(/--force/);
  });

  it('shows invalid coverage files as a list of problems (exit 2)', async () => {
    const io = captureIo();
    expect(await main('update', [join(import.meta.dirname, '../fixtures/projects/invalid-json'), '--feature', 'bookings', '--endpoint', 'x', '--to', 'y'], io)).toBe(2);
    expect(io.stderr()).toContain('coverage/bookings/api.json: not valid JSON at line');
  });
});
