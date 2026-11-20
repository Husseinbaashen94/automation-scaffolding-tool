import { checkSchema } from './schema.js';
import { projectFiles, schemaFor } from './serialize.js';
import type { Page, Problem, Project, Step, Value } from './types.js';

export const GUEST = 'guest';
const SAVED = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Every `{name}` placeholder used anywhere inside a value, with the dot path where it appears. */
function savedRefs(value: Value | undefined, path: string): { path: string; name: string }[] {
  if (typeof value === 'string') return [...value.matchAll(SAVED)].map((m) => ({ path, name: m[1]! }));
  if (Array.isArray(value)) return value.flatMap((v, i) => savedRefs(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => savedRefs(v, `${path}.${k}`));
  return [];
}

export const pathVars = (path: string): string[] => [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);

/** The element a step points at ("page.element"), if any. */
export function stepElement(step: Step): string | undefined {
  for (const key of ['fill', 'click', 'select', 'check', 'visible', 'hidden', 'text', 'value', 'count'] as const) {
    if (key in step && !(key === 'value' && 'fill' in step) && !(key === 'value' && 'select' in step)) return (step as Record<string, string>)[key];
  }
  return undefined;
}

/** The page a step points at (goto/url), if any. */
export const stepPage = (step: Step): string | undefined => ('goto' in step ? step.goto : 'url' in step ? step.url : undefined);

/** Structural checks (the shipped JSON Schemas) plus every cross-reference between coverage files. */
export function validateProject(p: Project): Problem[] {
  const problems: Problem[] = [];
  for (const [file, text] of projectFiles(p)) {
    for (const err of checkSchema(schemaFor(file), JSON.parse(text))) problems.push({ file, ...err });
  }
  if (problems.length) return problems;
  const add = (file: string, path: string, message: string) => problems.push({ file, path, message });

  const ROLES = 'coverage/_shared/roles.json';
  const ENDPOINTS = 'coverage/_shared/endpoints.json';
  const PAGES = 'coverage/_shared/pages.json';

  // Roles
  const roleIds = [GUEST, ...p.roles.map((r) => r.id)];
  p.roles.forEach((role, i) => {
    if (role.id === GUEST) add(ROLES, `roles[${i}].id`, '"guest" is built in (no login); use another name');
    const creds: [string, unknown][] = [];
    if (role.api.type === 'basic') creds.push([`roles[${i}].api.username`, role.api.username], [`roles[${i}].api.password`, role.api.password]);
    if ((role.api.type === 'bearer' || role.api.type === 'cookie') && role.api.login.body && typeof role.api.login.body === 'object') {
      for (const [k, v] of Object.entries(role.api.login.body)) creds.push([`roles[${i}].api.login.body.${k}`, v]);
    }
    role.ui?.loginFlow.forEach((s, j) => 'fill' in s && creds.push([`roles[${i}].ui.loginFlow[${j}].value`, s.value]));
    for (const [path, v] of creds) if (typeof v !== 'string' || !v.startsWith('env:')) add(ROLES, path, 'credentials must be env:NAME references');
  });
  dupes(p.roles.map((r, i) => ({ id: r.id, file: ROLES, path: `roles[${i}].id` })), 'role', add);

  // Endpoints
  dupes(p.endpoints.map((e, i) => ({ id: e.id, file: ENDPOINTS, path: `endpoints[${i}].id` })), 'endpoint', add);
  const endpointById = new Map(p.endpoints.map((e) => [e.id, e]));
  const endpointList = p.endpoints.map((e) => e.id).join(', ');

  // Pages (shared first, then each feature's), unique project-wide
  const pageEntries: { page: Page; file: string; path: string }[] = [
    ...p.sharedPages.map((page, i) => ({ page, file: PAGES, path: `pages[${i}]` })),
    ...p.features.flatMap((f) => f.ui.pages.map((page, i) => ({ page, file: `coverage/${f.name}/ui.json`, path: `pages[${i}]` }))),
  ];
  const pageById = new Map<string, { page: Page; file: string }>();
  for (const { page, file, path } of pageEntries) {
    const seen = pageById.get(page.id);
    if (seen) add(file, `${path}.id`, `duplicate page "${page.id}" (also in ${seen.file})`);
    else pageById.set(page.id, { page, file });
    if (!(page.marker in page.elements)) add(file, `${path}.marker`, `marker "${page.marker}" is not one of the page's elements`);
  }
  const pageList = [...pageById.keys()].join(', ');
  const checkPage = (file: string, path: string, id: string) => !pageById.has(id) && add(file, path, `unknown page "${id}" (pages: ${pageList})`);
  const checkElement = (file: string, path: string, ref: string) => {
    const [pageId, element] = ref.split('.') as [string, string];
    const entry = pageById.get(pageId);
    if (!entry) return add(file, path, `unknown page "${pageId}" in "${ref}" (pages: ${pageList})`);
    if (!(element in entry.page.elements)) add(file, path, `unknown element "${ref}" (${pageId} has: ${Object.keys(entry.page.elements).join(', ')})`);
  };
  const checkSteps = (file: string, path: string, steps: Step[]) =>
    steps.forEach((s, i) => {
      const el = stepElement(s);
      if (el) checkElement(file, `${path}[${i}]`, el);
      const pg = stepPage(s);
      if (pg) checkPage(file, `${path}[${i}]`, pg);
    });
  p.roles.forEach((r, i) => r.ui && checkSteps(ROLES, `roles[${i}].ui.loginFlow`, r.ui.loginFlow));

  const checkRole = (file: string, path: string, id: string) => !roleIds.includes(id) && add(file, path, `unknown role "${id}" (roles: ${roleIds.join(', ')})`);
  const checkParams = (file: string, path: string, endpointId: string, params: Record<string, Value> | undefined) => {
    const endpoint = endpointById.get(endpointId);
    if (!endpoint) return add(file, `${path}.endpoint`, `unknown endpoint "${endpointId}" (endpoints: ${endpointList})`);
    const vars = pathVars(endpoint.path);
    for (const v of vars) if (!params || !(v in params)) add(file, `${path}.params`, `missing "${v}" for path ${endpoint.path}`);
    for (const k of Object.keys(params ?? {})) if (!vars.includes(k)) add(file, `${path}.params.${k}`, `"${k}" is not a variable of path ${endpoint.path}`);
  };

  // Checks and rules: one id namespace for the whole project
  const allIds: { id: string; file: string; path: string }[] = [];
  const apiCheckById = new Map(p.features.flatMap((f) => f.api.map((c) => [c.id, c] as const)));
  for (const f of p.features) {
    const API = `coverage/${f.name}/api.json`;
    const UI = `coverage/${f.name}/ui.json`;
    const ACL = `coverage/${f.name}/acl.json`;
    const saved = new Set<string>();
    f.api.forEach((c, i) => {
      const path = `checks[${i}]`;
      allIds.push({ id: c.id, file: API, path: `${path}.id` });
      checkRole(API, `${path}.role`, c.role);
      checkParams(API, path, c.endpoint, c.params);
      for (const ref of [...savedRefs(c.params, `${path}.params`), ...savedRefs(c.body, `${path}.body`), ...savedRefs(c.expect.values, `${path}.expect.values`)]) {
        if (!saved.has(ref.name)) add(API, ref.path, `"{${ref.name}}" is not saved by an earlier check in this feature`);
      }
      for (const name of Object.keys(c.save ?? {})) saved.add(name);
    });
    f.ui.checks.forEach((c, i) => {
      const path = `checks[${i}]`;
      allIds.push({ id: c.id, file: UI, path: `${path}.id` });
      checkRole(UI, `${path}.role`, c.role);
      checkPage(UI, `${path}.start`, c.start);
      checkSteps(UI, `${path}.steps`, c.steps);
    });
    f.acl.forEach((r, i) => {
      const path = `rules[${i}]`;
      allIds.push({ id: r.id, file: ACL, path: `${path}.id` });
      checkRole(ACL, `${path}.role`, r.role);
      const setupSaves = new Set<string>();
      (r.setup ?? []).forEach((id, j) => {
        const c = apiCheckById.get(id);
        if (!c) add(ACL, `${path}.setup[${j}]`, `unknown check "${id}" (setup must name API checks)`);
        for (const name of Object.keys(c?.save ?? {})) setupSaves.add(name);
      });
      if ('endpoint' in r.target) {
        checkParams(ACL, `${path}.target`, r.target.endpoint, r.target.params);
        for (const ref of [...savedRefs(r.target.params, `${path}.target.params`), ...savedRefs(r.target.body, `${path}.target.body`)]) {
          if (!setupSaves.has(ref.name)) add(ACL, ref.path, `"{${ref.name}}" is not saved by this rule's setup checks`);
        }
        if ('allowed' in r.expect) add(ACL, `${path}.expect`, 'an endpoint rule expects a status, e.g. { "status": 403 }');
      } else {
        checkPage(ACL, `${path}.target.page`, r.target.page);
        if ('status' in r.expect) add(ACL, `${path}.expect`, 'a page rule expects { "allowed": true|false }');
        else if (r.expect.denied) checkElement(ACL, `${path}.expect.denied`, r.expect.denied);
      }
    });
  }
  dupes(allIds, 'id', add);
  for (const f of p.features) {
    for (const [file, checks] of [[`coverage/${f.name}/api.json`, f.api], [`coverage/${f.name}/ui.json`, f.ui.checks]] as const) {
      const seen = new Map<string, number>();
      checks.forEach((c, i) => {
        const first = seen.get(c.title);
        if (first !== undefined) add(file, `checks[${i}].title`, `duplicate title "${c.title}" in this feature (also checks[${first}]): Playwright needs unique test titles`);
        else seen.set(c.title, i);
      });
    }
  }
  return problems;
}

function dupes(items: { id: string; file: string; path: string }[], kind: string, add: (file: string, path: string, message: string) => void) {
  const first = new Map<string, string>();
  for (const { id, file, path } of items) {
    const seen = first.get(id);
    if (seen) add(file, path, `duplicate ${kind} "${id}" (also in ${seen})`);
    else first.set(id, file);
  }
}
