import { describe, expect, it } from 'vitest';
import { featureGrep, runFeatureTests } from '../../src/engine/run-tests.js';

describe('runFeatureTests', () => {
  it('selects exactly the named features (not features whose names start the same)', () => {
    const re = new RegExp(featureGrep(['cart', 'login']));
    expect(re.test('adds @cart @ui')).toBe(true);
    expect(re.test('logs in @login @ui')).toBe(true);
    expect(re.test('pays @cart-v2 @ui')).toBe(false);
    expect(re.test('x @login_old')).toBe(false);
  });

  it('runs Playwright in the project folder and maps its exit code to 0 or 1', async () => {
    const calls: unknown[] = [];
    const spawn = (cmd: string, args: string[], opts: { cwd: string }) => {
      calls.push([cmd, args, opts.cwd]);
      return Promise.resolve(3);
    };
    expect(await runFeatureTests('/p', ['cart'], spawn)).toBe(1);
    expect(calls).toEqual([['npx', ['playwright', 'test', '--grep', '(@cart)(?![\\w-])'], '/p']]);
    expect(await runFeatureTests('/p', ['cart'], () => Promise.resolve(0))).toBe(0);
  });

  it('runs nothing when no feature is affected', async () => {
    let called = false;
    expect(await runFeatureTests('/p', [], () => ((called = true), Promise.resolve(1)))).toBe(0);
    expect(called).toBe(false);
  });
});
