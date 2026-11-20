import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/model/load.js';
import { validateProject } from '../../src/model/validate.js';
import { exampleProject, run } from '../helpers/run.js';
import { findInCoverage } from '../helpers/stale.js';

const snapshot = (dir: string) => findInCoverage(dir, /[\s\S]*/).length + readFileSync(join(dir, 'coverage/bookings/api.json'), 'utf8');
const endpoint = (dir: string, id: string) => loadProject(dir).endpoints.find((e) => e.id === id)!;
const feature = (dir: string, name: string) => loadProject(dir).features.find((f) => f.name === name)!;
const upd = (dir: string, ...args: string[]) => run('update', [dir, '--feature', 'bookings', ...args]);

/** Adds a "reports" feature whose check and access rule also use get-booking. */
async function withReports(dir: string) {
  const r = await run('create', [dir, '--feature', 'reports', '--endpoint', 'GET /booking/{bookingId}', '--rule', 'guest GET /booking/{bookingId} 200', '--no-run']);
  if (r.code !== 0) throw new Error(r.err);
}

describe('update-qa-suite: endpoint change', () => {
  it('changes the path once and leaves no reference to the old one; runs every affected feature', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, '--endpoint', 'POST /booking', '--to', 'POST /bookings');
    expect(r.code, r.err).toBe(0);
    expect(endpoint(dir, 'create-booking')).toMatchObject({ method: 'POST', path: '/bookings' });
    expect(findInCoverage(dir, /^\/booking$/)).toEqual([]);
    expect(r.out).toContain('path: "/booking" → "/bookings"');
    expect(r.tests).toEqual([['bookings']]);
  });

  it('reaches other features that use the endpoint', async () => {
    const dir = await exampleProject();
    await withReports(dir);
    const r = await upd(dir, '--endpoint', 'get-booking', '--to', 'GET /bookings/{bookingId}');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Affected features: bookings, reports');
    expect(r.tests).toEqual([['bookings', 'reports']]);
  });

  it('changes only the method when --to is a method', async () => {
    const dir = await exampleProject();
    expect((await upd(dir, '--endpoint', 'update-booking', '--to', 'PATCH')).code).toBe(0);
    expect(endpoint(dir, 'update-booking')).toMatchObject({ method: 'PATCH', path: '/booking/{bookingId}' });
  });

  it('renames a path variable everywhere: checks, access rules and other features (Review Focus 2)', async () => {
    const dir = await exampleProject();
    await withReports(dir);
    const r = await upd(dir, '--endpoint', 'GET /booking/{bookingId}', '--to', 'GET /booking/{id}');
    expect(r.code, r.err).toBe(0);
    const p = loadProject(dir);
    const onGet = p.features.flatMap((f) => [...f.api.filter((c) => c.endpoint === 'get-booking').map((c) => c.params), ...f.acl.filter((x) => 'endpoint' in x.target && x.target.endpoint === 'get-booking').map((x) => (x.target as { params?: object }).params)]);
    expect(onGet.length).toBeGreaterThanOrEqual(3);
    for (const params of onGet) expect(Object.keys(params ?? {})).toEqual(['id']);
    expect(validateProject(p)).toEqual([]);
  });

  it('refuses a change in the number of path variables, and writes nothing', async () => {
    const dir = await exampleProject();
    const before = snapshot(dir);
    const r = await upd(dir, '--endpoint', 'get-booking', '--to', 'GET /booking/{bookingId}/rooms/{roomId}');
    expect(r.code).toBe(2);
    expect(r.err).toContain('path variables changed from {bookingId} to {bookingId, roomId}');
    expect(snapshot(dir)).toBe(before);
  });

  it('refuses a new method and path that another endpoint already has', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, '--endpoint', 'update-booking', '--to', 'GET /booking/{bookingId}');
    expect(r.code).toBe(2);
    expect(r.err).toContain('already exists (get-booking)');
  });

  it('lists the endpoints when the one named does not exist', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, '--endpoint', 'GET /nope', '--to', 'GET /x');
    expect(r.code).toBe(2);
    expect(r.err).toContain('No endpoint "GET /nope"');
    expect(r.err).toContain('POST /booking (create-booking)');
  });

  it('refuses an endpoint the named feature does not use', async () => {
    const dir = await exampleProject();
    const r = await run('update', [dir, '--feature', 'cart', '--endpoint', 'get-booking', '--to', 'GET /x/{bookingId}']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('isn\'t used by feature "cart" (used by: bookings)');
  });
});

