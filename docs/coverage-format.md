# Coverage file format

Everything a QA suite project tests is described in JSON files. The specs in `tests/` read them, and `create-qa-suite`, `update-qa-suite` and `delete-qa-suite` edit them. Every file has a JSON Schema in `schemas/` (its `$schema` line points at it), so editors such as VS Code autocomplete fields and underline mistakes.

**Names.** Feature names and every `id` use lower-case letters, digits and dashes, starting with a letter: `bookings`, `login-button`, `order-history`.

**Values.** Anywhere a value is sent or expected, a string can be:
- `env:NAME`: read from `.env` (for example `env:SAUCE_PASSWORD`). Credentials must always be written this way.
- `{name}`: a value saved by an earlier API check in the same feature (for example `{bookingId}`), or by an access rule's `setup` checks. A whole-string `"{bookingId}"` keeps the saved type (a number stays a number); inside longer text it is inserted as text.

**Lists.** The shared files hold `roles`, `endpoints` and `pages`; a feature's files hold `checks` (API and UI), `pages` (UI) and `rules` (access). Step values that are compared use `equals`; `fill` and `select` steps use `value`.

**Drafts.** Any check or rule can carry `"draft": true`. Drafts are reported as to-do (Playwright `fixme`) and not run. `create-qa-suite --feature` adds new coverage as drafts; remove the flag once you've filled it in.

---

## `.qa-suite.json`: project settings

| Field | Meaning |
|---|---|
| `toolVersion` | The create-qa-suite version that created the project |
| `uiBaseUrl` | Base URL of the web app. `UI_BASE_URL` in `.env` overrides it |
| `apiBaseUrl` | Base URL of the API. `API_BASE_URL` in `.env` overrides it |
| `features` | The features, in the order their coverage folders are read |

## `coverage/_shared/roles.json`: who the tests act as

`guest` is built in: no login, no session. Every other role is listed under `roles`:

| Field | Meaning |
|---|---|
| `id` | The role's name, used by checks and rules (`admin`, `standard`) |
| `api` | How the role authenticates API calls (below) |
| `ui` | How the role logs in to the web app: `loginFlow`, a list of steps (see UI steps). The session is reused for every UI test that runs as this role |

`api` is one of:

| `type` | Other fields | What is sent |
|---|---|---|
| `none` | | nothing |
| `basic` | `username`, `password` | `Authorization: Basic …` |
| `bearer` | `login`, `tokenPath` | logs in once with `login` (`method`, `path`, `body`), reads the token at `tokenPath` in the response, then sends `Authorization: Bearer <token>` |
| `cookie` | `login`, `tokenPath`, `cookieName` | as `bearer`, but sends the token as the cookie `cookieName` |

Credentials (`username`, `password`, values in the login `body`, and `fill` values in a `loginFlow`) must be `env:NAME` references.

## `coverage/_shared/endpoints.json`: the API, defined once

Each endpoint of the application appears once, so a change to it is made in one place:

| Field | Meaning |
|---|---|
| `id` | The endpoint's name, used by checks and rules (`create-booking`) |
| `method` | `GET`, `POST`, `PUT`, `PATCH` or `DELETE` |
| `path` | The path, with `{variables}` for the parts that change: `/booking/{bookingId}` |
| `request` | Defaults sent on every call: `headers` (name → value) and a JSON `body` |
| `response` | A JSON Schema the response body must match on every successful (2xx) JSON response |

## `coverage/_shared/pages.json` and the `pages` of a feature

Pages used by several features go in the shared file; a page only one feature uses can live in that feature's `ui.json`. Page ids are unique across the whole project.

| Field | Meaning |
|---|---|
| `id` | The page's name (`login`, `inventory`) |
| `path` | Its path on the web app (`/inventory.html`) |
| `marker` | The element that proves the page is shown. Access rules check it |
| `elements` | Element name → Playwright selector, e.g. `"login-button": "[data-test=\"login-button\"]"` or `"role=button[name=\"Log in\"]"` |

Steps refer to elements as `<page>.<element>` (`login.login-button`), never by selector, so a changed selector is one edit.

## `coverage/<feature>/api.json`: API checks

`checks` run in file order, one after another, so a later check can use what an earlier one saved.

| Field | Meaning |
|---|---|
| `id` | Unique across the project (`bookings-read`) |
| `title` | What the check proves, shown in the report |
| `endpoint` | The endpoint's `id` |
| `role` | `guest` or a role's `id` |
| `params` | A value for each `{variable}` in the path |
| `body` | Changes to the endpoint's default body for this check only. Objects merge; anything else replaces |
| `expect` | `status` (required), and `values`: field path → expected value, e.g. `"booking.firstname": "Sally"`. Field paths use dots, and numbers for list positions (`items.0.id`) |
| `save` | Name → field path, to keep a value from the response for later checks: `"bookingId": "bookingid"` |
| `draft` | `true` while the check isn't filled in yet |

## `coverage/<feature>/ui.json`: UI checks

| Field | Meaning |
|---|---|
| `pages` | Pages only this feature uses (same fields as shared pages) |
| `checks` | The UI checks (below) |

Each UI check has:

| Field | Meaning |
|---|---|
| `id` | Unique across the project |
| `title` | What the check proves |
| `role` | Who the browser is logged in as |
| `start` | The page id to open first |
| `steps` | What to do and check, in order (below) |
| `draft` | `true` while the check isn't filled in yet |

### UI steps

| Key | Step | Does |
|---|---|---|
| `goto` | `{ "goto": "<page>" }` | Opens a page |
| `fill` | `{ "fill": "<page>.<element>", "value": … }` | Types into a field |
| `click` | `{ "click": "<page>.<element>" }` | Clicks |
| `select` | `{ "select": "<page>.<element>", "value": … }` | Chooses an option |
| `check` | `{ "check": "<page>.<element>" }` | Ticks a checkbox |
| `visible` | `{ "visible": "<page>.<element>" }` | Expects the element to be shown |
| `hidden` | `{ "hidden": "<page>.<element>" }` | Expects it not to be shown |
| `text` | `{ "text": "<page>.<element>", "equals": … }` | Expects its text |
| `value` | `{ "value": "<page>.<element>", "equals": … }` | Expects a field's value |
| `count` | `{ "count": "<page>.<element>", "equals": n }` | Expects how many match |
| `url` | `{ "url": "<page>" }` | Expects the browser to be on that page's path |

## `coverage/<feature>/acl.json`: access rules

Each rule says what one role gets when it tries one thing.

| Field | Meaning |
|---|---|
| `id` | Unique across the project |
| `role` | Who tries it |
| `setup` | API check ids to run first (each as its own role), for example to create the booking the rule then tries to change. Their saved values fill this rule's `params` |
| `target` | Either `endpoint` (with `params` and an optional `body`, as in API checks), or `page` |
| `expect` | For an endpoint: `status`. For a page: `allowed` (`true` or `false`), and optionally `denied`, an element that must be shown when access is refused (such as an error message) |
| `draft` | `true` while the rule isn't filled in yet |

A page rule with `"allowed": false` passes when the page's `marker` element is **not** shown (and the `denied` element is, if given).

**Write a positive control.** For every endpoint a role is denied, add a rule for a role that is allowed on the same request. Then a "denied" result can't pass by accident, for example as a 404 because nothing existed to change.
