import type { Feature, Project } from './types.js';

export const FEATURE_FILES = ['api', 'ui', 'acl'] as const;

/** Which schema checks each coverage file, by its path in the project. */
export function schemaFor(path: string): string {
  if (path === '.qa-suite.json') return 'qa-suite.schema.json';
  const name = path.split('/').pop()!.replace(/\.json$/, '');
  return `${name}.schema.json`;
}

const relSchema = (path: string) => (path === '.qa-suite.json' ? './schemas/' : '../../schemas/') + schemaFor(path);
const json = (path: string, body: object) => JSON.stringify({ $schema: relSchema(path), ...body }, null, 2) + '\n';

export const featureFiles = (f: Feature): [string, string][] => [
  [`coverage/${f.name}/api.json`, json(`coverage/${f.name}/api.json`, { checks: f.api })],
  [`coverage/${f.name}/ui.json`, json(`coverage/${f.name}/ui.json`, { pages: f.ui.pages, checks: f.ui.checks })],
  [`coverage/${f.name}/acl.json`, json(`coverage/${f.name}/acl.json`, { rules: f.acl })],
];

/** The exact contents of every coverage file of a project (2-space JSON, trailing newline). */
export function projectFiles(p: Project): Map<string, string> {
  const { toolVersion, uiBaseUrl, apiBaseUrl, features } = p.settings;
  return new Map<string, string>([
    ['.qa-suite.json', json('.qa-suite.json', { toolVersion, uiBaseUrl, apiBaseUrl, features })],
    ['coverage/_shared/roles.json', json('coverage/_shared/roles.json', { roles: p.roles })],
    ['coverage/_shared/endpoints.json', json('coverage/_shared/endpoints.json', { endpoints: p.endpoints })],
    ['coverage/_shared/pages.json', json('coverage/_shared/pages.json', { pages: p.sharedPages })],
    ...p.features.flatMap(featureFiles),
  ]);
}
