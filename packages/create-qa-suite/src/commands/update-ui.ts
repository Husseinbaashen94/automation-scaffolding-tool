import { UsageError } from '../cli/errors.js';
import { parseEndpointRef } from '../engine/refs.js';
import type { AclRule, Feature, Page, Project, Step, Value } from '../model/types.js';
import { stepElement, stepPage } from '../model/validate.js';
import type { UpdateResult } from './update.js';

const allPages = (p: Project): Page[] => [...p.sharedPages, ...p.features.flatMap((f) => f.ui.pages)];
const inOrder = (p: Project, names: Set<string>) => p.settings.features.filter((f) => names.has(f));

/** Roles a feature acts as in the browser (UI checks and page access rules). */
const uiRoles = (f: Feature) => new Set([...f.ui.checks.map((c) => c.role), ...f.acl.filter((r) => 'page' in r.target).map((r) => r.role)]);

/** Features whose browser tests touch a page element: in steps, access rules, page markers, or a role's login flow. */
function featuresUsingElement(p: Project, page: Page, element: string): Set<string> {
  const ref = `${page.id}.${element}`;
  const loginRoles = new Set(p.roles.filter((r) => r.ui?.loginFlow.some((s) => stepElement(s) === ref)).map((r) => r.id));
  const out = new Set<string>();
  for (const f of p.features) {
    const inSteps = f.ui.checks.some((c) => c.steps.some((s) => stepElement(s) === ref));
    const inRules = f.acl.some((r: AclRule) => ('allowed' in r.expect && r.expect.denied === ref) || ('page' in r.target && r.target.page === page.id && page.marker === element));
    const viaLogin = [...uiRoles(f)].some((role) => loginRoles.has(role));
    if (inSteps || inRules || viaLogin) out.add(f.name);
  }
  return out;
}

/** Features that use a page at all (own it, open it, check it, or log in through it). */
function featuresUsingPage(p: Project, page: Page): Set<string> {
  const out = new Set<string>();
  for (const f of p.features) {
    const own = f.ui.pages.some((pg) => pg.id === page.id);
    const viaSteps = f.ui.checks.some((c) => c.start === page.id || c.steps.some((s) => stepPage(s) === page.id || stepElement(s)?.startsWith(`${page.id}.`)));
    const viaRules = f.acl.some((r) => ('page' in r.target && r.target.page === page.id) || ('allowed' in r.expect && r.expect.denied?.startsWith(`${page.id}.`)));
    if (own || viaSteps || viaRules) out.add(f.name);
  }
  for (const name of Object.keys(page.elements)) for (const f of featuresUsingElement(p, page, name)) out.add(f);
  return out;
}

function findPageAndElement(p: Project, pageId: string | undefined, element: string | undefined): Page {
  if (!pageId || !element) throw new UsageError('Element and UI value changes need both --page and --element.');
  const page = allPages(p).find((pg) => pg.id === pageId);
  if (!page) throw new UsageError(`No page "${pageId}" (pages: ${allPages(p).map((pg) => pg.id).join(', ')})`);
  if (!(element in page.elements)) throw new UsageError(`No element "${element}" on page ${pageId} (elements: ${Object.keys(page.elements).join(', ')})`);
  return page;
}

/** Element change: the one definition every step, rule and login flow refers to. */
export function planElementChange(p: Project, feature: string, pageId: string | undefined, element: string | undefined, locator: string): UpdateResult {
  const next = structuredClone(p);
  const page = findPageAndElement(next, pageId, element);
  const users = featuresUsingPage(next, page);
  if (!users.has(feature)) throw new UsageError(`Page ${page.id} isn't used by feature "${feature}" (used by: ${inOrder(next, users).join(', ') || 'no feature'}).`);
  const old = page.elements[element!];
  page.elements[element!] = locator;
  const affected = featuresUsingElement(next, page, element!);
  affected.add(feature);
  const list = inOrder(next, affected);
  const shared = next.sharedPages.includes(page);
  return {
    project: next,
    notes: [`Element ${page.id}.${element}: ${old} → ${locator}${shared ? ' (shared page)' : ''}`, `Affected features: ${list.join(', ')}`],
    affectedFeatures: list,
  };
}

