Source: #1632 (body-hash: ac4ae8ee)

# Warn when frontend code imports in the wrong direction

Technical translation of Chore #1632. The issue holds the acceptance criteria; this file records how the lint encodes them and the choices the issue leaves open. The moves that clear the warnings are #1638.

## Goal

`packages/apps/eslint.config.js` warns on every import in `packages/apps/src` that goes against the layering base (`lib`) → primitives → app packages (`*-core`) → shell, and on every app package → app package import that is not on an allowlist with a reason. A `lint:boundaries` script prints the warnings per (from → to) edge and the two-way pairs, so #1638 can record its count before and after each move.

## Non-goals

- Fixing any warning. That is #1638.
- `error` level or a count ratchet. That is the #1642 follow-up, once #1638 has brought the count down.
- Cycle detection (`import/no-cycle`), as the issue says.
- Imports from test files.

## Affected packages

- `packages/apps`: `eslint.config.js`, `scripts/eslint-import-boundaries.mjs` (rule), `scripts/lint-boundaries.mjs` (report), `scripts/eslint-import-boundaries.test.mjs`, `package.json` script.
- `.agents/`: `skills/apps-ui/import-boundaries.md`, a row in `POLICY.md`, a link in `skills/apps-ui/SKILL.md`.

## Settled decisions

### A local rule instead of `no-restricted-imports` blocks

Main already carries two warn-level direction rules from #1642 (`lib` → `*-core` and six two-way pairs), built from `@typescript-eslint/no-restricted-imports` patterns. Patterns cannot resolve `../` paths against the importing file, cannot say "any other `*-core` except these pairs" without one block per package, and give the report no structured from/to. A ~150-line local rule resolves `@/` and relative specifiers to the top-level `src/` folder, maps folders to layers, and reports with a fixed message prefix the report parses. It replaces both #1642 blocks; their warnings are a subset of the new ones except the allowlisted directions.

### Layer map

- **base:** `lib`, `types`, `assets`.
- **shell:** `wegotworkspace` only.
- **core:** every `*-core` folder.
- **primitive:** every other top-level folder.

The issue lists `workspace-shell` and `workspace-app` as shell. They are the layout frames every app renders into (`WorkspaceAppLayout`, `sidebar-breakpoint`, the detail footer): 20+ app files import them by design, and primitives such as `view-header` and `collection-sidebar` do too. Counting them as shell would report the intended structure. They are primitives here; the router and routes in `wegotworkspace` are the shell.

### `lib` may not import primitives either

The issue's four rules do not name `lib` → primitive, but its layering says lower layers never import higher ones. The rule follows the layering: `lib` → `share-ui`, `hooks`, `ui` and the like warn too (about 25 lines).

### Allowlist

A `*-core` → `*-core` import warns unless `CORE_ALLOWLIST` lists the one-way pair with a reason:

- `docs-core` → `drive-core`: Docs documents are Drive files; the Docs home reuses Drive's browser, lists and share dialog. The issue names this pair as a candidate.
- `calendar-core`, `docs-core`, `drive-core`, `meet-core`, `notes-core` → `text-editor-core`: the shared editor and collab layer those apps embed.
- `meet-core`, `notifications-core` → `presence-core`: the shared presence service.

`settings-core` (its settings footer, imported by eight apps) and `login-core` (the authentication page layout) are not allowlisted: they look like primitives that live in an app package, and the warnings mark them as move candidates for #1638.

### Scope of checked files

Tests (`*.test.*`, `__tests__/`) are not checked, as on main. Stories are, as on main since `bf9c7401a`. Root entry files (`main.tsx`, `sw.ts`) are not checked.

## Edge cases

- `@/ui` (a folder index) resolves to `ui`; `../styles.css` from a module resolves to a root file and is ignored.
- Dynamic `import()`, `export … from` and side-effect `import "…"` are checked.
- The report runs the rule with `reportAll`, so it also sees allowlisted and same-layer imports. That lets it count a two-way pair when one direction is allowed (for example `docs-core` ↔ `drive-core`).
