import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/model/load.js';
import type { Project } from '../../src/model/types.js';
import { validateProject } from '../../src/model/validate.js';

const valid = () => loadProject(join(import.meta.dirname, '../fixtures/projects/valid'));
const messages = (p: Project) => validateProject(p).map((x) => `${x.file} ${x.path}: ${x.message}`);
const bookings = (p: Project) => p.features[0]!;
const login = (p: Project) => p.features[1]!;

describe('validateProject', () => {
  it('accepts the valid fixture', () => {
    expect(validateProject(valid())).toEqual([]);
  });

  it('rejects a duplicate check id across features', () => {
    const p = valid();
    login(p).api.push({ ...bookings(p).api[1]!, params: { bookingId: 1 } });
    expect(messages(p)).toContain('coverage/login/api.json checks[0].id: duplicate id "bookings-read" (also in coverage/bookings/api.json)');
  });

  it('rejects an unknown endpoint', () => {
    const p = valid();
    bookings(p).api[0]!.endpoint = 'nope';
    expect(messages(p)).toContain('coverage/bookings/api.json checks[0].endpoint: unknown endpoint "nope" (endpoints: create-booking, get-booking)');
  });

  it('rejects an unknown role', () => {
    const p = valid();
    bookings(p).api[0]!.role = 'manager';
    expect(messages(p)).toContain('coverage/bookings/api.json checks[0].role: unknown role "manager" (roles: guest, admin, standard)');
  });

  it('rejects an unknown element reference', () => {
    const p = valid();
    login(p).ui.checks[0]!.steps[0] = { visible: 'login.nope' };
    expect(messages(p)).toContain('coverage/login/ui.json checks[0].steps[0]: unknown element "login.nope" (login has: username, password, login-button, error)');
  });

  it('rejects a page id defined both as shared and in a feature', () => {
    const p = valid();
    login(p).ui.pages.push({ id: 'login', path: '/x', marker: 'a', elements: { a: '#a' } });
    expect(messages(p)).toContain('coverage/login/ui.json pages[1].id: duplicate page "login" (also in coverage/_shared/pages.json)');
  });

  it('rejects a check missing a path variable', () => {
    const p = valid();
    delete bookings(p).api[1]!.params;
    expect(messages(p)).toContain('coverage/bookings/api.json checks[1].params: missing "bookingId" for path /booking/{bookingId}');
  });

  it('rejects a saved value used before it is saved', () => {
    const p = valid();
    bookings(p).api.reverse();
    expect(messages(p)).toContain('coverage/bookings/api.json checks[0].params.bookingId: "{bookingId}" is not saved by an earlier check in this feature');
  });

  it('accepts a saved value provided by an ACL rule\'s setup checks, and rejects it without them', () => {
    const p = valid();
    expect(messages(p)).toEqual([]);
    const rule = bookings(p).acl[0]!;
    delete rule.setup;
    expect(messages(p)).toContain('coverage/bookings/acl.json rules[0].target.params.bookingId: "{bookingId}" is not saved by this rule\'s setup checks');
  });

  it('rejects a feature name that is not lower-case-with-dashes', () => {
    const p = valid();
    p.settings.features[0] = 'Bookings';
    bookings(p).name = 'Bookings';
    expect(messages(p)).toContain('.qa-suite.json features[0]: must match pattern "^[a-z][a-z0-9-]*$"');
  });

  it('rejects a literal credential in a role', () => {
    const p = valid();
    const api = p.roles[0]!.api as { login: { body: Record<string, string> } };
    api.login.body.password = 'password123';
    expect(messages(p)).toContain('coverage/_shared/roles.json roles[0].api.login.body.password: credentials must be env:NAME references');
  });

  it('reserves the role name guest', () => {
    const p = valid();
    p.roles[0]!.id = 'guest';
    expect(messages(p)).toContain('coverage/_shared/roles.json roles[0].id: "guest" is built in (no login); use another name');
  });
});
