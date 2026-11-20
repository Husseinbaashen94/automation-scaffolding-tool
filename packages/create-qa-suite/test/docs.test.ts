import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMON_OPTIONS } from '../src/cli/command.js';
import { createCommand } from '../src/commands/create.js';
import { deleteCommand } from '../src/commands/delete.js';
import { updateCommand } from '../src/commands/update.js';
import { scaffold } from '../src/commands/create.js';
import { SCHEMA_DIR } from '../src/model/schema.js';

const repo = join(import.meta.dirname, '../../..');
const readme = readFileSync(join(repo, 'README.md'), 'utf8');
const envValues = (text: string) => text.split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => l.slice(l.indexOf('=') + 1));

function schemaFields(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => schemaFields(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'properties') for (const name of Object.keys(v as object)) if (name !== '$schema') out.add(name);
      schemaFields(v, out);
    }
  }
  return out;
}

describe('documentation', () => {
  it('the README documents every command-line flag', () => {
    for (const spec of [createCommand, updateCommand, deleteCommand]) {
      for (const flag of Object.keys({ ...spec.options, ...COMMON_OPTIONS })) expect(readme, `--${flag}`).toContain(`--${flag}`);
    }
  });

  it('docs/coverage-format.md documents every field of every coverage file', () => {
    const doc = readFileSync(join(repo, 'docs/coverage-format.md'), 'utf8');
    for (const file of readdirSync(SCHEMA_DIR)) {
      for (const field of schemaFields(JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')))) expect(doc, `${field} (${file})`).toContain(`\`${field}\``);
    }
  });

  it("the npm page README is the repo's README", () => {
    expect(readFileSync(join(repo, 'packages/create-qa-suite/README.md'), 'utf8')).toBe(readme);
  });

  it('every .env.example has only empty values', () => {
    for (const f of ['.env.example', 'packages/create-qa-suite/template/base/.env.example', 'packages/create-qa-suite/template/examples/.env.example']) {
      for (const v of envValues(readFileSync(join(repo, f), 'utf8'))) expect(v, f).toBe('');
    }
  });

  it("the generated README says where the example projects' demo logins come from, and only when examples are included", () => {
    const withExamples = scaffold({ dir: '/x', name: 'x', uiBaseUrl: 'https://a', apiBaseUrl: 'https://b', examples: true }).get('README.md')!;
    const empty = scaffold({ dir: '/x', name: 'x', uiBaseUrl: 'https://a', apiBaseUrl: 'https://b', examples: false }).get('README.md')!;
    expect(withExamples).toContain('.env');
    expect(withExamples).toMatch(/demo logins.*publish/s);
    expect(empty).not.toContain('Sauce Demo');
  });

  it('the README states the real number of automated tests', () => {
    const report = join(mkdtempSync(join(tmpdir(), 'qa-count-')), 'report.json');
    spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${report}`, '--exclude', 'test/docs.test.ts'], { cwd: join(import.meta.dirname, '..'), stdio: 'ignore' });
    const others = JSON.parse(readFileSync(report, 'utf8')).numTotalTests as number;
    const own = (readFileSync(import.meta.filename, 'utf8').match(/^ {2}it\(/gm) ?? []).length;
    const stated = Number(/\*\*(\d+) automated tests\*\*/.exec(readme)?.[1]);
    expect(stated).toBe(others + own);
  }, 300_000);
});
