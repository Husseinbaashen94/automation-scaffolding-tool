import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import type { Feature, Project } from './types.js';

function lineCol(text: string, message: string): string {
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return `${lc[1]}:${lc[2]}`;
  const pos = Number(/position (\d+)/.exec(message)?.[1]);
  if (Number.isNaN(pos)) return '?:?';
  const before = text.slice(0, pos).split('\n');
  return `${before.length}:${before.at(-1)!.length + 1}`;
}

const pointerToPath = (pointer: string) => pointer.split('/').filter(Boolean).reduce((acc, part) => (/^\d+$/.test(part) ? `${acc}[${part}]` : acc ? `${acc}.${part}` : part), '');

/** Loads and checks every coverage file. Errors name the file and the field, so they can be fixed quickly. */
export function loadCoverage(root: string): Project {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schemaDir = join(root, 'schemas');
  for (const file of readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, file), 'utf8')), file);

  const problems: string[] = [];
  const read = (file: string, fallback?: object): any => {
    const full = join(root, file);
    if (!existsSync(full)) {
      if (fallback) return fallback;
      problems.push(`${file}: file is missing`);
      return undefined;
    }
    const text = readFileSync(full, 'utf8');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      problems.push(`${file}: not valid JSON at line ${lineCol(text, (e as Error).message)}`);
      return undefined;
    }
    const schema = file === '.qa-suite.json' ? 'qa-suite.schema.json' : `${file.split('/').pop()!.replace('.json', '')}.schema.json`;
    if (!ajv.validate(schema, data)) {
      for (const err of ajv.errors ?? []) problems.push(`${file} ${pointerToPath(err.instancePath)}: ${err.message}`);
    }
    return data;
  };

  const settings = read('.qa-suite.json');
  const shared = { roles: read('coverage/_shared/roles.json', { roles: [] }), endpoints: read('coverage/_shared/endpoints.json', { endpoints: [] }), pages: read('coverage/_shared/pages.json', { pages: [] }) };
  const features: Feature[] = ((settings?.features ?? []) as string[]).map((name) => {
    const api = read(`coverage/${name}/api.json`, { checks: [] });
    const ui = read(`coverage/${name}/ui.json`, { pages: [], checks: [] });
    const acl = read(`coverage/${name}/acl.json`, { rules: [] });
    return { name, api: api?.checks ?? [], ui: { pages: ui?.pages ?? [], checks: ui?.checks ?? [] }, acl: acl?.rules ?? [] };
  });
  if (problems.length) throw new Error(`The coverage files have problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  const { $schema: _, ...rest } = settings;
  return {
    dir: root,
    settings: { ...rest, uiBaseUrl: process.env.UI_BASE_URL || rest.uiBaseUrl, apiBaseUrl: process.env.API_BASE_URL || rest.apiBaseUrl },
    roles: shared.roles.roles,
    endpoints: shared.endpoints.endpoints,
    sharedPages: shared.pages.pages,
    features,
  };
}
