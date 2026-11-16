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

None. The baseline has no two-way pairs left, so `pnpm check:import-boundaries` fails on any new one.

### `lib/` importing an app package

None. The collab persistence code that `lib/offline` uses (IndexedDB rooms, etag, server IO, bootstrap, pending registry) lives in `src/lib/collab/`, and the shared editor in `text-editor-core` imports it from there.

Turning a `Y.Doc` into Markdown or plain text, and seeding one from text, needs the editor's schema, so that code stays in `text-editor-core`. `lib/` gets it through [`lib/collab/collab-content-codec.ts`](../../../packages/apps/src/lib/collab/collab-content-codec.ts): the entry points (`main.tsx`, the Vitest setup and Storybook's `preview.ts`) import `src/provide-collab-content-codec.ts`, which hands lib a loader for the editor's codec. Use the same pattern when `lib/` needs something only an app package can build: lib defines the type and asks for it, and an entry point provides it.

### `lib/` importing a primitive

| Files in `lib/`                                              | Imports from                                            | Why it stays for now                                                                                                                                              | Follow-up                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `lib/calendar-event-calendar-picker.tsx`                     | `ui` (color swatch, dropdown menu, control size)        | The file holds the calendar picker's types and default choice, which lib uses, and the picker's menu UI. Moving the UI into a primitive needs stories of its own. | Split the picker UI into a primitive with stories; keep the types and default choice in lib |
| `lib/calendar-elements/CalendarListView/CalendarListView.ts` | `collection-state`, `list-sticky-header` (CSS, inlined) | The agenda web component inlines the list primitives' CSS into its shadow root, so it looks like the React lists.                                                 | Move the shared list CSS into a stylesheet lib or the web component can own                 |
