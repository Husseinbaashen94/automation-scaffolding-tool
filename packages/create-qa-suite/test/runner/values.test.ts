import { describe, expect, it } from 'vitest';
import { deepMerge, fillPath, getPath, resolveValue } from '../../template/base/support/values.js';

const ctx = { env: { SAUCE_PASSWORD: 'pw' }, saved: { bookingId: 42, name: 'Sally' } };

describe('resolveValue', () => {
  it('reads env:NAME from the environment', () => {
    expect(resolveValue('env:SAUCE_PASSWORD', ctx)).toBe('pw');
  });

  it('says which variable to set when one is missing', () => {
    expect(() => resolveValue('env:NOPE', ctx)).toThrow('Set NOPE in .env');
  });

  it('keeps the type of a whole-string saved value, and stringifies one inside text', () => {
    expect(resolveValue('{bookingId}', ctx)).toBe(42);
    expect(resolveValue('booking {bookingId} for {name}', ctx)).toBe('booking 42 for Sally');
  });

  it('resolves inside objects and arrays, and leaves other values alone', () => {
    expect(resolveValue({ a: ['{name}', 1, true, null], b: { c: 'env:SAUCE_PASSWORD' } }, ctx)).toEqual({ a: ['Sally', 1, true, null], b: { c: 'pw' } });
  });

  it('fails clearly on a saved value that does not exist', () => {
    expect(() => resolveValue('{missing}', ctx)).toThrow('"{missing}" has not been saved');
  });
});

describe('getPath', () => {
  const body = { booking: { firstname: 'Sally', bookingdates: { checkin: '2026-01-01' } }, items: [{ id: 7 }] };
  it('reads nested fields and array indexes', () => {
    expect(getPath(body, 'booking.bookingdates.checkin')).toBe('2026-01-01');
    expect(getPath(body, 'items.0.id')).toBe(7);
    expect(getPath(body, 'booking.nope.x')).toBeUndefined();
  });
});

describe('fillPath and deepMerge', () => {
  it('fills path variables, URL-encoded', () => {
    expect(fillPath('/booking/{bookingId}/notes/{note}', { bookingId: 42, note: 'a b' })).toBe('/booking/42/notes/a%20b');
  });

  it('overrides nested body fields without dropping the others', () => {
    expect(deepMerge({ a: 1, d: { x: 1, y: 2 } }, { d: { y: 3 }, e: 4 })).toEqual({ a: 1, d: { x: 1, y: 3 }, e: 4 });
    expect(deepMerge(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});
