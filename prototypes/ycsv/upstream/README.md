# Upstream YCSV code (snapshot for spike 11)

Checked out from `origin/feat/spreadsheet-core` at `e30a45bbc60dd9e2b43d1a6d0a00ac8fab259b56`:

| Here | Origin path |
|---|---|
| `ycsv-spec-v1.md` | `packages/apps/docs/ycsv-spec-v1.md` |
| `spreadsheet-core/` | `packages/apps/src/spreadsheet-core/` |

They live under `prototypes/ycsv/upstream/` and not at their origin paths on purpose.
`spreadsheet-core` imports modules that are not on main (`drive-core/src/drive-models`,
`lib/api/mock/spreadsheet-bootstrap`) and needs `js-yaml` + `@formulajs/formulajs`, which
`packages/apps` does not depend on. Under `packages/apps/` it would break the apps
typecheck and the pre-push done gate. Moving the files back is a `git mv`.

Spike 11 runs the parser (`spreadsheet-core/src/ycsv/ycsv.ts`) and the engine
(`ycsv-formula-engine.ts`) through `prototypes/ycsv/interop/` with a vitest alias
`@` → `prototypes/ycsv/upstream`. The spec file carries spike 11's proposed amendments,
each marked **Proposal (spike 11)**.
