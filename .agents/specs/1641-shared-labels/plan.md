# One shared label base (#1641 step b)

Derived from [spec.md](./spec.md). Sequential chunks, one commit each.

## Goal

One typed base of common UI strings plus one generic merge, with each app label file as a thin binding. Proven text-neutral by a snapshot of every resolved label bag.

## Budget

Draws from the Technical debt milestone (#1641). Displaces nothing user-facing.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- A seed base with four dialog strings, used only by Notes and Contacts. `path: packages/apps/src/lib/workspace/destructive-dialog.ts:8`
- Notes merges overrides with a shallow spread and returns the defaults when there are none. `path: packages/apps/src/notes-core/src/notes-labels.ts:285`
- Tasks, Calendar and Docs always spread, even without overrides. `path: packages/apps/src/tasks-core/src/tasks-labels.ts:350`
- Owner field copy is already shared by Tasks and Calendar. `path: packages/apps/src/ui/owner-scope-labels.ts:15`
- "No people or teams found" is already shared. `path: packages/apps/src/share-ui/share-labels.ts:7`
- 32 string values appear in three or more label files on `main` at `cdacba3da`; "Cancel" is in 8 files and "Delete" in 7. The baseline snapshot of every bag, taken before any label file changed: `path: packages/apps/src/lib/workspace/__snapshots__/workspace-labels.snapshot.test.ts.snap`

## Considered

- **Rename app keys to base keys and spread the base into each app type** (true type-level `extends`): rejected. It touches every callsite, story and `labels` override across seven apps, and collides with the four import/export sessions that add labels on `integration/import-export` tonight. The base still types every shared value, and each app type that already uses the base key names (Notes: `dialogCancel`, `dialogDelete`, `dialogDeleteConfirmSuffix`, `dialogPermanentDeleteLeadIn`) extends `WorkspaceDestructiveDialogLabels` directly.
- **Flat base keys**: rejected in favour of four nested groups (`dialog`, `sharing`, `sync`, `list`). The groups match the issue text and make a wrong pick visible at the callsite (`workspaceLabels.sync.pending`).
- **Move every repeated literal**: rejected for words whose meaning differs per use: "None" (alarm vs paper size vs phone label vs priority), "New" (tab vs button), "Today", "Location", and "Name" as a list column or contact-form section. Those stay local.
- **Unify near-duplicates** ("Add people or groups" vs "…" with ellipsis, "could not sync" vs "couldn’t sync", "Changes synced" vs others): rejected here because it changes visible text. Listed for the product lead in the PR.
- **Rename `destructive-dialog.ts`**: rejected. The new base lives in `workspace-labels.ts`; `destructive-dialog.ts` keeps its exports and derives them from the base, so existing imports keep working.
- **Snapshot via `toMatchSnapshot` vs a hand-written expected list**: snapshot chosen. It covers every key of every bag (about 1,400 values) with no hand copying, and CI fails on a missing or changed snapshot.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A (snapshot) lands first, on unchanged label files.
2. Chunk B (base) before any app chunk.
3. App chunks C1–C9 in any order, one commit each.
4. Chunk D (skill note) last.

## Open decisions

None — every choice for this work is made.

## Invariants

- Every resolved label string is byte-identical to `main`. A wrong change shows different copy in the UI. Proof: `path: packages/apps/src/lib/workspace/workspace-labels.snapshot.test.ts` assertion `resolved labels match the snapshot`.
- `mergeXLabels()` returns the defaults and `mergeXLabels(overrides)` applies the overrides on top. A wrong change drops a story or test override. Proof: `path: packages/apps/src/lib/workspace/workspace-labels.test.ts`.
- Types of `as const` bags keep literal types. Proof: `cmd: pnpm --dir packages/apps run typecheck`.

## Chunks

### Chunk A: label snapshot

- **id:** `chunk-a-snapshot`
- **Skill:** testing
- **Inputs:** every `*-labels.ts` export listed in [tasks.md](./tasks.md)
- **Done when:** the snapshot is committed on unchanged label files and passes.
- **Verify with:** `pnpm --dir packages/apps exec vitest run --project unit src/lib/workspace/workspace-labels.snapshot.test.ts`
- **Parallel with:** none

### Chunk B: shared base and generic merge

- **id:** `chunk-b-base`
- **Skill:** apps-ui
- **Inputs:** `path: packages/apps/src/lib/workspace/destructive-dialog.ts:8`
- **Done when:** `workspaceLabels` (dialog, sharing, sync, list) and `mergeWorkspaceLabels` exist with unit tests; `destructive-dialog.ts` derives from the base.
- **Verify with:** the unit tests above plus typecheck
- **Parallel with:** none

### Chunks C1–C9: one app per commit

- **ids:** `chunk-c-notes`, `chunk-c-contacts`, `chunk-c-tasks`, `chunk-c-calendar`, `chunk-c-docs`, `chunk-c-drive`, `chunk-c-meet`, `chunk-c-chat`, `chunk-c-share`
- **Skill:** apps-ui
- **Done when:** the app's repeated literals read from `workspaceLabels`, its merge function delegates to `mergeWorkspaceLabels`, and the snapshot is unchanged.
- **Verify with:** snapshot test, typecheck
- **Parallel with:** none (sequential commits)

### Chunk D: skill note

- **id:** `chunk-d-docs`
- **Skill:** document
- **Done when:** `.agents/skills/workspace/feature-blueprint.md` tells new apps to take common copy from `workspaceLabels` and merge with `mergeWorkspaceLabels`.

## Test plan

- [ ] Snapshot test green on every commit.
- [ ] Unit test for `mergeWorkspaceLabels` (no overrides, partial overrides, function override).
- [ ] Typecheck, lint, apps done gate.
- [ ] Browser smoke of every touched app on the PR head: open each app and check a dialog, the share dialog and the sidebar.