type Candidate = { id: string; old: Value; set: (v: Value) => void };
const VALUE_KINDS = ['text', 'value', 'count'] as const;

function parseExpectation(expectation: string): [string, string] {
  const i = expectation.indexOf('=');
  if (i < 1) throw new UsageError(`--expect should look like status=201, field.path=value, text=…, value=… or count=n (got "${expectation}")`);
  return [expectation.slice(0, i), expectation.slice(i + 1)];
}

const parseJson = (s: string): Value => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

function newValue(kind: string, raw: string): Value {
  if (kind === 'status') {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 100 || n > 599) throw new UsageError(`status must be an HTTP status code (got "${raw}")`);
    return n;
  }
  if (kind === 'count') {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new UsageError(`count must be a whole number (got "${raw}")`);
    return n;
  }
  if (kind === 'text' || kind === 'value') return raw;
  return parseJson(raw);
}

/** Value change: only checks in the named feature; ambiguous matches must be narrowed with --check or --from. */
export function planValueChange(
  p: Project,
  feature: string,
  target: { endpoint: string } | { page?: string; element?: string },
  expectation: string,
  narrow: { check?: string; from?: string },
): UpdateResult {
  const next = structuredClone(p);
  const f = next.features.find((x) => x.name === feature)!;
  const [kind, raw] = parseExpectation(expectation);
  let candidates: Candidate[];
  let what: string;
  if ('endpoint' in target) {
    const e = parseEndpointRef(next, target.endpoint);
    what = kind === 'status' ? `status on ${e.id}` : `${kind} on ${e.id}`;
    if (kind === 'status') {
      candidates = [
        ...f.api.filter((c) => c.endpoint === e.id).map((c) => ({ id: c.id, old: c.expect.status, set: (v: Value) => void (c.expect.status = v as number) })),
        ...f.acl.flatMap((r) => ('endpoint' in r.target && r.target.endpoint === e.id && 'status' in r.expect ? [{ id: r.id, old: r.expect.status, set: (v: Value) => void ((r.expect as { status: number }).status = v as number) }] : [])),
      ];
    } else {
      candidates = f.api.filter((c) => c.endpoint === e.id && c.expect.values && kind in c.expect.values).map((c) => ({ id: c.id, old: c.expect.values![kind]!, set: (v: Value) => void (c.expect.values![kind] = v) }));
    }
  } else {
    const page = findPageAndElement(next, target.page, target.element);
    if (!(VALUE_KINDS as readonly string[]).includes(kind)) throw new UsageError(`A UI value change is text=…, value=… or count=n (got "${kind}")`);
    const ref = `${page.id}.${target.element}`;
    what = `${kind} on ${ref}`;
    candidates = f.ui.checks.flatMap((c) =>
      c.steps.flatMap((s: Step, i) => (kind in s && (s as Record<string, Value>)[kind] === ref ? [{ id: c.id, old: (s as { equals: Value }).equals, set: (v: Value) => void ((c.steps[i] as { equals: Value }).equals = v) }] : [])),
    );
  }
  if (!candidates.length) throw new UsageError(`No check in feature "${feature}" expects ${what}.`);
  const listing = (cs: Candidate[]) => cs.map((c) => `  - ${c.id}: ${JSON.stringify(c.old)}`).join('\n');
  const chosen = candidates.filter((c) => (narrow.check === undefined || c.id === narrow.check) && (narrow.from === undefined || String(c.old) === narrow.from));
  if (!chosen.length) throw new UsageError(`Nothing matches --check/--from. The checks expecting ${what}:\n${listing(candidates)}`);
  if (new Set(chosen.map((c) => JSON.stringify(c.old))).size > 1) {
    throw new UsageError(`These checks expect different values for ${what}:\n${listing(chosen)}\nSay which to change with --check <id> or --from <current value>.`);
  }
  const value = newValue(kind, raw);
  for (const c of chosen) c.set(value);
  return {
    project: next,
    notes: [`Changed ${chosen.length} expectation(s) of ${what}: ${JSON.stringify(chosen[0]!.old)} → ${JSON.stringify(value)} (${[...new Set(chosen.map((c) => c.id))].join(', ')})`, `Affected features: ${feature}`],
    affectedFeatures: [feature],
  };
}
