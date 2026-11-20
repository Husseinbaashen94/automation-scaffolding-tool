import { join } from 'node:path';
import { loadCoverage } from './load.js';
import type { Endpoint, Page, Project, Role } from './types.js';

/** The project's coverage, loaded once per test file, with lookups the specs need. */
export const coverage: Project = loadCoverage(join(import.meta.dirname, '..'));

const pages = new Map<string, Page>([...coverage.sharedPages, ...coverage.features.flatMap((f) => f.ui.pages)].map((p) => [p.id, p]));

export function findPage(id: string): Page {
  const page = pages.get(id);
  if (!page) throw new Error(`unknown page "${id}" (pages: ${[...pages.keys()].join(', ')})`);
  return page;
}

export function findElement(ref: string): string {
  const [pageId, name] = ref.split('.') as [string, string];
  const page = findPage(pageId);
  const locator = page.elements[name];
  if (!locator) throw new Error(`unknown element "${ref}" (${pageId} has: ${Object.keys(page.elements).join(', ')})`);
  return locator;
}

export function findEndpoint(id: string): Endpoint {
  const e = coverage.endpoints.find((x) => x.id === id);
  if (!e) throw new Error(`unknown endpoint "${id}"`);
  return e;
}

export function findRole(id: string): Role | undefined {
  return id === 'guest' ? undefined : coverage.roles.find((r) => r.id === id);
}

export const apiCheck = (id: string) => {
  const c = coverage.features.flatMap((f) => f.api).find((x) => x.id === id);
  if (!c) throw new Error(`unknown API check "${id}"`);
  return c;
};

/** Playwright tags for a feature's tests: run one feature with --grep "@<feature>(?![\\w-])". */
export const tags = (feature: string, kind: 'api' | 'ui' | 'acl') => [`@${feature}`, `@${kind}`];
