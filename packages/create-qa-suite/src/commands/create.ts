import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandContext, CommandSpec } from '../cli/command.js';
import { UsageError } from '../cli/errors.js';
import { commit } from '../engine/commit.js';
import { loadProject } from '../model/load.js';
import { projectFiles } from '../model/serialize.js';
import type { AclRule, ApiCheck, Endpoint, Feature, Page, Project, UiCheck } from '../model/types.js';
import { pathVars } from '../model/validate.js';

const TEMPLATE = fileURLToPath(new URL('../../template/', import.meta.url));
export const TOOL_VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export const DEFAULT_UI = 'https://www.saucedemo.com';
export const DEFAULT_API = 'https://restful-booker.herokuapp.com';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const NAME = /^[a-z][a-z0-9-]*$/;
/** npm drops some file names from published packages, so the template stores them under other names. */
const RENAMES: Record<string, string> = { gitignore: '.gitignore', 'package.json.tmpl': 'package.json', 'README.md.tmpl': 'README.md', env: '.env' };

function readTree(root: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const rel = join(entry.parentPath, entry.name).slice(root.length).replace(/^[/\\]/, '').split('\\').join('/');
    const parts = rel.split('/');
    parts[parts.length - 1] = RENAMES[parts.at(-1)!] ?? parts.at(-1)!;
    files.set(parts.join('/'), readFileSync(join(entry.parentPath, entry.name), 'utf8'));
  }
  return files;
}

const envNames = (envExample: string) => envExample.split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => l.slice(0, l.indexOf('=')));

/** Every file of a new project: the template, plus the example features (and the demo logins in .env) when asked. */
export function scaffold(opts: { dir: string; name: string; uiBaseUrl: string; apiBaseUrl: string; examples: boolean }): Map<string, string> {
  const files = readTree(join(TEMPLATE, 'base'));
  let features: string[] = [];
  if (opts.examples) {
    for (const [path, text] of readTree(join(TEMPLATE, 'examples'))) files.set(path, text);
    features = JSON.parse(files.get('.qa-suite.json')!).features;
  } else {
    const empty: Project = { dir: opts.dir, settings: { toolVersion: '', uiBaseUrl: '', apiBaseUrl: '', features: [] }, roles: [], endpoints: [], sharedPages: [], features: [] };
    for (const [path, text] of projectFiles(empty)) files.set(path, text);
  }
  const settings = { $schema: './schemas/qa-suite.schema.json', toolVersion: TOOL_VERSION, uiBaseUrl: opts.uiBaseUrl, apiBaseUrl: opts.apiBaseUrl, features };
  files.set('.qa-suite.json', JSON.stringify(settings, null, 2) + '\n');

  const secrets = envNames(files.get('.env.example') ?? '').filter((n) => !n.endsWith('_BASE_URL'));
  const workflow = files.get('.github/workflows/tests.yml')!;
  files.set(
    '.github/workflows/tests.yml',
    secrets.length
      ? workflow.replace('{{envFromSecrets}}', secrets.map((n) => `      ${n}: \${{ secrets.${n} }}`).join('\n'))
      : workflow.replace(/ {4}env:\n\{\{envFromSecrets\}\}\n/, ''),
  );
  const envStep = opts.examples
    ? '3. Your `.env` already holds the demo logins the example features use (see below), so the tests run straight away. When you add roles of your own, add their variables to `.env.example` (with empty values) and to `.env`.'
    : '3. Copy `.env.example` to `.env` and fill in every value. Logins are only ever read from `.env`, which git ignores.';
  const examplesNote = opts.examples
    ? '\n   **Example features:** `login` and `cart` test [Sauce Demo](https://www.saucedemo.com) and `bookings` tests [Restful-Booker](https://restful-booker.herokuapp.com/apidoc/index.html), two public practice apps. Their demo logins (which both sites publish for anyone to use) were written to your `.env` by create-qa-suite. Delete the examples with `npx delete-qa-suite . --feature <name>` when you add your own.\n'
    : '';
  for (const [path, text] of files) files.set(path, text.replaceAll('{{name}}', opts.name).replaceAll('{{examplesNote}}', examplesNote).replaceAll('{{envStep}}', envStep));
  return files;
}

