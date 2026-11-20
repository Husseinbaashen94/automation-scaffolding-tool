# Contributing

Thanks for helping. The short version:

1. Node.js 22 or newer: `npm install`, then `npm run build`.
2. Write the failing test first (Vitest, in `packages/create-qa-suite/test/`), then the change.
3. Before opening a pull request: `npm run typecheck && npm test && bash scripts/pack-test.sh`.
   If you changed the template or the runner, also run `bash scripts/lifecycle.sh` (needs network).

Where things live:
- `packages/create-qa-suite/src/model/`: coverage types, loading and validation
- `packages/create-qa-suite/src/engine/`: computing, showing and writing changes
- `packages/create-qa-suite/src/commands/`: the create, update and delete commands
- `packages/create-qa-suite/template/`: the generated project (`base/`) and the example features (`examples/`)
- `packages/update-qa-suite`, `packages/delete-qa-suite`: thin wrappers, so `npx update-qa-suite` and `npx delete-qa-suite` work

Rules the tests enforce:
- The tool has no runtime dependencies.
- `src/model/types.ts` is an exact copy of `template/base/support/types.ts`.
- Every command flag appears in the README, and every coverage field in `docs/coverage-format.md`.
- Every `.env.example` lists variables with empty values only.
