import { describe, expect, it } from 'vitest';
import { stepToAction } from '../../template/base/support/steps.js';

const elements: Record<string, string> = { 'login.username': '#user', 'cart.badge': '.badge' };
const element = (ref: string) => {
  const sel = elements[ref];
  if (!sel) throw new Error(`unknown element "${ref}"`);
  return sel;
};
const page = (id: string) => ({ login: '/', inventory: '/inventory.html' })[id]!;
const resolve = (v: unknown) => (v === 'env:PW' ? 'secret' : v);
const act = (step: object) => stepToAction(step as never, { element, page, resolve: resolve as never, baseUrl: 'https://shop.example' });

describe('stepToAction maps each step to one Playwright call', () => {
  it.each([
    [{ goto: 'inventory' }, { kind: 'goto', url: 'https://shop.example/inventory.html' }],
    [{ fill: 'login.username', value: 'env:PW' }, { kind: 'action', selector: '#user', method: 'fill', args: ['secret'] }],
    [{ click: 'login.username' }, { kind: 'action', selector: '#user', method: 'click', args: [] }],
    [{ select: 'login.username', value: 'az' }, { kind: 'action', selector: '#user', method: 'selectOption', args: ['az'] }],
    [{ check: 'login.username' }, { kind: 'action', selector: '#user', method: 'check', args: [] }],
    [{ visible: 'cart.badge' }, { kind: 'assert', selector: '.badge', matcher: 'toBeVisible', args: [] }],
    [{ hidden: 'cart.badge' }, { kind: 'assert', selector: '.badge', matcher: 'toBeHidden', args: [] }],
    [{ text: 'cart.badge', equals: 2 }, { kind: 'assert', selector: '.badge', matcher: 'toHaveText', args: ['2'] }],
    [{ value: 'login.username', equals: 'env:PW' }, { kind: 'assert', selector: '#user', matcher: 'toHaveValue', args: ['secret'] }],
    [{ count: 'cart.badge', equals: 3 }, { kind: 'assert', selector: '.badge', matcher: 'toHaveCount', args: [3] }],
  ])('%j', (step, expected) => {
    expect(act(step)).toMatchObject(expected);
  });

  it('checks the URL path exactly (not just "ends with /")', () => {
    const d = act({ url: 'inventory' });
    expect(d).toMatchObject({ kind: 'url' });
    const re = (d as { pattern: RegExp }).pattern;
    expect(re.test('https://shop.example/inventory.html')).toBe(true);
    expect(re.test('https://shop.example/inventory.html?x=1')).toBe(true);
    expect(re.test('https://shop.example/other/inventory.html')).toBe(false);
    const root = (act({ url: 'login' }) as { pattern: RegExp }).pattern;
    expect(root.test('https://shop.example/')).toBe(true);
    expect(root.test('https://shop.example/inventory.html')).toBe(false);
  });

  it('describes each step in words for the test report, never showing a resolved secret', () => {
    expect(act({ fill: 'login.username', value: 'env:PW' }).describe).toBe('fill login.username with env:PW');
    expect(act({ text: 'cart.badge', equals: 2 }).describe).toBe('cart.badge has text "2"');
  });

  it('names the element when it is unknown', () => {
    expect(() => act({ click: 'login.nope' })).toThrow('unknown element "login.nope"');
  });
});
