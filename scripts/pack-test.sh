#!/usr/bin/env bash
# Packs the three npm packages exactly as they would be published, installs the tarballs into an
# empty folder, and runs each command from there. Proves the published packages work, not just the source.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

npm run build --silent --prefix "$ROOT/packages/create-qa-suite"
for p in create-qa-suite update-qa-suite delete-qa-suite; do
  (cd "$ROOT/packages/$p" && npm pack --silent --pack-destination "$WORK" >/dev/null)
done

TARBALL="$(ls "$WORK"/create-qa-suite-*.tgz)"
# List once into a file: piping tar into grep -q breaks the pipe on Linux, which pipefail reports as a failure.
tar -tzf "$TARBALL" > "$WORK/contents.txt"
for f in dist/cli/create.js dist/cli/main.js template/base/gitignore template/base/.env.example \
         template/base/.github/workflows/tests.yml template/base/schemas/api.schema.json template/examples/env; do
  grep -qx "package/$f" "$WORK/contents.txt" || { echo "missing from the package: $f"; exit 1; }
done
if grep -qE '^package/(src|test)/' "$WORK/contents.txt"; then echo "source or tests leaked into the package"; exit 1; fi

cd "$WORK"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund ./create-qa-suite-*.tgz ./update-qa-suite-*.tgz ./delete-qa-suite-*.tgz
npx --no-install create-qa-suite --help >/dev/null
npx --no-install update-qa-suite --help >/dev/null
npx --no-install delete-qa-suite --help >/dev/null
npx --no-install create-qa-suite demo --yes --skip-install >/dev/null
test -f demo/.qa-suite.json && test -f demo/.gitignore && test -f demo/.env
npx --no-install update-qa-suite demo --feature cart --page inventory --element cart-badge --expect text=3 --from 2 --no-run >/dev/null
npx --no-install delete-qa-suite demo --feature cart --yes --no-run >/dev/null
test ! -e demo/coverage/cart
echo "pack test passed: the packed create-, update- and delete-qa-suite install and run"
