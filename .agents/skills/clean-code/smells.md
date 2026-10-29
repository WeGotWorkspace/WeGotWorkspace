# Code smells checklist

Use when reviewing diffs or before multitask chunk handoff. Not every item requires action — use judgment and domain skill constraints.

## Functions

- [ ] Too long (> ~20 lines worth of logic)
- [ ] More than 3 parameters
- [ ] Does more than one thing
- [ ] Mixes abstraction levels

## Names

- [ ] Unclear abbreviations
- [ ] Misleading names (does not match behavior)
- [ ] Magic numbers/strings without named constants

## Duplication

- [ ] Copy-pasted blocks (DRY violation)
- [ ] Long Tailwind strings in TSX or raw CSS properties where `@apply` belongs ([apps-ui](../apps-ui/SKILL.md))

Two CI checks block new copies (no warn-only phase):

- **Duplicate-code ratchet** (`pnpm check:duplicate-code`, runs in `ci:quality:apps`). [jscpd](https://github.com/kucherenko/jscpd) scans `packages/apps/src` (TypeScript/TSX) and `packages/api/app` (PHP) for exact copies of at least 70 tokens and 10 lines. It skips the files the file-size ratchet skips, plus `stories/`, `mock/`, `mocks/`, `tests/`, `__tests__/` folders and `*.fixtures.ts(x)`. `tools/duplicate-code-baseline.json` stores the clone count and duplicated-line total per scope. The check fails when either number grows. It also fails when a number drops and the baseline still holds the old value: run `pnpm duplicate-code:update` and commit the baseline in the same PR. `update` only lowers numbers. When the check fails, `pnpm duplicate-code:report` (optionally `-- --top 30`) prints the totals and the largest duplicated blocks as `file:start-end` pairs. Extract the shared code instead of copying it. Raising a number, changing the thresholds, or upgrading jscpd is a hand edit of the baseline that needs code-owner review.
- **DAV backend copies** (`DavBackendCopyAllowlistTest`, API Architecture suite). Only the listed classes may define `calBackend()` or `cardBackend()`. A new definition fails. A listed class that no longer defines the method also fails, so remove it from the list in the same PR. The list shrinks as [#1639](https://github.com/WeGotWorkspace/wegotworkspace/issues/1639) replaces the copies with one shared backend.

## Coupling

- [ ] Feature envy (method uses another module's data more than its own)
- [ ] Shotgun surgery (one change forces many files)
- [ ] Inappropriate intimacy (reaching into another module's internals)

## Dead code

- [ ] Unused imports, variables, functions
- [ ] Commented-out blocks

## Error handling

- [ ] Empty catch blocks
- [ ] Generic catch without context
- [ ] Error paths untested

## Tests

- [ ] Behavior change without test update
- [ ] Tests that mirror implementation detail instead of contract

## React hooks

Scan **new or changed** `use*.ts(x)` files.

**Checked by CI (merge blockers).** An exported `use*` hook in `packages/apps/src` with a body over 200 lines or more than 4 `useEffect` or `useLayoutEffect` calls is a merge block unless it is on the hook-size baseline. A baselined hook is a merge block when either number grows, or when it shrinks and the baseline was not lowered. `pnpm check:hook-size` (`tools/hook-size-ratchet.mjs`) measures each exported hook with the TypeScript compiler and runs in `ci:quality:apps`. Body lines count from the opening to the closing brace. After a split or a shrink, run `pnpm hook-ratchet:update`: it only lowers or deletes rows in `tools/hook-size-baseline.tsv`. Raising or adding a row needs code-owner review.

- [ ] **Hook body > 200 lines** — extract sub-hooks or pure modules; orchestrator should wire concerns, not implement them.
- [ ] **> 4 `useEffect`s in one hook** (`useLayoutEffect` counts too) — split by concern (sync, selection, draft, visibility, DOM listeners).

**Review prompts (not merge blockers).** No script can judge these. Raise them in review; the author splits or explains in the PR.

- [ ] **> 2 unrelated concerns in one hook** (e.g. Yjs + TipTap + DOM + draft lifecycle) — split; see [workspace/collab-hooks.md](../workspace/collab-hooks.md) for collab layout.
- [ ] **State + ref duplication** for the same value (stale-closure workaround) — refactor to a subscription helper or document why both are required.
- [ ] **DOM listeners in orchestrator hooks** — extract `use-*-pointer.ts`, `use-*-outside-click.ts`, or similar focused hooks.
- [ ] **`void foo` in dependency arrays** to force re-runs — require an explanatory comment or extract a subscription/effect helper.
- [ ] **Optional fields on one type serving two shapes** (e.g. draft vs persisted anchor) — prefer discriminated unions.
- [ ] **Test file line count ≫ orchestrator surface** — behavior may be covered but structure is untouchable; extract pure modules and test them directly ([testing/ui-architecture.md](../testing/ui-architecture.md)).

## Source file size

Counted trees are `packages/apps/src`, `tools/mcp-server/src`, and `packages/api/app`. A line is the same count the done-gate script uses, including a last line with no trailing newline. Tests, stories, declarations, mocks, fixtures, and `test-utils` are excluded by the script globs.

A new counted source file over 800 lines is a merge block unless its baseline entry carries an approved reason. A baselined file is a merge block when its line count grows, or when it shrinks and the stored integer was not lowered. Split by responsibility into injected classes with their own unit tests. Traits that exist only to get a file under 800 lines are not a split.

`pnpm ratchet:update` lowers a stored count or deletes a row that is now at or under 800 lines. It never raises a count and never adds a path. Adding a path is a manual edit with a reason in the third column. `pnpm ratchet:rebaseline` refreshes existing baseline counts after integrating main (may raise); do not use it on a feature PR to excuse growth. CI `check-growth` warns when a count rises or a new baseline row appears versus the PR base; raising the baseline requires code-owner review of `tools/file-size-baseline.tsv`. The existing hook limits below stay stricter for `use*.ts(x)`.

## Project-specific red flags

- [ ] Legacy PHP patterns in `packages/api` (see `api/SKILL.md` forbidden list)
- [ ] Inline `style={}` presets that should be CSS variables ([apps-ui](../apps-ui/SKILL.md))
- [ ] `window.location` or router calls inside workspace packages ([workspace](../workspace/SKILL.md)); ESLint blocks them in `*-workspace.tsx` and `use-*-controller.ts(x)` (`workspaceNavigationRules` in [`packages/apps/eslint.config.js`](../../../packages/apps/eslint.config.js))
