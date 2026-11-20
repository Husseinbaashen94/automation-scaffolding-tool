import type { CommandContext, CommandSpec } from '../cli/command.js';
import { UsageError } from '../cli/errors.js';
import { commit } from '../engine/commit.js';
import {
  fieldPaths, hasField, parseEndpointRef, removeField, renameField, renamePathPrefix, SCHEMA_TYPES, schemaAddProperty,
  schemaHasProperty, schemaPaths, schemaRemoveProperty, schemaRenameProperty, setField,
} from '../engine/refs.js';
import { loadProject } from '../model/load.js';
import type { AclRule, AclTarget, ApiCheck, Endpoint, Project, Value } from '../model/types.js';
import { pathVars } from '../model/validate.js';
import { planElementChange, planValueChange } from './update-ui.js';

export type UpdateResult = { project: Project; notes: string[]; affectedFeatures: string[] };
export type FieldOp = { field: string } & ({ rename: string } | { remove: true } | { add: string } | { set: string });

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
type EndpointRule = AclRule & { target: Extract<AclTarget, { endpoint: string }> };
type EndpointTarget = { feature: string; kind: 'check'; item: ApiCheck } | { feature: string; kind: 'rule'; item: EndpointRule };

/** Every check and access rule (in any feature) that calls an endpoint. */
export function usesOf(p: Project, endpointId: string): EndpointTarget[] {
  return p.features.flatMap((f) => [
    ...f.api.filter((c) => c.endpoint === endpointId).map((item) => ({ feature: f.name, kind: 'check' as const, item })),
    ...f.acl.filter((r) => 'endpoint' in r.target && r.target.endpoint === endpointId).map((item) => ({ feature: f.name, kind: 'rule' as const, item: item as EndpointRule })),
  ]);
}

const featuresOf = (uses: EndpointTarget[]) => [...new Set(uses.map((u) => u.feature))];
const parseValue = (s: string): Value => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
function splitPair(s: string, sep: '=' | ':', flag: string, example: string): [string, string] {
  const i = s.indexOf(sep);
  if (i < 1) throw new UsageError(`${flag} should look like ${example} (got "${s}")`);
  return [s.slice(0, i), s.slice(i + 1)];
}

/** Endpoint change: new method and/or path. Path-variable renames carry over to every check and rule. */
export function planEndpointChange(p: Project, ref: string, to: string): UpdateResult {
  const next = structuredClone(p);
  const e = parseEndpointRef(next, ref);
  const m = /^\s*(?:([A-Za-z]+)\s*)?(\/\S*)?\s*$/.exec(to);
  const method = (m?.[1] ?? e.method).toUpperCase();
  const path = m?.[2] ?? e.path;
  if (!m || (!m[1] && !m[2]) || !METHODS.includes(method)) throw new UsageError(`--to should be "METHOD /path", "/path" or "METHOD" (got "${to}")`);
  const clash = next.endpoints.find((x) => x !== e && x.method === method && x.path === path);
  if (clash) throw new UsageError(`${method} ${path} already exists (${clash.id}).`);
  const before = pathVars(e.path);
  const after = pathVars(path);
  if (before.length !== after.length) {
    throw new UsageError(`path variables changed from {${before.join(', ')}} to {${after.join(', ')}}: add or remove the checks' params by hand, or change the path in two steps.`);
  }
  const uses = usesOf(next, e.id);
  const renames = new Map(before.map((v, i) => [v, after[i]!] as const).filter(([a, b]) => a !== b));
  if (renames.size) {
    for (const u of uses) {
      const holder = u.kind === 'check' ? u.item : u.item.target;
      if (holder.params) holder.params = Object.fromEntries(Object.entries(holder.params).map(([k, v]) => [renames.get(k) ?? k, v]));
    }
  }
  const was = `${e.method} ${e.path}`;
  e.method = method as Endpoint['method'];
  e.path = path;
  const affected = featuresOf(uses);
  return {
    project: next,
    notes: [
      `Endpoint ${e.id}: ${was} → ${e.method} ${e.path}`,
      ...(renames.size ? [`Path variables renamed in ${uses.length} check(s) and rule(s): ${[...renames].map(([a, b]) => `{${a}} → {${b}}`).join(', ')}`] : []),
      `Affected features: ${affected.join(', ') || '(none)'}`,
    ],
    affectedFeatures: affected,
  };
}

