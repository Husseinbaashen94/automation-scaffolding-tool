#!/usr/bin/env bash
# The end-to-end proof: create the example project, run its tests against the real practice apps,
# then show that updates really drive the tests (a wrong value or locator fails them, the fix passes)
# and that a deleted feature leaves no tests behind. Needs network access.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CREATE="node $ROOT/packages/create-qa-suite/dist/cli/create.js"
UPDATE="node $ROOT/packages/update-qa-suite/bin.js"
DELETE="node $ROOT/packages/delete-qa-suite/bin.js"
WORK="$(mktemp -d)"
DIR="$WORK/shop"
trap 'rm -rf "$WORK"' EXIT
failures=0

expect_code() {
  local want="$1"; shift
  local label="$1"; shift
  "$@" >"$WORK/last.log" 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then echo "ok   exit $got  $label"; else echo "FAIL exit $got (wanted $want)  $label"; tail -40 "$WORK/last.log"; failures=$((failures + 1)); fi
}

npm run build --silent --prefix "$ROOT/packages/create-qa-suite"
expect_code 0 "create the example project" $CREATE "$DIR" --yes --skip-install
(cd "$DIR" && npm install --no-audit --no-fund --silent && npx playwright install ${CI:+--with-deps} chromium >/dev/null)

expect_code 0 "the new project passes" bash -c "cd '$DIR' && npx playwright test"
expect_code 1 "a wrong expected value fails the cart tests" $UPDATE "$DIR" --feature cart --page inventory --element cart-badge --expect text=9 --check cart-add-two
expect_code 0 "putting it back passes" $UPDATE "$DIR" --feature cart --page inventory --element cart-badge --expect text=2 --check cart-add-two
expect_code 1 "a wrong locator fails login and cart" $UPDATE "$DIR" --feature login --page login --element login-button --locator '[data-test="nope"]'
expect_code 0 "putting it back passes" $UPDATE "$DIR" --feature login --page login --element login-button --locator '[data-test="login-button"]'
expect_code 1 "a wrong API status fails the bookings tests" $UPDATE "$DIR" --feature bookings --endpoint get-booking --expect status=410 --from 404
expect_code 0 "putting it back passes" $UPDATE "$DIR" --feature bookings --endpoint get-booking --expect status=404 --from 410
expect_code 0 "delete the cart feature; the rest still passes" $DELETE "$DIR" --feature cart --yes
listed="$(cd "$DIR" && npx playwright test --list --grep '@cart(?![\w-])' 2>/dev/null | grep -c '@cart' || true)"
if [ "$listed" = "0" ]; then echo "ok   no tests left for the deleted feature"; else echo "FAIL $listed cart tests still listed"; failures=$((failures + 1)); fi

if [ "$failures" -eq 0 ]; then echo "lifecycle passed"; else echo "lifecycle: $failures step(s) failed"; exit 1; fi
