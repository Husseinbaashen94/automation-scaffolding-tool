import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../../src/model/load.js';
import { validateProject } from '../../src/model/validate.js';
import { exampleProject, run } from '../helpers/run.js';
import { findInCoverage } from '../helpers/stale.js';

const del = (dir: string, feature: string, ...args: string[]) => run('delete', [dir, '--feature', feature, ...args]);
const all = (dir: string) => findInCoverage(dir, /[\s\S]*/).join('\n');

describe('delete-qa-suite', () => {
  it('removes a feature completely and keeps shared pages, other features and hand-written tests', async () => {
    const dir = await exampleProject();
    mkdirSync(join(dir, 'tests/custom'), { recursive: true });
    writeFileSync(join(dir, 'tests/custom/my.spec.ts'), '// mine\n');
    const r = await del(dir, 'cart', '--yes');
    expect(r.code, r.err).toBe(0);
    expect(existsSync(join(dir, 'coverage/cart'))).toBe(false);
    const p = loadProject(dir);
    expect(p.settings.features).toEqual(['login', 'bookings']);
    expect(p.sharedPages.map((pg) => pg.id)).toEqual(['login', 'inventory']);
    expect(validateProject(p)).toEqual([]);
    expect(findInCoverage(dir, /^cart-(add|remove)/)).toEqual([]);
    expect(readFileSync(join(dir, 'tests/custom/my.spec.ts'), 'utf8')).toBe('// mine\n');
    expect(r.out).toContain('- coverage/cart/ui.json');
    expect(r.tests).toEqual([['login', 'bookings']]);
  });

  it('lists shared items that no feature uses any more, without removing them', async () => {
    const dir = await exampleProject();
    const r = await del(dir, 'bookings', '--yes', '--no-run');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Now unused (kept): endpoints create-booking, get-booking, update-booking, delete-booking; roles admin');
    expect(loadProject(dir).endpoints).toHaveLength(4);
  });

  it("removes other features' access rules that depend on the deleted feature, naming them", async () => {
    const dir = await exampleProject();
    const added = await run('create', [dir, '--feature', 'audit', '--rule', 'admin PUT /booking/{bookingId} 200', '--no-run']);
    expect(added.code, added.err).toBe(0);
    const file = join(dir, 'coverage/audit/acl.json');
    const acl = JSON.parse(readFileSync(file, 'utf8'));
    acl.rules[0].setup = ['bookings-create'];
    acl.rules[0].target.params = { bookingId: '{bookingId}' };
    writeFileSync(file, JSON.stringify(acl, null, 2) + '\n');
    const r = await del(dir, 'bookings', '--yes', '--no-run');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Also removed from audit: rule audit-admin-update-booking-200 (it used bookings-create as setup)');
    expect(loadProject(dir).features.find((f) => f.name === 'audit')!.acl).toEqual([]);
  });

  it("refuses when another feature's UI check opens a page the deleted feature owns", async () => {
    const dir = await exampleProject();
    expect((await run('create', [dir, '--feature', 'checkout', '--page', 'checkout', '--path', '/checkout.html', '--no-run'])).code).toBe(0);
    const file = join(dir, 'coverage/cart/ui.json');
    const ui = JSON.parse(readFileSync(file, 'utf8'));
    ui.checks[0].steps.push({ goto: 'checkout' });
    writeFileSync(file, JSON.stringify(ui, null, 2) + '\n');
    const before = all(dir);
    const r = await del(dir, 'checkout', '--yes');
    expect(r.code).toBe(2);
    expect(r.err).toContain('cart-add-one (cart) uses page checkout');
    expect(r.err).toContain('coverage/_shared/pages.json');
    expect(all(dir)).toBe(before);
  });

  it('asks to type the feature name in a terminal; a wrong answer deletes nothing', async () => {
    const dir = await exampleProject();
    const before = all(dir);
    const r = await del(dir, 'cart', '--no-run');
    expect(r.code, 'needs a terminal or --yes').toBe(2);
    const wrong = await run('delete', [dir, '--feature', 'cart'], { isTTY: true, answers: ['carts'] });
    expect(wrong.code).toBe(2);
    expect(wrong.asked[0]).toContain('Type the feature name');
    expect(wrong.err).toContain('Nothing was deleted');
    expect(all(dir)).toBe(before);
    const right = await run('delete', [dir, '--feature', 'cart', '--no-run'], { isTTY: true, answers: ['cart'] });
    expect(right.code).toBe(0);
    expect(existsSync(join(dir, 'coverage/cart'))).toBe(false);
  });

  it('explains --yes when there is no terminal to confirm in', async () => {
    const dir = await exampleProject();
    const r = await del(dir, 'cart');
    expect(r.code).toBe(2);
    expect(r.err).toContain('--yes');
  });

  it('--dry-run shows what would be removed and deletes nothing', async () => {
    const dir = await exampleProject();
    const r = await del(dir, 'cart', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('- coverage/cart/api.json');
    expect(existsSync(join(dir, 'coverage/cart/ui.json'))).toBe(true);
  });

  it('lists the features when the one named does not exist', async () => {
    const dir = await exampleProject();
    const r = await del(dir, 'basket', '--yes');
    expect(r.code).toBe(2);
    expect(r.err).toContain('No feature "basket" (features: login, cart, bookings)');
  });
});
