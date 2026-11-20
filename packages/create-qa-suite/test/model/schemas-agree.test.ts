import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { checkSchema, SCHEMA_DIR, schemaFiles } from '../../src/model/schema.js';
import { modelTypesSource } from './types-source.js';

const ajv = new Ajv({ allErrors: true, strict: false });
for (const file of schemaFiles()) ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')), file);

const filesDir = join(import.meta.dirname, '../fixtures/files');
const validDir = join(import.meta.dirname, '../fixtures/projects/valid');
const samples: [string, string, unknown][] = [
  ...readdirSync(filesDir).map((f): [string, string, unknown] => [f, `${f.split('.')[0]}.schema.json`, JSON.parse(readFileSync(join(filesDir, f), 'utf8'))]),
  ['.qa-suite.json', 'qa-suite.schema.json', JSON.parse(readFileSync(join(validDir, '.qa-suite.json'), 'utf8'))],
  ...['roles', 'endpoints', 'pages'].map((k): [string, string, unknown] => [`_shared/${k}`, `${k}.schema.json`, JSON.parse(readFileSync(join(validDir, `coverage/_shared/${k}.json`), 'utf8'))]),
  ...['api', 'ui', 'acl'].flatMap((k) => ['bookings', 'login'].map((f): [string, string, unknown] => [`${f}/${k}`, `${k}.schema.json`, JSON.parse(readFileSync(join(validDir, `coverage/${f}/${k}.json`), 'utf8'))])),
];

describe('the tool\'s built-in schema checker agrees with ajv on the shipped JSON Schemas', () => {
  it.each(samples)('%s', (name, schema, data) => {
    const ajvValid = ajv.validate(schema, data);
    const ours = checkSchema(schema, data);
    expect(ours.length === 0, `ours: ${JSON.stringify(ours)} ajv: ${JSON.stringify(ajv.errors)}`).toBe(ajvValid);
    expect(ajvValid, 'fixture name says whether it should be valid').toBe(!name.includes('.bad-'));
  });
});

describe('one source of truth for the coverage types', () => {
  it('src/model/types.ts is an exact copy of the template\'s support/types.ts', () => {
    expect(readFileSync(join(import.meta.dirname, '../../src/model/types.ts'), 'utf8')).toBe(modelTypesSource());
  });
});
