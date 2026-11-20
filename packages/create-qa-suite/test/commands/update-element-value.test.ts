import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/model/load.js';
import type { Step } from '../../src/model/types.js';
import { exampleProject, run } from '../helpers/run.js';
import { findInCoverage } from '../helpers/stale.js';

const upd = (dir: string, feature: string, ...args: string[]) => run('update', [dir, '--feature', feature, ...args]);
const steps = (dir: string, feature: string) => Object.fromEntries(loadProject(dir).features.find((f) => f.name === feature)!.ui.checks.map((c) => [c.id, c.steps]));
const textOf = (s: Step[]) => s.filter((x): x is Extract<Step, { text: string }> => 'text' in x).map((x) => x.equals);
const api = (dir: string) => Object.fromEntries(loadProject(dir).features.find((f) => f.name === 'bookings')!.api.map((c) => [c.id, c.expect]));

describe('update-qa-suite: element change', () => {
  it('changes a shared element once; every feature using it (directly or through a login flow) is affected', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, 'login', '--page', 'login', '--element', 'login-button', '--locator', '[data-test="sign-in"]');
    expect(r.code, r.err).toBe(0);
    expect(loadProject(dir).sharedPages.find((p) => p.id === 'login')!.elements['login-button']).toBe('[data-test="sign-in"]');
    expect(findInCoverage(dir, 'data-test="login-button"')).toEqual([]);
    expect(r.out).toContain('Affected features: login, cart');
    expect(r.tests).toEqual([['login', 'cart']]);
  });

  it("changes an element on a feature's own page", async () => {
    const dir = await exampleProject();
    const added = await run('create', [dir, '--feature', 'checkout', '--page', 'checkout', '--path', '/checkout-step-one.html', '--no-run']);
    expect(added.code, added.err).toBe(0);
    const r = await upd(dir, 'checkout', '--page', 'checkout', '--element', 'main', '--locator', '[data-test="checkout-info"]');
    expect(r.code, r.err).toBe(0);
    expect(loadProject(dir).features.find((f) => f.name === 'checkout')!.ui.pages[0]!.elements.main).toBe('[data-test="checkout-info"]');
  });

  it('lists the elements when the one named does not exist, and the pages when the page does not', async () => {
    const dir = await exampleProject();
    const el = await upd(dir, 'login', '--page', 'login', '--element', 'submit', '--locator', '#x');
    expect(el.code).toBe(2);
    expect(el.err).toContain('No element "submit" on page login (elements: username, password, login-button, error)');
    const pg = await upd(dir, 'login', '--page', 'home', '--element', 'x', '--locator', '#x');
    expect(pg.code).toBe(2);
    expect(pg.err).toContain('No page "home" (pages: login, inventory)');
  });

  it("refuses a page the feature doesn't use", async () => {
    const dir = await exampleProject();
    const r = await upd(dir, 'bookings', '--page', 'inventory', '--element', 'list', '--locator', '#x');
    expect(r.code).toBe(2);
    expect(r.err).toContain('isn\'t used by feature "bookings"');
  });
});

describe('update-qa-suite: UI value change', () => {
  it('refuses when the matching checks expect different values, listing them', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, 'cart', '--page', 'inventory', '--element', 'cart-badge', '--expect', 'text=3');
    expect(r.code).toBe(2);
    expect(r.err).toContain('cart-add-one: "1"');
    expect(r.err).toContain('cart-add-two: "2"');
    expect(r.err).toContain('--check');
    expect(r.err).toContain('--from');
  });

  it('--from changes only the checks expecting that value', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, 'cart', '--page', 'inventory', '--element', 'cart-badge', '--expect', 'text=3', '--from', '2');
    expect(r.code, r.err).toBe(0);
    const s = steps(dir, 'cart');
    expect([textOf(s['cart-add-one']!), textOf(s['cart-add-two']!), textOf(s['cart-remove']!)]).toEqual([['1'], ['3'], ['1']]);
  });

  it('--check changes only that check', async () => {
    const dir = await exampleProject();
    expect((await upd(dir, 'cart', '--page', 'inventory', '--element', 'cart-badge', '--expect', 'text=7', '--check', 'cart-remove')).code).toBe(0);
    expect(textOf(steps(dir, 'cart')['cart-remove']!)).toEqual(['7']);
    expect(textOf(steps(dir, 'cart')['cart-add-one']!)).toEqual(['1']);
  });

  it('updates every match when they all expect the same value', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, 'cart', '--page', 'inventory', '--element', 'cart-badge', '--expect', 'text=one', '--from', '1');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('2 expectation(s)');
  });

  it('refuses when nothing matches', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, 'cart', '--page', 'inventory', '--element', 'cart-badge', '--expect', 'count=2');
    expect(r.code).toBe(2);
    expect(r.err).toContain('No check in feature "cart" expects count on inventory.cart-badge');
  });
});

describe('update-qa-suite: API value change', () => {
  it('refuses an ambiguous status change, then applies it narrowed', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, 'bookings', '--endpoint', 'get-booking', '--expect', 'status=410');
    expect(r.code).toBe(2);
    expect(r.err).toContain('bookings-read: 200');
    expect(r.err).toContain('bookings-read-deleted: 404');
    const ok = await upd(dir, 'bookings', '--endpoint', 'get-booking', '--expect', 'status=410', '--from', '404');
    expect(ok.code, ok.err).toBe(0);
    expect(api(dir)['bookings-read-deleted']!.status).toBe(410);
    expect(api(dir)['bookings-read']!.status).toBe(200);
  });

  it('changes an expected field value, keeping JSON types', async () => {
    const dir = await exampleProject();
    expect((await upd(dir, 'bookings', '--endpoint', 'get-booking', '--expect', 'firstname=Jim')).code).toBe(0);
    expect(api(dir)['bookings-read']!.values).toEqual({ firstname: 'Jim', 'bookingdates.checkin': '2026-01-01' });
    expect((await upd(dir, 'bookings', '--endpoint', 'create-booking', '--expect', 'booking.totalprice=150')).code).toBe(0);
    expect(api(dir)['bookings-create']!.values!['booking.totalprice']).toBe(150);
  });

  it('changes the status an access rule expects', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, 'bookings', '--endpoint', 'update-booking', '--expect', 'status=401', '--from', '403');
    expect(r.code, r.err).toBe(0);
    const rule = loadProject(dir).features.find((f) => f.name === 'bookings')!.acl.find((x) => x.id === 'bookings-guest-cannot-update')!;
    expect(rule.expect).toEqual({ status: 401 });
  });

  it('rejects a status that is not a number', async () => {
    const dir = await exampleProject();
    const r = await upd(dir, 'bookings', '--endpoint', 'get-booking', '--expect', 'status=ok', '--from', '200');
    expect(r.code).toBe(2);
    expect(r.err).toContain('status must be an HTTP status code');
  });
});
