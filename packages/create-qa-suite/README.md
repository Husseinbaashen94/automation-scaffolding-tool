# create-qa-suite

[![CI](https://github.com/Husseinbaashen94/create-qa-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/Husseinbaashen94/create-qa-suite/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-UI%20%C2%B7%20API%20%C2%B7%20access%20control-2EAD33?logo=playwright&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

**Three commands that create and maintain a Playwright test suite for UI, API and access control.**

```bash
npx create-qa-suite my-project      # a ready-to-run test project
npx update-qa-suite my-project …    # an app change, applied everywhere it's tested
npx delete-qa-suite my-project …    # a feature's coverage, removed cleanly
```

## Why it exists

Applications change all the time: an endpoint moves, a payload field is renamed, a button gets a new test id, a price changes. In most test suites each of those facts is written in several places. Someone updates three of the four, the suite goes red for the wrong reason, or worse, stays green while testing the old behaviour.

This tool keeps the suite in step with the app:

- **What to test is data, written once.** Endpoints, payloads, response schemas, page elements, expected values and access rules live in JSON coverage files. Generic Playwright specs read them. Each endpoint and each element is defined in exactly one place.
- **A change in the app is one command.** `update-qa-suite` applies it to every check, saved value and access rule that depends on it, in every feature. It shows you exactly what changed, then runs only the affected tests.
- **Nothing is left half-done.** Every command writes all of its files or none. It refuses anything ambiguous and lists the candidates, so you choose instead of the tool guessing.

## Quick start

You need Node.js 22 or newer.

```bash
npx create-qa-suite my-shop       # asks 3 questions; add --yes to accept the defaults
cd my-shop
npm test
```

The new project already has three example features that pass against two public practice apps:
- `login` and `cart` run UI and access tests against [Sauce Demo](https://www.saucedemo.com).
- `bookings` runs an API create → read → update → delete chain, plus access rules, against [Restful-Booker](https://restful-booker.herokuapp.com/apidoc/index.html).

> **Status:** version 1.0.0 is ready to publish but **not yet on npm**. Until then, run the commands from a clone (see [Run it from source](#run-it-from-source)).

## The three commands

Every command:
- shows a readable list of what it will change;
- writes everything or nothing;
- runs the tests of the affected features. Add `--no-run` to skip this, or `--dry-run` to only look.

| Exit code | Meaning |
|---|---|
| `0` | Done (and the tests passed, if they ran) |
| `1` | Done, but the affected tests failed: the app or the coverage needs a look |
| `2` | Nothing was changed: a usage error, invalid coverage, a target that doesn't exist, or a cancelled confirmation |

### `create-qa-suite`: a new project, or a new feature

```bash
npx create-qa-suite my-shop                       # with the example features
npx create-qa-suite my-shop --empty --yes \
  --ui-base-url https://app.example.com --api-base-url https://api.example.com
```

| Flag | Meaning |
|---|---|
| `--empty` | No example features |
| `--yes` | Accept the defaults instead of asking |
| `--ui-base-url`, `--api-base-url` | Where the app and its API live |
| `--skip-install` | Don't run `npm install` or install the Chromium browser |

Run on an existing project, `--feature` adds coverage for a new feature. Everything it adds is a **draft**: it's reported as a to-do rather than failing, until you fill it in.

```bash
npx create-qa-suite my-shop --feature orders --endpoint "POST /orders" --status 201 --role admin \
  --rule "guest POST /orders 401"
```
```
~ .qa-suite.json
    features: added "orders"
~ coverage/_shared/endpoints.json
    endpoints: added post-orders
+ coverage/orders/acl.json
+ coverage/orders/api.json
+ coverage/orders/ui.json

Drafts to fill in (each is reported as a to-do, not run, until you remove its "draft": true):
  - coverage/_shared/endpoints.json → post-orders: the request body and the response schema
  - coverage/orders/api.json → orders-post-orders: the title, path values (params), body overrides and expected values
  - coverage/orders/acl.json → orders-guest-post-orders-401: path values and any setup checks
```

| Flag | Meaning |
|---|---|
| `--feature <name>` | The new feature |
| `--endpoint "METHOD /path"` | Add an API check (repeatable). An endpoint that already exists is reused |
| `--status <code>`, `--role <role>` | Expected status and role for the added checks (default `200`, `guest`) |
| `--page <id>` with `--path </path>` | Add a page with a check that it shows (repeatable, in pairs) |
| `--rule "<rule>"` | Add an access rule: `"guest POST /orders 401"` or `"guest page:checkout denied"` |

### `update-qa-suite`: apply one change in the app

Name the feature you're working on, then describe the change in one of five shapes:

| The app changed… | Command | What gets updated |
|---|---|---|
| **an endpoint** | `--endpoint "GET /booking/{id}" --to "GET /bookings/{id}"` (method, path or both) | The endpoint's single definition, plus renamed path variables in every check and access rule, **in every feature** |
| **a request payload** | `--endpoint create-booking --request-field firstname` with `--rename first_name`, `--remove`, `--add "nights=4"` or `--set "totalprice=150"` | The default body and every check's override (nested fields such as `bookingdates.checkin` too) |
| **an element** | `--page login --element login-button --locator '[data-test="sign-in"]'` | The element's single definition. Every feature whose tests touch it is re-run, including features that log in through it |
| **a response payload** | `--endpoint create-booking --response-field bookingid` with `--rename id`, `--remove` or `--add "nights:number"` | The response schema and its `required` list, every expected value, and every saved value that reads the field |
| **an expected value** | API: `--endpoint get-booking --expect status=404` or `--expect "firstname=Jim"`. UI: `--page inventory --element cart-badge --expect text=3` (or `value=…`, `count=n`) | Only checks in the named feature. If they expect different values today, narrow it with `--check <id>` or `--from <current value>` |

An endpoint change that renames a path variable:

```
$ npx update-qa-suite my-shop --feature bookings --endpoint "GET /booking/{bookingId}" --to "GET /bookings/{id}"
~ coverage/_shared/endpoints.json
    endpoints[get-booking].path: "/booking/{bookingId}" → "/bookings/{id}"
~ coverage/bookings/api.json
    checks[bookings-read].params.bookingId: "{bookingId}" → (removed)
    checks[bookings-read].params.id: (added) → "{bookingId}"
    checks[bookings-read-deleted].params.bookingId: "{bookingId}" → (removed)
    checks[bookings-read-deleted].params.id: (added) → "{bookingId}"

Endpoint get-booking: GET /booking/{bookingId} → GET /bookings/{id}
Path variables renamed in 2 check(s) and rule(s): {bookingId} → {id}
Affected features: bookings
```

A response field renamed by the API team:

```
$ npx update-qa-suite my-shop --feature bookings --endpoint create-booking --response-field bookingid --rename id
~ coverage/_shared/endpoints.json
    endpoints[create-booking].response.required: removed "bookingid"
    endpoints[create-booking].response.required: added "id"
    endpoints[create-booking].response.properties.bookingid: {"type":"number"} → (removed)
    endpoints[create-booking].response.properties.id: (added) → {"type":"number"}
~ coverage/bookings/api.json
    checks[bookings-create].save.bookingId: "bookingid" → "id"
```

An ambiguous value change is refused rather than guessed:

```
$ npx update-qa-suite my-shop --feature cart --page inventory --element cart-badge --expect text=3
These checks expect different values for text on inventory.cart-badge:
  - cart-add-one: "1"
  - cart-add-two: "2"
  - cart-remove: "1"
Say which to change with --check <id> or --from <current value>.
```

Some changes are refused because they can't be applied safely:
- an endpoint change that adds or drops a path variable;
- removing a response field that checks still assert (the checks are listed);
- an endpoint, page or element the feature doesn't use.

### `delete-qa-suite`: remove a feature's coverage

```
$ npx delete-qa-suite my-shop --feature cart
~ .qa-suite.json
    features: removed "cart"
- coverage/cart/acl.json
- coverage/cart/api.json
- coverage/cart/ui.json

Type the feature name (cart) to delete its coverage: cart
```

- **Removed:** the feature's coverage, plus access rules in other features that depended on it (rules that used its checks as setup, or targeted its pages). Each one is named.
- **Kept:** shared endpoints, pages and roles. Any that no feature uses any more are listed as "now unused".
- **Never touched:** `tests/custom/`, where your hand-written tests live.
- **Confirmation:** you type the feature name before anything is deleted. `--yes` skips this in scripts, and without a terminal `--yes` is required.

## How coverage files work

```
my-shop/
  .qa-suite.json                  base URLs and the list of features
  coverage/
    _shared/roles.json            roles and how each logs in (credentials only as env:NAME)
    _shared/endpoints.json        every endpoint, once: method, path, default body, response schema
    _shared/pages.json            pages several features use, with their elements
    bookings/api.json             API checks, run in order (values saved by one feed the next)
    login/ui.json                 pages and UI checks (steps such as fill, click, text, url)
    login/acl.json                access rules: role × endpoint or page → expected outcome
  tests/{api,ui,acl}.spec.ts      generic runners; you don't edit them
  tests/custom/                   your own tests
  schemas/                        JSON Schemas: editor autocomplete and validation
```

An API check refers to its endpoint by id and only says what's specific to it:

```json
{
  "id": "bookings-update",
  "title": "an admin can update the booking",
  "endpoint": "update-booking",
  "role": "admin",
  "params": { "bookingId": "{bookingId}" },
  "body": { "firstname": "Jim" },
  "expect": { "status": 200, "values": { "firstname": "Jim", "lastname": "Brown" } }
}
```

Every field is described in **[docs/coverage-format.md](docs/coverage-format.md)**. Each command validates the coverage files before it changes anything, and so does the test run. Mistakes are reported with the file and the field, such as `coverage/bookings/api.json checks[0].expect.status: must be integer`, and invalid JSON with its line and column.

## Safety and secrets

- **All or nothing.** New contents are written to temporary files and swapped in together. If anything fails halfway, every file is put back exactly as it was. A test proves this with a simulated disk error.
- **Never a guess.** Anything ambiguous or missing is refused with the list of what exists.
- **Credentials only from `.env`.** Role logins in `roles.json` must be `env:NAME` references; validation rejects a literal password there. The examples keep every real login in `.env`. `.env` is git-ignored and `.env.example` lists every variable with an empty value. The example features' demo logins are the ones Sauce Demo and Restful-Booker publish. They go only into the new project's `.env`.
- **Hand-written tests are yours.** No command reads or writes `tests/custom/`.

## How it's tested

**163 automated tests** (Vitest) cover:
- **Coverage model:** loading, validation of every cross-reference, invalid JSON reported with line and column. A test also proves the tool's dependency-free schema checker agrees with `ajv` on the shipped JSON Schemas.
- **Generated runner:** value resolution, step mapping, coverage loading, the example coverage, and pinned template versions.
- **Change engine:** all-or-nothing writes with rollback, the change summary, and selecting tests by feature tag.
- **Every command:** each update shape, including renamed path variables, nested fields, ambiguous values and features sharing an endpoint. Each anti-goal is asserted directly, for example "no reference to the old value remains anywhere in the coverage".
- **The real binaries:** a full create → add feature → every kind of update → delete life cycle, plus the npm package contents.

**Mutation checks** were run while building. Disabling the rollback, path-variable renaming, saved-value renaming, login-flow propagation, the ambiguity refusal, endpoint reuse, or dependent-rule removal each makes at least one test fail.

**CI** runs three jobs on every push, on pull requests, and weekly:

| Job | What it proves |
|---|---|
| Unit and command tests | Node 22 and 24: typecheck, build, all tests |
| Packed packages | `npm pack`s all three packages, installs the tarballs into an empty folder, and runs create, update and delete from there |
| Generated project | Creates the example project and runs its Playwright suite against the real practice apps. Then proves the tests are real: a wrong expected value, a wrong locator and a wrong API status each make them **fail** (exit 1), and putting each back makes them pass. Finally, deleting a feature leaves the rest passing and no tests tagged with it |

## Limitations

- **Changes are described, not detected.** You tell the tool what changed. It doesn't compare an OpenAPI spec or the live page (a possible future version).
- **The runner is copied into each project.** A new version of the tool doesn't update `tests/*.spec.ts` and `support/` in existing projects.
- **Only the five change shapes above are automated.** Anything else is a direct edit of the JSON, which the schemas and validation still check.
- **Files are rewritten in a standard format.** Coverage files the tools change are written as 2-space JSON.
- **A wrong locator is slow to fail.** Playwright waits its timeout (30 s) for each missing element before failing.

## Run it from source

```bash
git clone https://github.com/Husseinbaashen94/create-qa-suite.git
cd create-qa-suite
npm install
npm run build
node packages/create-qa-suite/dist/cli/create.js ../my-shop
node packages/update-qa-suite/bin.js ../my-shop --help
node packages/delete-qa-suite/bin.js ../my-shop --help
```

```bash
npm test                     # all tests (no network)
npm run typecheck
bash scripts/pack-test.sh    # the packed packages install and run
bash scripts/lifecycle.sh    # end to end against the practice apps (needs network)
```

## Releasing

The three packages share one version and are published together by `.github/workflows/release.yml`:

1. Create an npm account and an **automation token**. Add it as the repository secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).
2. Set the same version in `packages/*/package.json`, and in the wrappers' `create-qa-suite` dependency.
3. Push a tag such as `v1.0.0`. The workflow checks the tag matches every version, runs all the tests and the pack test, then publishes `create-qa-suite`, `update-qa-suite` and `delete-qa-suite` with npm provenance.

## License

MIT © Hussein Baashen
