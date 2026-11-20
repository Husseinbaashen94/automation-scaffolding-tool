import { expect, type APIRequestContext } from '@playwright/test';
import { findEndpoint, findRole, coverage } from './coverage.js';
import { schemaProblems } from './schema.js';
import type { Role, Value } from './types.js';
import { deepMerge, fillPath, getPath, resolveValue, type ValueContext } from './values.js';

const tokens = new Map<string, string>();

/** Headers that authenticate a role for API calls (logging in once per worker for token roles). */
async function authHeaders(request: APIRequestContext, role: Role | undefined, ctx: ValueContext): Promise<Record<string, string>> {
  if (!role || role.api.type === 'none') return {};
  const api = role.api;
  if (api.type === 'basic') {
    const user = String(resolveValue(api.username, ctx));
    const pass = String(resolveValue(api.password, ctx));
    return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` };
  }
  let token = tokens.get(role.id);
  if (!token) {
    const res = await request.fetch(coverage.settings.apiBaseUrl + api.login.path, {
      method: api.login.method,
      headers: { Accept: 'application/json' },
      data: resolveValue(api.login.body, ctx),
    });
    expect(res.ok(), `logging in as ${role.id} (${api.login.method} ${api.login.path}) returned ${res.status()}`).toBe(true);
    token = String(getPath(await res.json(), api.tokenPath) ?? '');
    expect(token, `no token at "${api.tokenPath}" in the ${role.id} login response`).not.toBe('');
    tokens.set(role.id, token);
  }
  return api.type === 'bearer' ? { Authorization: `Bearer ${token}` } : { Cookie: `${api.cookieName ?? 'token'}=${token}` };
}

export type ApiCall = { endpoint: string; role: string; params?: Record<string, Value>; body?: Record<string, Value> };

/** Sends one request as a role and returns the status and body (parsed as JSON when it is JSON). */
export async function send(request: APIRequestContext, call: ApiCall, ctx: ValueContext): Promise<{ status: number; body: unknown; json: boolean }> {
  const endpoint = findEndpoint(call.endpoint);
  const params = resolveValue(call.params ?? {}, ctx) as Record<string, Value>;
  const body = resolveValue(deepMerge(endpoint.request?.body, call.body) ?? null, ctx);
  const res = await request.fetch(coverage.settings.apiBaseUrl + fillPath(endpoint.path, params), {
    method: endpoint.method,
    headers: { ...endpoint.request?.headers, ...(await authHeaders(request, findRole(call.role), ctx)) },
    ...(body !== null && endpoint.method !== 'GET' ? { data: body } : {}),
  });
  const text = await res.text();
  const isJson = (res.headers()['content-type'] ?? '').includes('json');
  return { status: res.status(), body: isJson && text ? JSON.parse(text) : text, json: isJson };
}

/** Runs one API check: status, response schema (on success), expected values, then saves values for later checks. */
export async function runApiCheck(
  request: APIRequestContext,
  check: ApiCall & { id: string; expect: { status: number; values?: Record<string, Value> }; save?: Record<string, string> },
  ctx: ValueContext,
): Promise<void> {
  const res = await send(request, check, ctx);
  expect(res.status, `${check.id}: status`).toBe(check.expect.status);
  const schema = findEndpoint(check.endpoint).response;
  if (schema && res.status < 300 && res.json) expect(schemaProblems(schema, res.body), `${check.id}: response matches the ${check.endpoint} schema`).toEqual([]);
  for (const [path, expected] of Object.entries(check.expect.values ?? {})) {
    expect(getPath(res.body, path), `${check.id}: ${path}`).toEqual(resolveValue(expected, ctx));
  }
  for (const [name, path] of Object.entries(check.save ?? {})) {
    const value = getPath(res.body, path);
    expect(value, `${check.id}: "${path}" to save as {${name}}`).not.toBeUndefined();
    ctx.saved[name] = value as Value;
  }
}
