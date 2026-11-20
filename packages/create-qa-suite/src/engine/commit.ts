import type { CommandContext } from '../cli/command.js';
import { UsageError } from '../cli/errors.js';
import { CoverageError } from '../model/load.js';
import { projectFiles } from '../model/serialize.js';
import type { Project } from '../model/types.js';
import { validateProject } from '../model/validate.js';
import { applyChanges, diffFiles } from './changeset.js';
import { renderSummary } from './summary.js';

/**
 * The shared ending of every command: validate the new coverage, show the changes, write them all
 * (unless --dry-run), then run the affected features' tests (unless --no-run).
 */
export async function commit(
  ctx: CommandContext,
  next: { project?: Project; files?: Map<string, string | null> },
  notes: string[],
  testFeatures: string[],
  confirm?: () => Promise<boolean>,
): Promise<number> {
  const files = new Map<string, string | null>(next.files ?? []);
  if (next.project) {
    const problems = validateProject(next.project);
    if (problems.length) throw new CoverageError(problems);
    for (const [path, text] of projectFiles(next.project)) files.set(path, text);
  }
  const changes = diffFiles(ctx.dir, files);
  ctx.io.out(renderSummary(changes, notes));
  if (!changes.length) return 0;
  if (ctx.values['dry-run']) {
    ctx.io.out('\nDry run: nothing was written.');
    return 0;
  }
  if (confirm && !(await confirm())) {
    ctx.io.err('Nothing was deleted.');
    return 2;
  }
  try {
    applyChanges(ctx.dir, changes);
  } catch (e) {
    throw new UsageError(`Nothing was changed: the files could not be written (${(e as Error).message}).`, false);
  }
  ctx.io.out(`\nWrote ${changes.length} file(s).`);
  if (ctx.values['no-run'] || !testFeatures.length) return 0;
  ctx.io.out(`\nRunning the tests of: ${testFeatures.join(', ')}\n`);
  const code = await ctx.deps.runTests(ctx.dir, testFeatures);
  ctx.io.out(code === 0 ? '\nTests passed.' : '\nSome tests failed (exit 1): the coverage was updated; check the report with `npx playwright show-report`.');
  return code;
}
