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
    expect(text).toContain('checks[0].expect.status: 200 → 201');
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