/** Request payload change: rename/remove a body field everywhere, or add/set a default value. */
export function planRequestField(p: Project, ref: string, op: FieldOp): UpdateResult {
  const next = structuredClone(p);
  const e = parseEndpointRef(next, ref);
  const uses = usesOf(next, e.id);
  const overrides = uses.map((u) => (u.kind === 'check' ? u.item.body : u.item.target.body)).filter((b): b is Record<string, Value> => !!b);
  const field = op.field;
  const known = () => [...new Set([...fieldPaths(e.request?.body), ...overrides.flatMap((b) => fieldPaths(b))])];
  const exists = hasField(e.request?.body, field) || overrides.some((b) => hasField(b, field));
  let note: string;
  if ('rename' in op || 'remove' in op) {
    if (!exists) throw new UsageError(`No request field "${field}" on ${e.method} ${e.path}. Fields: ${known().join(', ') || '(none)'}`);
    const apply = 'rename' in op ? (b: Value | undefined) => renameField(b, field, op.rename) : (b: Value | undefined) => removeField(b, field);
    const inDefault = apply(e.request?.body);
    const inOverrides = overrides.filter((b) => apply(b)).length;
    note = `Request field ${field} ${'rename' in op ? `renamed to ${op.rename}` : 'removed'} on ${e.id} (${inDefault ? 'default body and ' : ''}${inOverrides} check override(s))`;
  } else {
    const [name, raw] = splitPair('add' in op ? op.add : op.set, '=', 'add' in op ? '--add' : '--set', 'name=value');
    if (name !== field) throw new UsageError(`--request-field is "${field}" but the value is for "${name}"`);
    const body = (e.request ??= {}).body ?? {};
    if (typeof body !== 'object' || Array.isArray(body) || body === null) throw new UsageError(`${e.id}'s default body is not an object`);
    if ('add' in op && hasField(body, field)) throw new UsageError(`Request field "${field}" already exists on ${e.id}; use --set to change its value.`);
    if ('set' in op && !hasField(body, field)) throw new UsageError(`No request field "${field}" in ${e.id}'s default body; use --add. Fields: ${fieldPaths(body).join(', ') || '(none)'}`);
    setField(body, field, parseValue(raw));
    e.request.body = body;
    note = `Request field ${field} ${'add' in op ? 'added to' : 'set in'} ${e.id}'s default body: ${raw}`;
  }
  const affected = featuresOf(uses);
  return { project: next, notes: [note, `Affected features: ${affected.join(', ') || '(none)'}`], affectedFeatures: affected };
}

/** Response payload change: the schema, plus every expected value and saved value that reads the field. */
export function planResponseField(p: Project, ref: string, op: FieldOp): UpdateResult {
  const next = structuredClone(p);
  const e = parseEndpointRef(next, ref);
  if (!e.response) throw new UsageError(`${e.id} has no response schema to change; add one in coverage/_shared/endpoints.json.`);
  const field = op.field;
  const checks = usesOf(next, e.id).filter((u) => u.kind === 'check').map((u) => u.item as ApiCheck);
  const readers = checks.flatMap((c) => [
    ...Object.keys(c.expect.values ?? {}).filter((k) => renamePathPrefix(k, field, '_') !== undefined).map((k) => `${c.id}: expect.values.${k}`),
    ...Object.entries(c.save ?? {}).filter(([, v]) => renamePathPrefix(v, field, '_') !== undefined).map(([k]) => `${c.id}: save.${k}`),
  ]);
  let note: string;
  if ('rename' in op) {
    if (!schemaHasProperty(e.response, field)) throw new UsageError(`No response field "${field}" in ${e.id}'s schema. Fields: ${schemaPaths(e.response).join(', ')}`);
    schemaRenameProperty(e.response, field, op.rename);
    for (const c of checks) {
      if (c.expect.values) c.expect.values = Object.fromEntries(Object.entries(c.expect.values).map(([k, v]) => [renamePathPrefix(k, field, op.rename) ?? k, v]));
      if (c.save) c.save = Object.fromEntries(Object.entries(c.save).map(([k, v]) => [k, renamePathPrefix(v, field, op.rename) ?? v]));
    }
    note = `Response field ${field} renamed to ${op.rename} in ${e.id}'s schema${readers.length ? ` and in ${readers.length} expected/saved value(s)` : ''}`;
  } else if ('remove' in op) {
    if (!schemaHasProperty(e.response, field)) throw new UsageError(`No response field "${field}" in ${e.id}'s schema. Fields: ${schemaPaths(e.response).join(', ')}`);
    if (readers.length) throw new UsageError(`Checks still read "${field}"; change or remove these first:\n${readers.map((r) => `  - ${r}`).join('\n')}`);
    schemaRemoveProperty(e.response, field);
    note = `Response field ${field} removed from ${e.id}'s schema`;
  } else if ('add' in op) {
    const [name, type] = splitPair(op.add, ':', '--add', 'name:type, e.g. nights:number');
    if (name !== field) throw new UsageError(`--response-field is "${field}" but --add is for "${name}"`);
    if (!SCHEMA_TYPES.includes(type)) throw new UsageError(`Unknown type "${type}" (types: ${SCHEMA_TYPES.join(', ')})`);
    if (schemaHasProperty(e.response, field)) throw new UsageError(`Response field "${field}" already exists in ${e.id}'s schema.`);
    if (!schemaAddProperty(e.response, field, type)) throw new UsageError(`The parent of "${field}" is not in ${e.id}'s schema. Fields: ${schemaPaths(e.response).join(', ')}`);
    note = `Response field ${field} (${type}) added to ${e.id}'s schema as required`;
  } else throw new UsageError('A response field takes --rename, --remove or --add name:type (not --set).');
  const affected = featuresOf(usesOf(next, e.id));
  return { project: next, notes: [note, `Affected features: ${affected.join(', ') || '(none)'}`], affectedFeatures: affected };
}

