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
- A new warning is a review finding: a pull request does not raise the count.
