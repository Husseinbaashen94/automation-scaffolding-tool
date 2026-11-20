import { UsageError } from '../cli/errors.js';
import type { CommandSpec } from '../cli/command.js';

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
  run: async () => {
    throw new UsageError('create-qa-suite is not implemented yet');
  },
};
