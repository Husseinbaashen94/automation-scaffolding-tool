import { Ajv } from 'ajv';
import type { JsonSchema } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });

/** Problems with a response body against the endpoint's JSON Schema ([] when it matches). */
export function schemaProblems(schema: JsonSchema, body: unknown): string[] {
  const validate = ajv.compile(schema);
  if (validate(body)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || '(body)'} ${e.message}`);
}
