import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CoverageError, loadProject } from '../../src/model/load.js';

const fixture = (name: string) => join(import.meta.dirname, '../fixtures/projects', name);
const problemsOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof CoverageError) return e.problems;
    throw e;
  }
  throw new Error('expected a CoverageError');
};

describe('loadProject', () => {
  it('loads settings, shared coverage and every feature', () => {
    const p = loadProject(fixture('valid'));
    expect(p.settings.features).toEqual(['bookings', 'login']);
    expect(p.roles.map((r) => r.id)).toEqual(['admin', 'standard']);
    expect(p.endpoints.map((e) => e.id)).toEqual(['create-booking', 'get-booking']);
    expect(p.sharedPages.map((pg) => pg.id)).toEqual(['login']);
    expect(p.features.map((f) => f.name)).toEqual(['bookings', 'login']);
    expect(p.features[0]!.api[1]).toMatchObject({ id: 'bookings-read', params: { bookingId: '{bookingId}' } });
    expect(p.features[1]!.ui.checks[0]!.steps).toEqual([{ visible: 'inventory.list' }, { url: 'inventory' }]);
  });

  it('reports invalid JSON with the file and line:col, and loads nothing', () => {
    const [problem] = problemsOf(() => loadProject(fixture('invalid-json')));
    expect(problem!.file).toBe('coverage/bookings/api.json');
    expect(problem!.message).toMatch(/not valid JSON at line \d+:\d+/);
  });

  it('reports a structural problem with the file and the field path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-load-'));
    cpSync(fixture('valid'), dir, { recursive: true });
    writeFileSync(join(dir, 'coverage/bookings/api.json'), '{ "checks": [ { "id": "x", "title": "t", "endpoint": "get-booking", "role": "guest", "expect": { "status": "200" } } ] }\n');
    const problems = problemsOf(() => loadProject(dir));
    expect(problems).toContainEqual({ file: 'coverage/bookings/api.json', path: 'checks[0].expect.status', message: 'must be integer' });
  });

  it('says clearly when a folder is not a QA suite project', () => {
    const [problem] = problemsOf(() => loadProject(mkdtempSync(join(tmpdir(), 'qa-empty-'))));
    expect(problem!.message).toMatch(/not a QA suite project/);
  });

  it('treats a missing feature file as empty coverage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-load-'));
    cpSync(fixture('valid'), dir, { recursive: true, filter: (src) => !src.endsWith('login/api.json') });
    expect(loadProject(dir).features[1]!.api).toEqual([]);
  });
});
