import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSchema } from './schema.js';
import { schemaFor } from './serialize.js';
import type { Feature, Problem, Project } from './types.js';

/** Thrown when coverage files can't be read: every problem names the file and the place in it. */
export class CoverageError extends Error {
  constructor(readonly problems: Problem[]) {
    super(problems.map((p) => `${p.file}${p.path ? ` ${p.path}` : ''}: ${p.message}`).join('\n'));
    this.name = 'CoverageError';
  }
}

function lineCol(text: string, error: SyntaxError): string {
  const pos = Number(/position (\d+)/.exec(error.message)?.[1] ?? /\((\d+)\)/.exec(error.message)?.[1]);
  const lc = /line (\d+) column (\d+)/.exec(error.message);
  if (lc) return `${lc[1]}:${lc[2]}`;
  if (Number.isNaN(pos)) return '?:?';
  const before = text.slice(0, pos).split('\n');
  return `${before.length}:${before.at(-1)!.length + 1}`;
}

/** Reads one coverage file; missing optional files return `fallback`. Problems are collected, not thrown. */
function readJson(dir: string, file: string, problems: Problem[], fallback?: object): any {
  const full = join(dir, file);
  if (!existsSync(full)) {
    if (fallback) return fallback;
    problems.push({ file, path: '', message: 'file is missing' });
    return undefined;
  }
  const text = readFileSync(full, 'utf8');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    problems.push({ file, path: '', message: `not valid JSON at line ${lineCol(text, e as SyntaxError)} (${(e as Error).message})` });
    return undefined;
  }
  for (const err of checkSchema(schemaFor(file), data)) problems.push({ file, ...err });
  return data;
}

/** Loads a QA suite project. Throws CoverageError if any file is missing, not JSON, or the wrong shape. */
export function loadProject(dir: string): Project {
  if (!existsSync(join(dir, '.qa-suite.json'))) {
    throw new CoverageError([{ file: '.qa-suite.json', path: '', message: `not a QA suite project (no .qa-suite.json in ${dir}). Create one with: npx create-qa-suite <folder>` }]);
  }
  const problems: Problem[] = [];
  const settings = readJson(dir, '.qa-suite.json', problems);
  const roles = readJson(dir, 'coverage/_shared/roles.json', problems, { roles: [] });
  const endpoints = readJson(dir, 'coverage/_shared/endpoints.json', problems, { endpoints: [] });
  const pages = readJson(dir, 'coverage/_shared/pages.json', problems, { pages: [] });
  const features: Feature[] = (Array.isArray(settings?.features) ? (settings.features as unknown[]).filter((n): n is string => typeof n === 'string') : []).map((name) => {
    const api = readJson(dir, `coverage/${name}/api.json`, problems, { checks: [] });
    const ui = readJson(dir, `coverage/${name}/ui.json`, problems, { pages: [], checks: [] });
    const acl = readJson(dir, `coverage/${name}/acl.json`, problems, { rules: [] });
    return { name, api: api?.checks ?? [], ui: { pages: ui?.pages ?? [], checks: ui?.checks ?? [] }, acl: acl?.rules ?? [] };
  });
  if (problems.length) throw new CoverageError(problems);
  const { $schema: _, ...rest } = settings;
  return { dir, settings: rest, roles: roles.roles, endpoints: endpoints.endpoints, sharedPages: pages.pages, features };
}
