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

Scan **new or changed** `use*.ts(x)` files. Thresholds are handoff/merge blockers per [code-review/SKILL.md](../code-review/SKILL.md) — split or document an exception in the PR.

- [ ] **Hook body > ~200 lines** — extract sub-hooks or pure modules; orchestrator should wire concerns, not implement them.
- [ ] **> 4 `useEffect`s in one hook** — split by concern (sync, selection, draft, visibility, DOM listeners).
- [ ] **> 2 unrelated concerns in one hook** (e.g. Yjs + TipTap + DOM + draft lifecycle) — split; see [workspace/collab-hooks.md](../workspace/collab-hooks.md) for collab layout.
- [ ] **State + ref duplication** for the same value (stale-closure workaround) — refactor to a subscription helper or document why both are required.
- [ ] **DOM listeners in orchestrator hooks** — extract `use-*-pointer.ts`, `use-*-outside-click.ts`, or similar focused hooks.
- [ ] **`void foo` in dependency arrays** to force re-runs — require an explanatory comment or extract a subscription/effect helper.
- [ ] **Optional fields on one type serving two shapes** (e.g. draft vs persisted anchor) — prefer discriminated unions.
- [ ] **Test file line count ≫ orchestrator surface** — behavior may be covered but structure is untouchable; extract pure modules and test them directly ([testing/ui-architecture.md](../testing/ui-architecture.md)).

## Source file size

Counted trees are `packages/apps/src`, `tools/mcp-server/src`, and `packages/api/app`. A line is the same count the done-gate script uses, including a last line with no trailing newline. Tests, stories, declarations, mocks, fixtures, and `test-utils` are excluded by the script globs.

A new counted source file over 400 lines is a merge block unless its baseline entry carries an approved reason. A baselined file is a merge block when its line count grows, or when it shrinks and the stored integer was not lowered.

`pnpm ratchet:update` lowers a stored count or deletes a row that is now at or under 400 lines. It never raises a count and never adds a path. Adding a path is a manual edit with a reason in the third column. The existing hook limits below stay stricter for `use*.ts(x)`.

## Project-specific red flags

- [ ] Legacy PHP patterns in `packages/api` (see `api/SKILL.md` forbidden list)
- [ ] Inline `style={}` presets that should be CSS variables ([apps-ui](../apps-ui/SKILL.md))
- [ ] `window.location` or router calls inside workspace packages ([workspace](../workspace/SKILL.md))
