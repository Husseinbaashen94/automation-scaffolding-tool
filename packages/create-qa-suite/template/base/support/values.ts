import type { Value } from './types.js';

export type ValueContext = { env: Record<string, string | undefined>; saved: Record<string, Value> };

const WHOLE = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const INSIDE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function saved(name: string, ctx: ValueContext): Value {
  if (!(name in ctx.saved)) throw new Error(`"{${name}}" has not been saved by an earlier check`);
  return ctx.saved[name]!;
}

/** Replaces env:NAME with the environment value and {name} with a value saved by an earlier check. */
export function resolveValue(value: Value | undefined, ctx: ValueContext): Value {
  if (typeof value === 'string') {
    if (value.startsWith('env:')) {
      const name = value.slice(4);
      const v = ctx.env[name];
      if (v === undefined || v === '') throw new Error(`Set ${name} in .env (see .env.example)`);
      return v;
    }
    const whole = WHOLE.exec(value);
    if (whole) return saved(whole[1]!, ctx);
    return value.replace(INSIDE, (_, name: string) => String(saved(name, ctx)));
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, ctx)]));
  return value ?? null;
}

/** Reads a field by dot path, with numeric array indexes: "booking.bookingdates.checkin", "items.0.id". */
export function getPath(obj: unknown, path: string): unknown {
  let node: unknown = obj;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Fills {variables} in an endpoint path, URL-encoding each value. */
export const fillPath = (path: string, params: Record<string, Value>): string =>
  path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(String(params[name])));

const isObject = (v: unknown): v is Record<string, Value> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Applies a check's body overrides on top of the endpoint's default body (objects merge, everything else replaces). */
export function deepMerge(base: Value | undefined, override: Record<string, Value> | undefined): Value | undefined {
  if (!override) return base;
  if (!isObject(base)) return override;
  const out: Record<string, Value> = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = isObject(v) && isObject(out[k]) ? (deepMerge(out[k], v) as Value) : v;
  return out;
}
