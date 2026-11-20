import { UsageError } from '../cli/errors.js';
import type { CommandSpec } from '../cli/command.js';

export const deleteCommand: CommandSpec = {
  name: 'delete',
  summary: "Remove all coverage of a feature, keeping anything another feature still uses.",
  examples: ['npx delete-qa-suite my-project --feature cart', 'npx delete-qa-suite my-project --feature cart --yes --no-run'],
  needsProject: true,
  options: {
    feature: { type: 'string', value: 'name', description: 'The feature whose coverage to remove (required)' },
    yes: { type: 'boolean', description: 'Skip typing the feature name to confirm' },
  },
  run: async () => {
    throw new UsageError('delete-qa-suite is not implemented yet');
  },
};
