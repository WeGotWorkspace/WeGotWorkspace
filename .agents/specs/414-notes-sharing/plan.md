# Notes sharing via Drive path ACL

Derived from [spec.md](./spec.md).

## Goal

Path-ACL **single-note** sharing (view/edit), group `.notes` homes, Notes-mode ShareDialog, Shared with me + group notebooks under Notebooks — closing Epic #414 under Goal #412.

## Non-goals

- Sharing whole personal notebooks via directory ACL
- Guest/public links, comment ACL, Drive-visible `.notes`, vault sharing, `notes_shares` table

## Affected packages

- packages/api | packages/apps

## Dependencies

1. Chunks **A** and **A2** may run in parallel (disjoint domains: share/auth vs group provisioning).
2. Chunks **B** and **C** after A contracts are clear (OpenAPI / listing shapes); B ∥ C once share create + listing endpoints exist or are stubbed.
3. Chunk **V** after A/A2/B/C merge.

## Chunks

### Chunk A: API path grants + collab guards

- **id:** `api-path-grants`
- **Skill:** api, testing
- **Inputs:** `DriveShareService`, `DriveShareAccess`, Notes/collab auth, OpenAPI, Epic slices / Task #415
- **Done when:** Note-file shares view/edit; notebook-dir share create rejected; comment/full rejected; mayComment/mayReview/mayManageStructure false on note grants; Notes/collab grant-aware; Drive SWM excludes `.notes`; Notes shared-with-me listing; OpenAPI + feature tests green
- **Verify with:** `pnpm test:api-done-gate` (or targeted Notes/Drive share feature tests then done-gate)
- **Parallel with:** `ensure-group-notes-dir`

### Chunk A2: Group `.notes` homes + migration

- **id:** `ensure-group-notes-dir`
- **Skill:** api, testing
- **Inputs:** `AdminGroupManagementService`, installer seed, wgw migration pattern, Task #416
- **Done when:** create/seed ensures `.notes`; migration one-level walk + skip-if-exists; tests prove second run no-op; Drive still hides `.notes`
- **Verify with:** targeted PHPUnit + `pnpm test:api-done-gate`
- **Parallel with:** `api-path-grants`

### Chunk B: share-ui Notes mode

- **id:** `share-ui-notes-mode`
- **Skill:** apps-ui, workspace, storybook
- **Inputs:** `packages/apps/src/share-ui/`, Task #417; A OpenAPI for note paths
- **Done when:** Notes ShareDialog team-only, view/edit; Share wired on **single notes** only; Vitest/Storybook mock-tier
- **Verify with:** targeted Vitest / Storybook; later `pnpm test:apps-done-gate`
- **Parallel with:** `notes-sidebar-ui` (after A listing contracts)

### Chunk C: Notes sidebar Shared with me + group notebooks

- **id:** `notes-sidebar-ui`
- **Skill:** workspace, apps-ui, testing
- **Inputs:** `use-notes-sidebar-model.tsx`, Notes shared listings from A, Task #418
- **Done when:** Shared with me (files only); group notebooks under Notebooks (Users icon); open shared notes under rights; Vitest/Storybook coverage
- **Verify with:** targeted Vitest / Storybook; later `pnpm test:apps-done-gate`
- **Parallel with:** `share-ui-notes-mode`

### Chunk V: Verify

- **id:** `verify-notes-sharing`
- **Skill:** testing, verify-issue, code-review
- **Inputs:** merged A–C; Tasks #415–#418 AC
- **Done when:** verify-issue PASS on delivery tasks/epic; done gates green; smells scan on touched files
- **Verify with:** `pnpm test:api-done-gate`, `pnpm test:apps-done-gate`, verify-issue
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI → feature tests (comment reject, note-file share, notebook-dir reject, Drive SWM filter, Notes SWM, group `.notes` migration) → `pnpm test:api-done-gate`
- [ ] UI: Notes ShareDialog mock-tier + sidebar Vitest → `pnpm test:apps-done-gate`
- [ ] verify-issue against #415–#418 / #414

## Doc updates (only if user wants)

- None required unless OpenAPI/docs inventory already expects an inventory touch for new Notes listing paths
