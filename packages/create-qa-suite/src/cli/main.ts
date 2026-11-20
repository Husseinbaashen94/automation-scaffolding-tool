import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createCommand } from '../commands/create.js';
import { deleteCommand } from '../commands/delete.js';
import { updateCommand } from '../commands/update.js';
import { runFeatureTests } from '../engine/run-tests.js';
import { CoverageError, loadProject } from '../model/load.js';
import { COMMON_OPTIONS, type CommandSpec, type Deps } from './command.js';
import { UsageError } from './errors.js';
import { terminalIo, type Io } from './io.js';
import { npmInstall } from './install.js';

const COMMANDS: Record<CommandSpec['name'], CommandSpec> = { create: createCommand, update: updateCommand, delete: deleteCommand };

export function helpText(spec: CommandSpec): string {
  const options = { ...spec.options, ...COMMON_OPTIONS };
  const rows = Object.entries(options).map(([name, o]) => [`--${name}${o.value ? ` <${o.value}>` : ''}`, o.description] as const);
  const width = Math.max(...rows.map(([flag]) => flag.length));
  return [
    `Usage: ${spec.name}-qa-suite <project-folder> [options]`,
    '',
    spec.summary,
    '',
    'Options:',
    ...rows.map(([flag, desc]) => `  ${flag.padEnd(width)}  ${desc}`),
    '',
    'Exit codes: 0 done · 1 done, but the affected tests failed · 2 nothing changed',
    '',
    'Examples:',
    ...spec.examples.map((e) => `  ${e}`),
  ].join('\n');
}

/** Runs one command. Returns the exit code: 0 done, 1 done but tests failed, 2 nothing changed. */
export async function main(command: CommandSpec['name'], argv: string[], io: Io = terminalIo(), deps: Deps = {}): Promise<number> {
  const spec = COMMANDS[command];
  const hint = `Run \`${command}-qa-suite --help\` for the options.`;
  try {
    const options = Object.fromEntries(
      Object.entries({ ...spec.options, ...COMMON_OPTIONS }).map(([name, o]) => [name, { type: o.type, ...(o.multiple ? { multiple: true } : {}) }]),
    );
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options: options as never, allowPositionals: true, strict: true });
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
    const values = parsed.values as Record<string, any>;
    if (values.help) {
      io.out(helpText(spec));
      return 0;
    }
    const [folder, ...extra] = parsed.positionals;
    if (!folder) throw new UsageError('Missing the project folder.');
    if (extra.length) throw new UsageError(`Unexpected argument(s): ${extra.join(' ')} (put values with spaces in quotes)`);
    const dir = resolve(folder);
    if (spec.needsProject) loadProject(dir);
    return await spec.run({ dir, values, io, deps: { runTests: deps.runTests ?? runFeatureTests, install: deps.install ?? npmInstall } });
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`${e.message}\n${hint}`);
      return 2;
    }
    if (e instanceof CoverageError) {
      io.err(`Nothing was changed. The coverage files have problems:\n${e.problems.map((p) => `  - ${p.file}${p.path ? ` ${p.path}` : ''}: ${p.message}`).join('\n')}`);
      return 2;
    }
    throw e;
  }
}
