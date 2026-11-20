import { spawn as nodeSpawn } from 'node:child_process';

export type SpawnLike = (cmd: string, args: string[], opts: { cwd: string }) => Promise<number>;

const defaultSpawn: SpawnLike = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = nodeSpawn(cmd, args, { cwd: opts.cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });

/** The Playwright --grep pattern selecting exactly these features' tests (not "@cart-v2" for "cart"). */
export const featureGrep = (features: string[]) => `(${features.map((f) => `@${f}`).join('|')})(?![\\w-])`;

/** Runs the tests of the given features with Playwright. Returns 0 if they pass, 1 if not. */
export async function runFeatureTests(dir: string, features: string[], spawn: SpawnLike = defaultSpawn): Promise<number> {
  if (!features.length) return 0;
  const code = await spawn('npx', ['playwright', 'test', '--pass-with-no-tests', '--grep', featureGrep(features)], { cwd: dir });
  return code === 0 ? 0 : 1;
}
