import { spawn } from 'node:child_process';
import type { Io } from './io.js';

const run = (cmd: string, args: string[], cwd: string) =>
  new Promise<number>((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });

/** Installs the new project's dependencies and the Chromium browser Playwright uses. */
export async function npmInstall(dir: string, io: Io): Promise<void> {
  io.out('\nInstalling dependencies (npm install)…');
  if ((await run('npm', ['install', '--no-audit', '--no-fund'], dir)) !== 0) throw new Error('npm install failed; run it yourself in the project folder');
  io.out('Installing the Chromium browser for Playwright…');
  if ((await run('npx', ['playwright', 'install', 'chromium'], dir)) !== 0) throw new Error('npx playwright install chromium failed; run it yourself in the project folder');
}