const SHAPES = [
  'Endpoint:          --endpoint "GET /old" --to "GET /new"',
  'Request payload:   --endpoint <endpoint> --request-field <field> --rename <name> | --remove | --add name=value | --set name=value',
  'Response payload:  --endpoint <endpoint> --response-field <field> --rename <name> | --remove | --add name:type',
  'Element:           --page <page> --element <element> --locator <selector>',
  'Value:             --endpoint <endpoint> --expect status=201 | field=value   or   --page <page> --element <element> --expect text=… | value=… | count=n',
].map((s) => `  ${s}`);

function fieldOp(values: Record<string, any>, field: string): FieldOp {
  const ops = (['rename', 'remove', 'add', 'set'] as const).filter((k) => values[k] !== undefined && values[k] !== false);
  if (ops.length !== 1) throw new UsageError(`Give exactly one of --rename, --remove, --add or --set with --request-field/--response-field.`);
  const op = ops[0]!;
  return { field, ...(op === 'remove' ? { remove: true } : { [op]: values[op] }) } as FieldOp;
}

async function runUpdate(ctx: CommandContext): Promise<number> {
  const v = ctx.values;
  if (!v.feature) throw new UsageError('--feature is required: name the feature you are working on.');
  const project = loadProject(ctx.dir);
  if (!project.settings.features.includes(v.feature)) throw new UsageError(`No feature "${v.feature}" (features: ${project.settings.features.join(', ')})`);
  let result: UpdateResult;
  if (v.expect !== undefined) result = planValueChange(project, v.feature, v.endpoint !== undefined ? { endpoint: v.endpoint } : { page: v.page, element: v.element }, v.expect, { check: v.check, from: v.from });
  else if (v.locator !== undefined) result = planElementChange(project, v.feature, v.page, v.element, v.locator);
  else if (v.endpoint !== undefined && (v.to !== undefined || v['request-field'] !== undefined || v['response-field'] !== undefined)) {
    const e = parseEndpointRef(project, v.endpoint);
    const users = featuresOf(usesOf(project, e.id));
    if (!users.includes(v.feature)) throw new UsageError(`Endpoint ${e.id} isn't used by feature "${v.feature}" (used by: ${users.join(', ') || 'no feature'}).`);
    if (v.to !== undefined) result = planEndpointChange(project, v.endpoint, v.to);
    else if (v['request-field'] !== undefined) result = planRequestField(project, v.endpoint, fieldOp(v, v['request-field']));
    else result = planResponseField(project, v.endpoint, fieldOp(v, v['response-field']));
  } else throw new UsageError(`Say what changed, in one of these shapes:\n${SHAPES.join('\n')}`);
  return commit(ctx, { project: result.project }, result.notes, result.affectedFeatures);
}

export const updateCommand: CommandSpec = {
  name: 'update',
  summary: 'Apply one change in the application to every place the coverage uses it.',
  examples: [
    'npx update-qa-suite my-project --feature bookings --endpoint "GET /booking/{bookingId}" --to "GET /bookings/{bookingId}"',
    'npx update-qa-suite my-project --feature bookings --endpoint create-booking --request-field firstname --rename first_name',
    'npx update-qa-suite my-project --feature bookings --endpoint create-booking --response-field bookingid --rename id',
    'npx update-qa-suite my-project --feature login --page login --element login-button --locator \'[data-test="sign-in"]\'',
    'npx update-qa-suite my-project --feature cart --page inventory --element cart-badge --expect text=3 --from 2',
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
  run: runUpdate,
};
