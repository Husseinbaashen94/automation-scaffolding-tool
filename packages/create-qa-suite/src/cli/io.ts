import { createInterface } from 'node:readline/promises';

export type Io = {
  out: (s: string) => void;
  err: (s: string) => void;
  ask: (question: string) => Promise<string>;
  isTTY: boolean;
  color: boolean;
};

export function terminalIo(): Io {
  const isTTY = !!process.stdin.isTTY && !!process.stdout.isTTY;
  return {
    out: (s) => void process.stdout.write(s + '\n'),
    err: (s) => void process.stderr.write(s + '\n'),
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await rl.question(question)).trim();
      } finally {
        rl.close();
      }
    },
    isTTY,
    color: isTTY && !process.env.NO_COLOR,
  };
}
