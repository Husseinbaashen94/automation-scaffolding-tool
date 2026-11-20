import { UsageError } from '../cli/errors.js';
import type { Endpoint, JsonSchema, Project, Value } from '../model/types.js';

type Obj = Record<string, Value>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const describe = (e: Endpoint) => `${e.method} ${e.path} (${e.id})`;

/** Finds an endpoint by "METHOD /path" or by id; otherwise lists what exists. */
export function parseEndpointRef(p: Project, ref: string): Endpoint {
  const m = /^\s*([A-Za-z]+)\s+(\/\S*)\s*$/.exec(ref);
  const found = m ? p.endpoints.find((e) => e.method === m[1]!.toUpperCase() && e.path === m[2]) : p.endpoints.find((e) => e.id === ref);
  if (!found) throw new UsageError(`No endpoint "${ref}". Endpoints: ${p.endpoints.map(describe).join(', ') || '(none)'}`);
  return found;
}

/** The parent object of a dot path and the last key, or undefined if a parent is missing. */
function parentOf(obj: Value | undefined, path: string, create = false): [Obj, string] | undefined {
  const parts = path.split('.');
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isObj(node)) return undefined;
    if (!(part in node) && create) node[part] = {};
    node = node[part];
  }
  return isObj(node) ? [node, parts.at(-1)!] : undefined;
}

/** Rebuilds an object with one key renamed, keeping the key order. */
function renameKey(obj: Obj, from: string, to: string) {
  const entries = Object.entries(obj).map(([k, v]) => [k === from ? to : k, v] as const);
  for (const k of Object.keys(obj)) delete obj[k];
  for (const [k, v] of entries) obj[k] = v;
}

export const hasField = (obj: Value | undefined, path: string) => {
  const p = parentOf(obj, path);
  return !!p && p[1] in p[0];
};

/** Renames the last segment of a dot path in place (e.g. bookingdates.checkin → bookingdates.check_in). */
export function renameField(obj: Value | undefined, path: string, to: string): boolean {
  const p = parentOf(obj, path);
  if (!p || !(p[1] in p[0])) return false;
  renameKey(p[0], p[1], to);
  return true;
}

export function removeField(obj: Value | undefined, path: string): boolean {
  const p = parentOf(obj, path);
  if (!p || !(p[1] in p[0])) return false;
  delete p[0][p[1]];
  return true;
}

export function setField(obj: Obj, path: string, value: Value): void {
  const [parent, key] = parentOf(obj, path, true)!;
  parent[key] = value;
}

/** Every leaf field path of a body, for "did you mean" lists. */
export function fieldPaths(obj: Value | undefined, prefix = ''): string[] {
  if (!isObj(obj)) return [];
  return Object.entries(obj).flatMap(([k, v]) => (isObj(v) && Object.keys(v).length ? fieldPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

/** The schema object that holds the last segment of a dot path in its "properties". */
function schemaParent(schema: JsonSchema | undefined, path: string): [JsonSchema, string] | undefined {
  const parts = path.split('.');
  let node: unknown = schema;
  for (const part of parts.slice(0, -1)) {
    if (isObj(node) && isObj((node as Obj).items)) node = (node as Obj).items;
    const props = isObj(node) ? (node as Obj).properties : undefined;
    if (!isObj(props) || !(part in props)) return undefined;
    node = props[part];
  }
  if (isObj(node) && isObj((node as Obj).items)) node = (node as Obj).items;
  return isObj(node) ? [node as JsonSchema, parts.at(-1)!] : undefined;
}

export function schemaHasProperty(schema: JsonSchema | undefined, path: string): boolean {
  const p = schemaParent(schema, path);
  return !!p && isObj(p[0].properties) && p[1] in (p[0].properties as Obj);
}

export function schemaRenameProperty(schema: JsonSchema | undefined, path: string, to: string): boolean {
  const p = schemaParent(schema, path);
  if (!p || !isObj(p[0].properties) || !(p[1] in p[0].properties)) return false;
  renameKey(p[0].properties as Obj, p[1], to);
  if (Array.isArray(p[0].required)) p[0].required = p[0].required.map((r) => (r === p[1] ? to : r));
  return true;
}

export function schemaRemoveProperty(schema: JsonSchema | undefined, path: string): boolean {
  const p = schemaParent(schema, path);
  if (!p || !isObj(p[0].properties) || !(p[1] in p[0].properties)) return false;
  delete (p[0].properties as Obj)[p[1]];
  if (Array.isArray(p[0].required)) p[0].required = p[0].required.filter((r) => r !== p[1]);
  return true;
}

export const SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];

/** Adds a required property with a type. Returns false if its parent isn't in the schema. */
export function schemaAddProperty(schema: JsonSchema | undefined, path: string, type: string): boolean {
  const p = schemaParent(schema, path);
  if (!p) return false;
  const [parent, key] = p;
  parent.properties = { ...(isObj(parent.properties) ? parent.properties : {}), [key]: { type } };
  parent.required = [...(Array.isArray(parent.required) ? parent.required : []), key];
  return true;
}

/** Every schema property path, for "did you mean" lists. */
export function schemaPaths(schema: Value | undefined, prefix = ''): string[] {
  if (!isObj(schema)) return [];
  const node = isObj(schema.items) ? schema.items : schema;
  if (!isObj(node.properties)) return [];
  return Object.entries(node.properties).flatMap(([k, v]) => [`${prefix}${k}`, ...schemaPaths(v, `${prefix}${k}.`)]);
}

/** Replaces a field path (or any path under it) with its renamed form; undefined if not under it. */
export function renamePathPrefix(path: string, field: string, to: string): string | undefined {
  const v = path.split('.');
  const f = field.split('.');
  const isIndex = (s: string) => /^\d+$/.test(s);
  let matched = 0;
  let last = -1;
  for (let j = 0; j < v.length && matched < f.length; j++) {
    // list positions in a value path (items.0.id) don't appear in the schema path (items.id)
    if (isIndex(v[j]!) && !isIndex(f[matched]!)) continue;
    if (v[j] !== f[matched]) return undefined;
    matched++;
    last = j;
  }
  if (matched < f.length) return undefined;
  const out = [...v];
  out[last] = to;
  return out.join('.');
}

/** Whether renaming the last segment of a path to `to` would land on a key that already exists. */
export function renameCollides(obj: Value | undefined, path: string, to: string): boolean {
  const p = parentOf(obj, path);
  return !!p && p[1] in p[0] && to in p[0] && to !== p[1];
}

export function schemaRenameCollides(schema: JsonSchema | undefined, path: string, to: string): boolean {
  const p = schemaParent(schema, path);
  return !!p && isObj(p[0].properties) && to in (p[0].properties as Obj) && to !== p[1];
}
