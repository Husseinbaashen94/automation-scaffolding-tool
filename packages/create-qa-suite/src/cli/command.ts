import type { runFeatureTests } from '../engine/run-tests.js';
import type { Io } from './io.js';

export type OptionSpec = { type: 'string' | 'boolean'; multiple?: boolean; value?: string; description: string };
export type Deps = { runTests?: typeof runFeatureTests; install?: (dir: string, io: Io) => Promise<void> };
export type CommandContext = { dir: string; values: Record<string, any>; io: Io; deps: Required<Deps> };

export type CommandSpec = {
  name: 'create' | 'update' | 'delete';
  summary: string;
  examples: string[];
  /** Whether the project folder must already be a QA suite project. */
  needsProject: boolean;
  options: Record<string, OptionSpec>;
  run: (ctx: CommandContext) => Promise<number>;
};

/** Options every command accepts. */
export const COMMON_OPTIONS: Record<string, OptionSpec> = {
  'dry-run': { type: 'boolean', description: 'Show what would change, and write nothing' },
  'no-run': { type: 'boolean', description: "Don't run the affected tests afterwards" },
  help: { type: 'boolean', description: 'Show this help' },
};
