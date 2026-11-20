/**
 * The coverage data model. Coverage lives in JSON files under coverage/; these types describe them.
 * Kept identical in the create-qa-suite tool (src/model/types.ts) — a test checks the two copies match.
 */

/** A Playwright selector, e.g. [data-test="login-button"], role=button[name="Login"], text=Sign in. */
export type Locator = string;

/** Any JSON value. Strings may be env:NAME (read from .env) or contain {saved} values from earlier checks. */
export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

export type ApiAuth =
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer' | 'cookie'; login: { method: string; path: string; body?: Value }; tokenPath: string; cookieName?: string };

/** A role the tests act as. "guest" is built in and means: not logged in. */
export type Role = { id: string; api: ApiAuth; ui?: { loginFlow: Step[] } };

/** An endpoint of the application under test, defined once for the whole project. */
export type Endpoint = {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  request?: { headers?: Record<string, string>; body?: Value };
  response?: JsonSchema;
};

/** A JSON Schema describing a response body. */
export type JsonSchema = { [key: string]: Value };

export type ApiCheck = {
  id: string;
  title: string;
  endpoint: string;
  role: string;
  params?: Record<string, Value>;
  body?: Record<string, Value>;
  expect: { status: number; values?: Record<string, Value> };
  save?: Record<string, string>;
  draft?: true;
};

export type Page = { id: string; path: string; marker: string; elements: Record<string, Locator> };

/** One UI step. Element references are "<page>.<element>"; page references are the page id. */
export type Step =
  | { goto: string }
  | { fill: string; value: Value }
  | { click: string }
  | { select: string; value: Value }
  | { check: string }
  | { visible: string }
  | { hidden: string }
  | { text: string; equals: Value }
  | { value: string; equals: Value }
  | { count: string; equals: number }
  | { url: string };

export type UiCheck = { id: string; title: string; role: string; start: string; steps: Step[]; draft?: true };

export type AclTarget = { endpoint: string; params?: Record<string, Value>; body?: Record<string, Value> } | { page: string };
export type AclExpect = { status: number } | { allowed: boolean; denied?: string };
export type AclRule = { id: string; role: string; setup?: string[]; target: AclTarget; expect: AclExpect; draft?: true };

export type Feature = { name: string; api: ApiCheck[]; ui: { pages: Page[]; checks: UiCheck[] }; acl: AclRule[] };

export type Settings = { toolVersion: string; uiBaseUrl: string; apiBaseUrl: string; features: string[] };

export type Project = { dir: string; settings: Settings; roles: Role[]; endpoints: Endpoint[]; sharedPages: Page[]; features: Feature[] };

/** A problem found in the coverage files: which file, where in it, and what is wrong. */
export type Problem = { file: string; path: string; message: string };
