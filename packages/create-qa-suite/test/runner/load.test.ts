import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCoverage } from '../../template/base/support/load.js';

function projectCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qa-runner-'));
  cpSync(join(import.meta.dirname, '../fixtures/projects/valid'), dir, { recursive: true });
  cpSync(join(import.meta.dirname, '../../template/base/schemas'), join(dir, 'schemas'), { recursive: true });
  return dir;
}

describe("the generated project's loader", () => {
  it('loads the coverage files', () => {
    const p = loadCoverage(projectCopy());
    expect(p.features.map((f) => f.name)).toEqual(['bookings', 'login']);
    expect(p.endpoints.map((e) => e.id)).toEqual(['create-booking', 'get-booking']);
  });

  it('names the file and the field of an invalid coverage file', () => {
    const dir = projectCopy();
    writeFileSync(join(dir, 'coverage/bookings/api.json'), '{ "checks": [ { "id": "x", "title": "t", "endpoint": "get-booking", "role": "guest", "expect": { "status": "200" } } ] }\n');
    expect(() => loadCoverage(dir)).toThrow('coverage/bookings/api.json checks[0].expect.status: must be integer');
  });

  it('names the file and line of a file that is not JSON', () => {
    const dir = projectCopy();
    writeFileSync(join(dir, 'coverage/login/acl.json'), '{ "rules": [ ], }\n');
    expect(() => loadCoverage(dir)).toThrow(/coverage\/login\/acl\.json: not valid JSON at line 1:/);
  });

  it('keeps the draft flag so the spec can register drafts as fixme', () => {
    const dir = projectCopy();
    writeFileSync(join(dir, 'coverage/login/api.json'), '{ "checks": [ { "id": "d", "title": "t", "endpoint": "get-booking", "role": "guest", "params": { "bookingId": 1 }, "expect": { "status": 200 }, "draft": true } ] }\n');
    expect(loadCoverage(dir).features[1]!.api[0]!.draft).toBe(true);
  });
});
