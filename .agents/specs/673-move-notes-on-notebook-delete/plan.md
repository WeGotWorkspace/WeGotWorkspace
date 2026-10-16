# Move notes when deleting a notebook

Derived from [spec.md](./spec.md). One chunk. The GitHub implementation-plan comment on #673 fixed the decisions below.

## Goal

Server-side move of every VJOURNAL on notebook delete, and a client choice dialog when the plain delete returns 409 `notebookHasContents`.

## Budget

No separate budget. This chunk is the whole issue.

## Non-goals

See [spec.md](./spec.md). JMAP and MCP stay purge-or-409. No note count field.

## What exists

- Plain delete 409s when the notebook has any VJOURNAL, then purges with `onDestroyRemoveContents`. `path: packages/api/app/Services/Notes/NotebookRepository.php:217`
- Single-note move keeps object id, uid, and star foreign key. `path: packages/api/app/Services/Notes/NoteMoveHelper.php:22`
- The UI delete path always sends `{ kind: "purge" }`. `path: packages/apps/src/notes-core/src/use-notes-notebook-mutations.tsx:245`
- A second, unused client move loop matches notes by name and drops Dexie rows for every action kind. `path: packages/apps/src/lib/offline/notes-hybrid-operations.ts:620`

## Considered

Considered: a `POST …/move-notes` route — rejected because delete-time move is a parameter on the existing DELETE, same as `onDestroyRemoveContents`. Considered: a client note count — rejected because the sidebar filter hides archived notes the server still counts. Considered: a new dialog component — rejected in favor of optional props on `NotesChangeNotebookDialog`.

## Affected packages

- packages/api
- packages/apps
- packages/openapi-types

## Dependencies

Contract (OpenAPI + failing tests) → server and client implementation → typegen for the OpenAPI change on this branch. No other chunk's schema deletions.

## Open decisions

None — every choice for this work is made.

## Invariants

- A non-empty notebook still 409s without `moveNotesTo` or `onDestroyRemoveContents`. A wrong change purges or moves notes the caller did not ask to move. Proof: `path: packages/api/tests/Feature/Notes/NotesVjournalRestTest.php` assertion `test_delete_nonempty_notebook_requires_on_destroy_query_or_body`.
- Sharee delete still dismisses the share. Proof: `path: packages/api/tests/Feature/Notes/NotebookDeleteWithMoveTest.php` assertion `test_delete_with_move_dismisses_an_inbound_share_without_moving_anything`.
- Existing change-notebook dialog tests stay green with no new props. Proof: `path: packages/apps/src/notes-core/src/notes-change-notebook-dialog.test.tsx`.

## Chunks

### Chunk A: notebook delete move

- **id:** `notebook-delete-move`
- **Skill:** api, apps-ui, workspace, storybook, testing
- **Inputs:** implementation-plan comment on #673 — `cmd: gh issue view 673 --comments`
- **Done when:** PHPUnit `NotebookDeleteWithMoveTest` and the Vitest files named in the plan are green; Storybook `DeleteNotebookChoice` exists; smells scan on touched files; apps and API done gates pass or the file-size failure is only the planned shrink of `use-notes-mutations.tsx`
- **Verify with:** `composer test -- --filter NotebookDeleteWithMoveTest` in `packages/api`; Vitest on the notes delete, dialog, offline store, hybrid, and archive tests
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI `moveNotesTo` → failing `NotebookDeleteWithMoveTest` → implement → `composer done-gate`
- [ ] UI: dialog props, delete hook, Dexie move, hybrid move, `notes.ts` forwarding
- [ ] Storybook: `DeleteNotebookChoice` on the change-notebook dialog
