import { UsageError } from '../cli/errors.js';
import type { CommandSpec } from '../cli/command.js';

export const updateCommand: CommandSpec = {
  name: 'update',
  summary: 'Apply one change in the application to every place the coverage uses it.',
  examples: [
    'npx update-qa-suite my-project --feature bookings --endpoint "GET /booking/{bookingId}" --to "GET /bookings/{bookingId}"',
    'npx update-qa-suite my-project --feature bookings --endpoint create-booking --request-field firstname --rename first_name',
    'npx update-qa-suite my-project --feature bookings --endpoint create-booking --response-field bookingid --rename id',
    'npx update-qa-suite my-project --feature login --page login --element login-button --locator "[data-test=\\"login\\"]"',
    'npx update-qa-suite my-project --feature cart --page inventory --element cart-badge --expect text=2 --from 2',
  ],
  needsProject: true,
  options: {
    feature: { type: 'string', value: 'name', description: 'The feature you are working on (required)' },
    endpoint: { type: 'string', value: '"METHOD /path" or id', description: 'The endpoint to change' },
    to: { type: 'string', value: '"METHOD /path"', description: 'Endpoint change: the new method and/or path' },
    'request-field': { type: 'string', value: 'field.path', description: 'Request payload change: the body field' },
    'response-field': { type: 'string', value: 'field.path', description: 'Response payload change: the response field' },
    rename: { type: 'string', value: 'new-name', description: 'Rename the field' },
    remove: { type: 'boolean', description: 'Remove the field' },
    add: { type: 'string', value: 'name=value | name:type', description: 'Add a field (request: name=value; response: name:type)' },
    set: { type: 'string', value: 'name=value', description: "Set a request field's default value" },
    page: { type: 'string', value: 'id', description: 'Element or UI value change: the page' },
    element: { type: 'string', value: 'name', description: 'Element or UI value change: the element' },
    locator: { type: 'string', value: 'selector', description: "Element change: the element's new Playwright selector" },
    expect: { type: 'string', value: 'what=value', description: 'Value change: status=201, field.path=value, text=…, value=… or count=n' },
    check: { type: 'string', value: 'id', description: 'Value change: only this check' },
    from: { type: 'string', value: 'old-value', description: 'Value change: only checks expecting this value now' },
  },
  run: async () => {
    throw new UsageError('update-qa-suite is not implemented yet');
  },
};