const npmName = (dir: string) => basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '') || 'qa-suite';

async function createProject(ctx: CommandContext): Promise<number> {
  const { dir, values, io } = ctx;
  if (existsSync(join(dir, '.qa-suite.json'))) {
    throw new UsageError(`${dir} is already a QA suite project. To add coverage for a feature, use --feature <name> (with --endpoint, --page or --rule).`);
  }
  if (existsSync(dir) && !statSync(dir).isDirectory()) throw new UsageError(`${dir} is a file, not a folder. Choose a new folder name.`);
  if (existsSync(dir) && readdirSync(dir).length) throw new UsageError(`${dir} is not empty. Choose a new folder name.`);
  const interactive = io.isTTY && !values.yes;
  const ask = async (question: string, fallback: string) => (interactive ? (await io.ask(`${question} (${fallback}): `)) || fallback : fallback);
  const uiBaseUrl = values['ui-base-url'] ?? (await ask('Base URL of the web app to test', DEFAULT_UI));
  const apiBaseUrl = values['api-base-url'] ?? (await ask('Base URL of the API to test', DEFAULT_API));
  const examples = values.empty ? false : !/^n/i.test(await ask('Include the example features (login, cart, bookings)? Y/n', 'Y'));

  const files = scaffold({ dir, name: npmName(dir), uiBaseUrl, apiBaseUrl, examples });
  const notes = examples ? ['The example features test the public practice apps Sauce Demo and Restful-Booker; their demo logins were written to .env (git-ignored).'] : [];
  await commit(ctx, { files }, notes, []);
  if (values['dry-run']) return 0;
  if (!values['skip-install']) {
    try {
      await ctx.deps.install(dir, io);
    } catch (e) {
      io.err(`The project was created in ${dir}, but installing failed: ${(e as Error).message}\nRun \`npm install\` and \`npx playwright install chromium\` in the project folder.`);
      return 1;
    }
  }
  io.out(
    [
      '',
      `Created ${dir}`,
      '',
      'Next steps:',
      `  cd ${dir}`,
      ...(values['skip-install'] ? ['  npm install && npx playwright install chromium'] : []),
      ...(examples ? [] : ['  cp .env.example .env   # then fill in the values', '  npx create-qa-suite . --feature <name> --endpoint "GET /path"   # add coverage']),
      '  npm test',
    ].join('\n'),
  );
  return 0;
}

/** Splits "METHOD /path" into its parts. */
function parseEndpoint(s: string): { method: Endpoint['method']; path: string } {
  const m = /^\s*([A-Za-z]+)\s+(\/\S*)\s*$/.exec(s);
  const method = m?.[1]!.toUpperCase();
  if (!m || !METHODS.includes(method as Endpoint['method'])) throw new UsageError(`"${s}" should look like "METHOD /path", e.g. "POST /orders" (methods: ${METHODS.join(', ')})`);
  return { method: method as Endpoint['method'], path: m[2]! };
}

export type ParsedRule = { role: string; page: string; allowed: boolean } | { role: string; method: Endpoint['method']; path: string; status: number };

/** Parses "guest POST /orders 401" or "guest page:checkout denied|allowed". */
export function parseRule(s: string): ParsedRule {
  const parts = s.trim().split(/\s+/);
  const page = /^page:([a-z][a-z0-9-]*)$/.exec(parts[1] ?? '');
  if (parts.length === 3 && page && /^(denied|allowed)$/.test(parts[2]!)) return { role: parts[0]!, page: page[1]!, allowed: parts[2] === 'allowed' };
  if (parts.length === 4 && /^\d{3}$/.test(parts[3]!)) return { role: parts[0]!, ...parseEndpoint(`${parts[1]} ${parts[2]}`), status: Number(parts[3]) };
  throw new UsageError(`Rule "${s}" should look like "guest POST /orders 401" or "guest page:checkout denied"`);
}

