import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/main.js';
import { captureIo } from './io.js';

export type Run = { code: number; out: string; err: string; tests: string[][]; installs: number; asked: string[] };

/** Runs a command in-process with fake install and test runners. */
export async function run(command: 'create' | 'update' | 'delete', argv: string[], opts: { answers?: string[]; isTTY?: boolean; testsExit?: number } = {}): Promise<Run> {
  const io = captureIo(opts.answers, { isTTY: opts.isTTY });
  const tests: string[][] = [];
  let installs = 0;
  const code = await main(command, argv, io, {
    runTests: async (_dir, features) => (tests.push(features), opts.testsExit ?? 0),
    install: async () => void installs++,
  });
  return { code, out: io.stdout(), err: io.stderr(), tests, installs, asked: io.asked };
}

export const tempDir = (prefix = 'qa-') => mkdtempSync(join(tmpdir(), prefix));

/** A freshly created example project in a temp folder (no install). */
export async function exampleProject(): Promise<string> {
  const dir = join(tempDir(), 'shop');
  const r = await run('create', [dir, '--yes', '--skip-install']);
  if (r.code !== 0) throw new Error(`create failed: ${r.err}`);
  return dir;
}
