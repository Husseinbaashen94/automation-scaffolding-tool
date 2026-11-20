import type { Io } from '../../src/cli/io.js';

/** An Io that records output and answers prompts from a script. */
export function captureIo(answers: string[] = [], opts: { isTTY?: boolean } = {}): Io & { stdout: () => string; stderr: () => string; asked: string[] } {
  let out = '';
  let err = '';
  const asked: string[] = [];
  return {
    out: (s) => void (out += s + '\n'),
    err: (s) => void (err += s + '\n'),
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? '';
    },
    isTTY: opts.isTTY ?? false,
    color: false,
    stdout: () => out,
    stderr: () => err,
    asked,
  };
}
