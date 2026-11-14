# Import boundaries in `packages/apps/src`

Every top-level folder under `packages/apps/src` is a module, and every module sits in one of four layers. A file imports its own module, modules in a lower layer, and modules in its own layer. It never imports a higher layer.

| Layer     | Modules                                                                                                                                  | Holds                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| base      | `lib`, `types`, `assets`                                                                                                                 | Shared logic with no app UI: API clients, offline sync, RTC, the calendar engine, file models                            |
| primitive | every folder that is not base, `*-core` or shell (`ui`, `button`, `share-ui`, `chat-ui`, `hooks`, `workspace-shell`, `workspace-app`, …) | Shared UI and hooks. `workspace-shell` and `workspace-app` are the layout frames each app renders into, so they sit here |
| core      | `*-core` (`drive-core`, `calendar-core`, …)                                                                                              | One app each                                                                                                             |
| shell     | `wegotworkspace`                                                                                                                         | Router, routes and auth around the apps                                                                                  |

One app package does not import another, except for the one-way pairs on `CORE_ALLOWLIST`. Each entry there carries its reason. Today they are Docs on Drive, the apps that embed `text-editor-core`, and the apps that build on `presence-core`. Files directly in `src/` (`main.tsx`, `sw.ts`) are entry points and are not checked. Tests are not checked; stories are.

When an import breaks the direction, move the shared code down: a type or helper two apps need goes to `src/lib/` (for example `src/lib/files/` for the Drive file model), and a shared UI piece goes to a primitive. Do not add an allowlist entry to silence a warning.

## Enforcement

- Rule: `wgw-boundaries/import-boundaries` in [`packages/apps/eslint.config.js`](../../../packages/apps/eslint.config.js), implemented in [`packages/apps/scripts/eslint-import-boundaries.mjs`](../../../packages/apps/scripts/eslint-import-boundaries.mjs) (layer map and `CORE_ALLOWLIST`). It is `warn` while the existing violations are moved ([#1638](https://github.com/WeGotWorkspace/wegotworkspace/issues/1638)); it becomes `error` when the count is zero.
- Report: `pnpm --filter @wgw/apps run lint:boundaries` prints the warnings per (from → to) edge and the two-way pairs that involve an app package. Add `--json` for machine-readable output. A pull request that moves code records the count before and after.
- Baseline: [`packages/apps/scripts/import-boundaries-baseline.json`](../../../packages/apps/scripts/import-boundaries-baseline.json) holds the number of importing files per edge and the list of two-way pairs. `pnpm check:import-boundaries` (in `ci:quality:apps`) fails when an edge is new or has more files than its baseline row, and when two modules import each other but their pair is not on the list. The pair list matters because a cycle can start with an allowed import: when an app package imports a primitive that already imports it, no edge is new, yet the two now depend on each other. When a move lowers an edge or ends a pair, `pnpm --filter @wgw/apps run lint:boundaries --update` lowers the row or drops the pair; it never raises a count, adds an edge or adds a pair. Doing any of those means editing the JSON by hand, which needs a reviewer's agreement.

## Remaining exceptions

[#1638](https://github.com/WeGotWorkspace/wegotworkspace/issues/1638) moved most shared code down. What is left below is on purpose: each one needs a design change or a large move of its own, not a file move. The baseline lists each of them, so none can grow. Each row names the follow-up that removes it; [#2116](https://github.com/WeGotWorkspace/wegotworkspace/issues/2116) tracks them.

### Two-way pairs

| Pair                        | The import that closes the loop                                                                         | Why it stays for now                                                                                  | Follow-up                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `notes-core` ↔ `tasks-core` | Notes uses `TaskProjectDialog` for notebooks; Tasks uses the notebook select and change-notebook dialog | Notebooks and task lists share one "project" dialog. Merging them into one primitive is a UI decision | Shared project/notebook dialog primitive |

### `lib/` importing an app package

| Files in `lib/`                                                      | Imports from                                                                            | Why it stays for now                                                                                                                                                                                                                                                                                  | Follow-up                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 14 files in `lib/offline/` (docs, drive, notes collab, offline wipe) | `text-editor-core/docs-collab/` (persistence, utils, etag, server IO, pending registry) | The offline layer saves and syncs collaborative documents through the shared collab engine. Several of those files depend on `text-editor-core/src/text-editor-content`, so moving them into `lib/` needs a design of its own ([#2116](https://github.com/WeGotWorkspace/wegotworkspace/issues/2116)) | Move the collab persistence code into `lib/` |