const slug = (s: string) => s.toLowerCase().replace(/[{}]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
const FILL = 'fill-in';

export type AddFeatureOptions = {
  feature: string;
  endpoints: { method: string; path: string; status?: number; role?: string }[];
  pages: { id: string; path: string }[];
  rules: string[];
};

/** Adds a feature with draft coverage. Endpoints that already exist are reused. */
export function addFeature(p: Project, opts: AddFeatureOptions): { project: Project; drafts: string[] } {
  const next: Project = structuredClone(p);
  const name = opts.feature;
  if (!NAME.test(name)) throw new UsageError(`Feature names use lower-case letters, digits and dashes, like "checkout" or "order-history" (got "${name}").`);
  if (next.settings.features.includes(name)) throw new UsageError(`Feature "${name}" already exists (features: ${next.settings.features.join(', ')}). Use update-qa-suite to change it.`);
  const roles = ['guest', ...next.roles.map((r) => r.id)];
  const checkRole = (role: string) => {
    if (!roles.includes(role)) throw new UsageError(`Unknown role "${role}" (roles: ${roles.join(', ')}). Add roles in coverage/_shared/roles.json.`);
  };
  const ids = new Set([...next.features.flatMap((f) => [...f.api, ...f.ui.checks, ...f.acl].map((x) => x.id))]);
  const endpointIds = new Set(next.endpoints.map((e) => e.id));
  const pageIds = new Set([...next.sharedPages, ...next.features.flatMap((f) => f.ui.pages)].map((pg) => pg.id));
  const drafts: string[] = [];

  const endpointFor = (method: Endpoint['method'], path: string): Endpoint => {
    const existing = next.endpoints.find((e) => e.method === method && e.path === path);
    if (existing) return existing;
    const endpoint: Endpoint = {
      id: uniqueId(slug(`${method} ${path}`), endpointIds),
      method,
      path,
      request: { headers: { Accept: 'application/json' }, ...(method === 'GET' || method === 'DELETE' ? {} : { body: {} }) },
      response: { type: 'object' },
    };
    next.endpoints.push(endpoint);
    drafts.push(`coverage/_shared/endpoints.json → ${endpoint.id}: the request body and the response schema`);
    return endpoint;
  };
  const params = (e: Endpoint) => (pathVars(e.path).length ? { params: Object.fromEntries(pathVars(e.path).map((v) => [v, FILL])) } : {});

  const titles = new Set<string>();
  const uniqueTitle = (t: string) => {
    let title = t;
    for (let n = 2; titles.has(title); n++) title = `${t} (${n})`;
    titles.add(title);
    return title;
  };
  const api: ApiCheck[] = opts.endpoints.map((spec) => {
    const { method, path } = parseEndpoint(`${spec.method} ${spec.path}`);
    const role = spec.role ?? 'guest';
    checkRole(role);
    const e = endpointFor(method, path);
    const status = spec.status ?? 200;
    const check: ApiCheck = { id: uniqueId(`${name}-${e.id}`, ids), title: uniqueTitle(`${method} ${path} as ${role} returns ${status}`), endpoint: e.id, role, ...params(e), expect: { status }, draft: true };
    drafts.push(`coverage/${name}/api.json → ${check.id}: the title, path values (params), body overrides and expected values`);
    return check;
  });

  const pages: Page[] = opts.pages.map(({ id, path }) => {
    if (!NAME.test(id)) throw new UsageError(`Page ids use lower-case letters, digits and dashes (got "${id}").`);
    if (pageIds.has(id)) throw new UsageError(`A page "${id}" already exists. Use another id.`);
    if (!path.startsWith('/')) throw new UsageError(`Page paths start with "/" (got "${path}").`);
    pageIds.add(id);
    return { id, path, marker: 'main', elements: { main: `[data-test="${FILL}"]` } };
  });
  const ui: UiCheck[] = pages.map((page) => {
    const check: UiCheck = { id: uniqueId(`${name}-${page.id}-shows`, ids), title: `the ${page.id} page shows`, role: 'guest', start: page.id, steps: [{ visible: `${page.id}.main` }], draft: true };
    drafts.push(`coverage/${name}/ui.json → page ${page.id}: its elements (the "main" locator), and check ${check.id}: the role and steps`);
    return check;
  });

  const acl: AclRule[] = opts.rules.map((text) => {
    const r = parseRule(text);
    checkRole(r.role);
    let rule: AclRule;
    if ('page' in r) {
      if (!pageIds.has(r.page)) throw new UsageError(`Unknown page "${r.page}" in rule "${text}" (pages: ${[...pageIds].join(', ')}).`);
      rule = { id: uniqueId(`${name}-${r.role}-${r.page}-${r.allowed ? 'allowed' : 'denied'}`, ids), role: r.role, target: { page: r.page }, expect: { allowed: r.allowed }, draft: true };
    } else {
      const e = endpointFor(r.method, r.path);
      rule = { id: uniqueId(`${name}-${r.role}-${e.id}-${r.status}`, ids), role: r.role, target: { endpoint: e.id, ...params(e) }, expect: { status: r.status }, draft: true };
    }
    drafts.push(`coverage/${name}/acl.json → ${rule.id}: path values and any setup checks`);
    return rule;
  });

  const feature: Feature = { name, api, ui: { pages, checks: ui }, acl };
  next.features.push(feature);
  next.settings.features.push(name);
  return { project: next, drafts };
}

async function addFeatureCommand(ctx: CommandContext): Promise<number> {
  const { values } = ctx;
  const project = loadProject(ctx.dir);
  const pageIds: string[] = values.page ?? [];
  const paths: string[] = values.path ?? [];
  if (pageIds.length !== paths.length) throw new UsageError('Give one --path for each --page, in the same order.');
  const status = values.status === undefined ? undefined : Number(values.status);
  if (status !== undefined && !(Number.isInteger(status) && status >= 100 && status <= 599)) throw new UsageError(`--status must be an HTTP status code (got "${values.status}").`);
  const { project: next, drafts } = addFeature(project, {
    feature: values.feature,
    endpoints: (values.endpoint ?? []).map((s: string) => ({ ...parseEndpoint(s), status, role: values.role })),
    pages: pageIds.map((id, i) => ({ id, path: paths[i]! })),
    rules: values.rule ?? [],
  });
  const notes = drafts.length
    ? ['Drafts to fill in (each is reported as a to-do, not run, until you remove its "draft": true):', ...drafts.map((d) => `  - ${d}`)]
    : [`Feature "${values.feature}" added with empty coverage files to fill in.`];
  const added = next.features.at(-1)!;
  const hasTests = added.api.length + added.ui.checks.length + added.acl.length > 0;
  return commit(ctx, { project: next }, notes, hasTests ? [values.feature] : []);
}

export const createCommand: CommandSpec = {
  name: 'create',
  summary: 'Create a Playwright test project with UI, API and access-control coverage, or add a feature to one.',
  examples: [
    'npx create-qa-suite my-project',
    'npx create-qa-suite my-project --empty --yes',
    'npx create-qa-suite my-project --feature orders --endpoint "POST /orders" --status 201 --role admin',
    'npx create-qa-suite my-project --feature checkout --page checkout --path /checkout.html --rule "guest page:checkout denied"',
  ],
  needsProject: false,
  options: {
    empty: { type: 'boolean', description: 'New project without the example features' },
    yes: { type: 'boolean', description: 'Accept the defaults instead of asking' },
    'skip-install': { type: 'boolean', description: "Don't run npm install or install the browser" },
    'ui-base-url': { type: 'string', value: 'url', description: 'Base URL of the web app (new project)' },
    'api-base-url': { type: 'string', value: 'url', description: 'Base URL of the API (new project)' },
    feature: { type: 'string', value: 'name', description: 'Add coverage for a new feature to an existing project' },
    endpoint: { type: 'string', multiple: true, value: '"METHOD /path"', description: 'Add an API check (repeatable)' },
    status: { type: 'string', value: 'code', description: 'Expected status for the added API checks (default 200)' },
    role: { type: 'string', value: 'role', description: 'Role for the added API checks (default guest)' },
    page: { type: 'string', multiple: true, value: 'id', description: 'Add a page with a check that it shows (repeatable, with --path)' },
    path: { type: 'string', multiple: true, value: '/path', description: 'Path of each --page, in the same order' },
    rule: { type: 'string', multiple: true, value: 'rule', description: 'Add an access rule: "guest POST /orders 401" or "guest page:checkout denied" (repeatable)' },
  },
  run: (ctx) => (ctx.values.feature !== undefined ? addFeatureCommand(ctx) : createProject(ctx)),
};
