import { describe, expect, it } from 'vitest';
import { renderSummary } from '../../src/engine/summary.js';

const json = (o: unknown) => JSON.stringify(o, null, 2) + '\n';

describe('renderSummary', () => {
  it('shows each changed JSON value as path: old → new', () => {
    const text = renderSummary(
      [{ path: 'coverage/bookings/api.json', before: json({ checks: [{ id: 'a', expect: { status: 200 } }] }), after: json({ checks: [{ id: 'a', expect: { status: 201 } }] }) }],
      [],
    );
    expect(text).toContain('~ coverage/bookings/api.json');
    expect(text).toContain('checks[a].expect.status: 200 → 201');
  });

  it('marks created and deleted files, and shows added and removed values', () => {
    const text = renderSummary(
      [
        { path: 'coverage/orders/api.json', before: null, after: json({ checks: [] }) },
        { path: 'coverage/cart/ui.json', before: json({}), after: null },
        { path: 'x.json', before: json({ a: { b: 1 } }), after: json({ a: { c: 2 } }) },
      ],
      ['Affected features: bookings'],
    );
    expect(text).toContain('+ coverage/orders/api.json');
    expect(text).toContain('- coverage/cart/ui.json');
    expect(text).toContain('a.b: 1 → (removed)');
    expect(text).toContain('a.c: (added) → 2');
    expect(text).toContain('Affected features: bookings');
  });

  it('says so when nothing changes', () => {
    expect(renderSummary([], [])).toContain('Nothing to change');
  });
});

describe('renderSummary: lists', () => {
  it('matches items by id, so removing one does not look like every later item changed', () => {
    const before = json({ rules: [{ id: 'r1', role: 'guest' }, { id: 'r2', role: 'admin' }, { id: 'r3', role: 'guest' }] });
    const after = json({ rules: [{ id: 'r1', role: 'guest' }, { id: 'r3', role: 'staff' }, { id: 'r4', role: 'guest' }] });
    const text = renderSummary([{ path: 'acl.json', before, after }], []);
    expect(text).toContain('rules: removed r2');
    expect(text).toContain('rules: added r4');
    expect(text).toContain('rules[r3].role: "guest" → "staff"');
    expect(text).not.toContain('rules[1]');
  });

  it('shows lists of plain values as added and removed values', () => {
    const text = renderSummary([{ path: '.qa-suite.json', before: json({ features: ['login', 'cart', 'bookings'] }), after: json({ features: ['login', 'bookings', 'orders'] }) }], []);
    expect(text).toContain('features: removed "cart"');
    expect(text).toContain('features: added "orders"');
    expect(text).not.toContain('features[1]');
  });
});