describe('update-qa-suite: request payload change', () => {
  it('renames a nested field in the default body and in every override (Review Focus 3)', async () => {
    const dir = await exampleProject();
    const apiFile = join(dir, 'coverage/bookings/api.json');
    const api = JSON.parse(readFileSync(apiFile, 'utf8'));
    api.checks[2].body.bookingdates = { checkin: '2026-02-01' };
    writeFileSync(apiFile, JSON.stringify(api, null, 2) + '\n');
    const r = await upd(dir, '--endpoint', 'update-booking', '--request-field', 'bookingdates.checkin', '--rename', 'check_in');
    expect(r.code, r.err).toBe(0);
    expect((endpoint(dir, 'update-booking').request!.body as any).bookingdates).toEqual({ check_in: '2026-01-01', checkout: '2026-01-05' });
    expect((feature(dir, 'bookings').api[2]!.body as any).bookingdates).toEqual({ check_in: '2026-02-01' });
    expect((endpoint(dir, 'create-booking').request!.body as any).bookingdates.checkin).toBe('2026-01-01');
  });

  it('removes, adds and sets fields', async () => {
    const dir = await exampleProject();
    expect((await upd(dir, '--endpoint', 'create-booking', '--request-field', 'additionalneeds', '--remove')).code).toBe(0);
    expect(endpoint(dir, 'create-booking').request!.body).not.toHaveProperty('additionalneeds');
    expect((await upd(dir, '--endpoint', 'create-booking', '--request-field', 'nights', '--add', 'nights=4')).code).toBe(0);
    expect(endpoint(dir, 'create-booking').request!.body).toMatchObject({ nights: 4 });
    expect((await upd(dir, '--endpoint', 'create-booking', '--request-field', 'firstname', '--set', 'firstname=Ann')).code).toBe(0);
    expect(endpoint(dir, 'create-booking').request!.body).toMatchObject({ firstname: 'Ann' });
  });

  it('lists the body fields when the field does not exist', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, '--endpoint', 'create-booking', '--request-field', 'first', '--rename', 'x');
    expect(r.code).toBe(2);
    expect(r.err).toContain('No request field "first"');
    expect(r.err).toContain('bookingdates.checkin');
  });
});

describe('update-qa-suite: response payload change', () => {
  it('renames a field in the schema, its required list, expected values and saved values', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, '--endpoint', 'create-booking', '--response-field', 'bookingid', '--rename', 'id');
    expect(r.code, r.err).toBe(0);
    const schema = endpoint(dir, 'create-booking').response as any;
    expect(Object.keys(schema.properties)).toEqual(['id', 'booking']);
    expect(schema.required).toEqual(['id', 'booking']);
    expect(feature(dir, 'bookings').api[0]!.save).toEqual({ bookingId: 'id' });
    expect(findInCoverage(dir, /^bookingid$/)).toEqual([]);
  });

  it('renames nested fields in expected-value paths', async () => {
    const dir = await exampleProject();
    expect((await upd(dir, '--endpoint', 'create-booking', '--response-field', 'booking.firstname', '--rename', 'first_name')).code).toBe(0);
    expect(feature(dir, 'bookings').api[0]!.expect.values).toEqual({ 'booking.first_name': 'Sally', 'booking.totalprice': 111 });
  });

  it('refuses to remove a field that checks still assert, naming them', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, '--endpoint', 'get-booking', '--response-field', 'firstname', '--remove');
    expect(r.code).toBe(2);
    expect(r.err).toContain('bookings-read: expect.values.firstname');
  });

  it('removes an unasserted field and adds a typed one', async () => {
    const dir = await exampleProject();
    expect((await upd(dir, '--endpoint', 'get-booking', '--response-field', 'additionalneeds', '--remove')).code).toBe(0);
    expect((endpoint(dir, 'get-booking').response as any).properties).not.toHaveProperty('additionalneeds');
    expect((await upd(dir, '--endpoint', 'get-booking', '--response-field', 'nights', '--add', 'nights:number')).code).toBe(0);
    expect((endpoint(dir, 'get-booking').response as any).properties.nights).toEqual({ type: 'number' });
    const bad = await upd(dir, '--endpoint', 'get-booking', '--response-field', 'x', '--add', 'x:date');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('string, number, integer, boolean, object, array');
  });
});

describe('update-qa-suite: usage', () => {
  it('requires --feature, and explains the change shapes when the flags match none', async () => {
    const dir = await exampleProject();
    const noFeature = await run('update', [dir, '--endpoint', 'get-booking', '--to', 'GET /x/{bookingId}']);
    expect(noFeature.code).toBe(2);
    expect(noFeature.err).toContain('--feature');
    const unclear = await upd(dir, '--endpoint', 'get-booking');
    expect(unclear.code).toBe(2);
    expect(unclear.err).toContain('--to');
    expect(unclear.err).toContain('--request-field');
  });

  it('--dry-run shows the change and writes nothing', async () => {
    const dir = await exampleProject();
    const before = snapshot(dir);
    const r = await upd(dir, '--endpoint', 'POST /booking', '--to', 'POST /bookings', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Dry run');
    expect(snapshot(dir)).toBe(before);
    expect(r.tests).toEqual([]);
  });

  it('returns 1 when the affected tests fail after the change', async () => {
    const dir = await exampleProject();
    expect((await run('update', [dir, '--feature', 'bookings', '--endpoint', 'POST /booking', '--to', 'POST /bookings'], { testsExit: 1 })).code).toBe(1);
  });
});
