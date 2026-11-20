import type { CommandContext, CommandSpec } from '../cli/command.js';
import { UsageError } from '../cli/errors.js';
import { commit } from '../engine/commit.js';
import { loadProject } from '../model/load.js';
import { featureFiles } from '../model/serialize.js';
import type { Project } from '../model/types.js';
import { stepElement, stepPage } from '../model/validate.js';

export type DeletePlan = { project: Project; removed: string[]; unused: string[]; notes: string[] };

/** Removes a feature and the access rules elsewhere that depend on it; shared items are kept. */
export function planDelete(p: Project, feature: string): DeletePlan {
  const target = p.features.find((f) => f.name === feature);
  if (!target) throw new UsageError(`No feature "${feature}" (features: ${p.settings.features.join(', ')})`);
  const next = structuredClone(p);
  next.features = next.features.filter((f) => f.name !== feature);
  next.settings.features = next.settings.features.filter((f) => f !== feature);

  const ownPages = new Set(target.ui.pages.map((pg) => pg.id));
  const ownChecks = new Set(target.api.map((c) => c.id));
  const onOwnPage = (ref: string | undefined) => !!ref && ownPages.has(ref.split('.')[0]!);

  const blockers = next.features.flatMap((f) =>
    f.ui.checks.flatMap((c) => {
      const pages = new Set([c.start, ...c.steps.map((s) => stepPage(s) ?? stepElement(s)?.split('.')[0])].filter((x): x is string => !!x && ownPages.has(x)));
      return [...pages].map((pg) => `${c.id} (${f.name}) uses page ${pg}`);
    }),
  );
  if (blockers.length) {
    throw new UsageError(
      `Other features use pages that belong to "${feature}":\n${blockers.map((b) => `  - ${b}`).join('\n')}\nMove those pages to coverage/_shared/pages.json first, or change those checks.`,
    );
  }

  const notes: string[] = [];
  for (const f of next.features) {
    const kept = f.acl.filter((r) => {
      const usedSetup = (r.setup ?? []).find((id) => ownChecks.has(id));
      const page = 'page' in r.target && ownPages.has(r.target.page) ? r.target.page : undefined;
      const denied = 'allowed' in r.expect && onOwnPage(r.expect.denied) ? r.expect.denied : undefined;
      const why = usedSetup ? `it used ${usedSetup} as setup` : page ? `it targets page ${page}` : denied ? `it expects ${denied}` : undefined;
      if (why) notes.push(`Also removed from ${f.name}: rule ${r.id} (${why})`);
      return !why;
    });
    f.acl = kept;
  }

  const usedEndpoints = new Set(next.features.flatMap((f) => [...f.api.map((c) => c.endpoint), ...f.acl.flatMap((r) => ('endpoint' in r.target ? [r.target.endpoint] : []))]));
  const usedRoles = new Set(next.features.flatMap((f) => [...f.api, ...f.ui.checks, ...f.acl].map((x) => x.role)));
  const usedPages = new Set(
    next.features.flatMap((f) => [
      ...f.ui.checks.flatMap((c) => [c.start, ...c.steps.map((s) => stepPage(s) ?? stepElement(s)?.split('.')[0])]),
      ...f.acl.flatMap((r) => ['page' in r.target ? r.target.page : undefined, 'allowed' in r.expect ? r.expect.denied?.split('.')[0] : undefined]),
    ]),
  );
  for (const role of next.roles) if (usedRoles.has(role.id)) for (const s of role.ui?.loginFlow ?? []) usedPages.add(stepPage(s) ?? stepElement(s)?.split('.')[0]);
  const unused = [
    ...next.endpoints.filter((e) => !usedEndpoints.has(e.id)).map((e) => `endpoint ${e.id}`),
    ...next.sharedPages.filter((pg) => !usedPages.has(pg.id)).map((pg) => `page ${pg.id}`),
    ...next.roles.filter((r) => !usedRoles.has(r.id)).map((r) => `role ${r.id}`),
  ];
  const group = (kind: string) => unused.filter((u) => u.startsWith(`${kind} `)).map((u) => u.slice(kind.length + 1));
  const unusedNote = [['endpoints', group('endpoint')], ['pages', group('page')], ['roles', group('role')]]
    .filter(([, items]) => items!.length)
    .map(([label, items]) => `${label} ${(items as string[]).join(', ')}`)
    .join('; ');
  if (unusedNote) notes.push(`Now unused (kept): ${unusedNote}`);
  return { project: next, removed: featureFiles(target).map(([path]) => path), unused, notes };
}

async function runDelete(ctx: CommandContext): Promise<number> {
  const { values, io } = ctx;
  if (!values.feature) throw new UsageError('--feature is required: name the feature whose coverage to remove.');
  const plan = planDelete(loadProject(ctx.dir), values.feature);
  if (!values.yes && !values['dry-run'] && !io.isTTY) throw new UsageError('Deleting needs confirmation: run it in a terminal, or re-run with --yes.');
  const files = new Map<string, string | null>(plan.removed.map((p) => [p, null]));
  const confirm = values.yes ? undefined : async () => (await io.ask(`\nType the feature name (${values.feature}) to delete its coverage: `)) === values.feature;
  return commit(ctx, { project: plan.project, files }, plan.notes, plan.project.settings.features, confirm);
}

export const deleteCommand: CommandSpec = {
  name: 'delete',
  summary: 'Remove all coverage of a feature, keeping anything another feature still uses.',
  examples: ['npx delete-qa-suite my-project --feature cart', 'npx delete-qa-suite my-project --feature cart --yes --no-run'],
  needsProject: true,
  options: {
    feature: { type: 'string', value: 'name', description: 'The feature whose coverage to remove (required)' },
    yes: { type: 'boolean', description: 'Skip typing the feature name to confirm' },
  },
  run: runDelete,
};
