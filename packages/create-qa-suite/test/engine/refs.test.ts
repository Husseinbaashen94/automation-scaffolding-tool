import { describe, expect, it } from 'vitest';
import { removeField, renameField, schemaAddProperty, schemaRemoveProperty, schemaRenameProperty, setField } from '../../src/engine/refs.js';

describe('field paths in request bodies', () => {
  it('renames a nested field in place, keeping key order', () => {
    const body = { a: 1, dates: { checkin: 'x', checkout: 'y' }, z: 2 };
    expect(renameField(body, 'dates.checkin', 'check_in')).toBe(true);
    expect(JSON.stringify(body)).toBe('{"a":1,"dates":{"check_in":"x","checkout":"y"},"z":2}');
    expect(renameField(body, 'dates.nope', 'x')).toBe(false);
  });

  it('removes and sets nested fields (creating parents when setting)', () => {
    const body: Record<string, unknown> = { a: { b: 1, c: 2 } };
    expect(removeField(body as never, 'a.b')).toBe(true);
    setField(body as never, 'x.y', 5);
    expect(body).toEqual({ a: { c: 2 }, x: { y: 5 } });
  });
});

describe('field paths in response schemas', () => {
  const schema = () => ({ type: 'object', required: ['id', 'booking'], properties: { id: { type: 'number' }, booking: { type: 'object', required: ['firstname'], properties: { firstname: { type: 'string' }, last: { type: 'string' } } } } });

  it('renames a nested property and its required entry, keeping order', () => {
    const s = schema();
    expect(schemaRenameProperty(s as never, 'booking.firstname', 'first_name')).toBe(true);
    expect(Object.keys(s.properties.booking.properties)).toEqual(['first_name', 'last']);
    expect(s.properties.booking.required).toEqual(['first_name']);
  });

  it('removes a property and its required entry; adds a required property with a type', () => {
    const s = schema();
    expect(schemaRemoveProperty(s as never, 'id')).toBe(true);
    expect(s.required).toEqual(['booking']);
    expect(schemaAddProperty(s as never, 'booking.nights', 'number')).toBe(true);
    expect(s.properties.booking).toMatchObject({ required: ['firstname', 'nights'], properties: { nights: { type: 'number' } } });
    expect(schemaRemoveProperty(s as never, 'booking.nope')).toBe(false);
  });
});
