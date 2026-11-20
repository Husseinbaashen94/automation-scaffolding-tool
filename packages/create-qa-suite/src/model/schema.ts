/**
 * A small checker for the subset of JSON Schema (draft-07) that the shipped coverage schemas use.
 * The tool has no runtime dependencies, so it can't use ajv; a test checks this agrees with ajv.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCHEMA_DIR = fileURLToPath(new URL('../../template/base/schemas/', import.meta.url));

type Schema = { [key: string]: unknown };
export type SchemaError = { path: string; message: string };

let cache: Map<string, Schema> | undefined;
const schemas = (): Map<string, Schema> => {
  cache ??= new Map(schemaFiles().map((f) => [f, JSON.parse(readFileSync(SCHEMA_DIR + f, 'utf8')) as Schema]));
  return cache;
};

export const schemaFiles = (): string[] => readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).sort();

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v: unknown, t: string) => typeOf(v) === t || (t === 'number' && typeOf(v) === 'integer');
const join = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);

function resolve(ref: string, file: string): [Schema, string] {
  const [target, pointer = ''] = ref.split('#');
  const doc = target ? target : file;
  let node: unknown = schemas().get(doc);
  if (!node) throw new Error(`unknown schema ${doc}`);
  for (const part of pointer.split('/').filter(Boolean)) node = (node as Schema)[part];
  return [node as Schema, doc];
}

function check(schema: Schema, value: unknown, path: string, file: string, out: SchemaError[]): void {
  if (typeof schema.$ref === 'string') {
    const [target, doc] = resolve(schema.$ref, file);
    return check(target, value, path, doc, out);
  }
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) return void out.push({ path, message: `must be ${JSON.stringify(schema.const)}` });
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    return void out.push({ path, message: `must be one of: ${schema.enum.join(', ')}` });
  }
  if (typeof schema.type === 'string' && !isType(value, schema.type)) return void out.push({ path, message: `must be ${schema.type}` });
  if (Array.isArray(schema.oneOf)) {
    const matching = schema.oneOf.filter((s) => {
      const errs: SchemaError[] = [];
      check(s as Schema, value, path, file, errs);
      return errs.length === 0;
    });
    if (matching.length !== 1) out.push({ path, message: matching.length ? 'matches more than one allowed shape' : 'does not match any allowed shape' });
    return;
  }
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) out.push({ path, message: `must match pattern "${schema.pattern}"` });
    if (typeof schema.minLength === 'number' && [...value].length < schema.minLength) out.push({ path, message: `must have at least ${schema.minLength} character(s)` });
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) out.push({ path, message: `must be >= ${schema.minimum}` });
    if (typeof schema.maximum === 'number' && value > schema.maximum) out.push({ path, message: `must be <= ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) out.push({ path, message: `must have at least ${schema.minItems} item(s)` });
    if (schema.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) out.push({ path, message: 'must not contain duplicates' });
    if (schema.items) value.forEach((item, i) => check(schema.items as Schema, item, join(path, i), file, out));
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in obj)) out.push({ path, message: `missing field "${key}"` });
    for (const [key, v] of Object.entries(obj)) {
      if (schema.propertyNames) check(schema.propertyNames as Schema, key, join(path, key), file, out);
      if (key in props) check(props[key]!, v, join(path, key), file, out);
      else if (schema.additionalProperties === false) out.push({ path: join(path, key), message: `unknown field "${key}"` });
      else if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties as Schema, v, join(path, key), file, out);
    }
  }
}

/** Checks a value against one of the shipped schemas (by file name); returns every problem found. */
export function checkSchema(schemaFile: string, value: unknown): SchemaError[] {
  const out: SchemaError[] = [];
  check({ $ref: `${schemaFile}#` }, value, '', schemaFile, out);
  return out;
}
