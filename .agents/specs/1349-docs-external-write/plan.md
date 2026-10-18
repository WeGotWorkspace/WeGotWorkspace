# Detect an external write on a Docs document

Derived from [spec.md](./spec.md). Two chunks, built in order by one agent.

## Goal

Replace the DAV write block on a collab `.md` with detection: a row links the sidecar to its markdown, the yjs read flags a mismatch, and Docs answers the flag the way Notes does.

## Budget

Draws from the `collab storage hardening` milestone. Displaces nothing.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- The client decision and rebuild are generic and already run for Docs. `path: packages/apps/src/text-editor-core/docs-collab/use-docs-collab-join.ts:236`
- Notes reads the flag and suppresses 304. `path: packages/api/app/Http/Controllers/Api/V1/Notes/NotesController.php:153`
- The Docs yjs read always allows 304. `path: packages/api/app/Http/Controllers/Api/V1/Files/FilesController.php:154`
- A DAV write clears the index hash. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:261`
- The block to remove. `path: packages/api/app/Dav/Server/WebdavWriteGuardPlugin.php:167`
- Sabre emits `beforeWriteContent` after ACL and preconditions. `path: packages/api/vendor/sabre/dav/lib/DAV/Server.php:1149`
- Sidecar move and delete on write routes only. `path: packages/api/app/Services/Jmap/FileNodes/FileNodeIndexService.php:356`
- Notes wires the same prompt. `path: packages/apps/src/note-detail-view/src/note-text-editor-body.tsx:110`

## Considered

- Compare with `jmap_file_nodes.content_sha256` (the issue's first idea) — rejected: a DAV write sets it to null, and reconciliation may rewrite it. Hashing the stored bytes is independent of the index.
- `unique('storage_key')` with a MySQL prefix — rejected: it refuses distinct keys that share the prefix. A sha256 key hash column is unique on every driver.
- Seed the row on the yjs read when it is missing — rejected: a GET with a write, and it would bless a markdown that may already have changed on disk. Seeding just before the DAV write is exact.
- Hook the row move in `CollabSidecarMover` — rejected: its unit test runs without a database, and `FileNodeIndexService::recordMoveWithSidecar` / `recordDeleteWithSidecar` are the write-route hooks the issue names.
- Record the pre-write row in the guard's `beforeMethod` hook — rejected: it runs before ACL and preconditions, so a refused write would still read the document and write a row.
- A separate Docs dialog — rejected: `DocsConflictDialog` takes labels and is non-dismissable without `onOpenChange`.

## Affected packages

- packages/api | packages/apps

## Dependencies

Chunk A (server) before chunk B (client conformance row relies on the header contract, not on chunk A's code).

## Open decisions

None — every choice for this work is made.

## Invariants

- The sidecar stays hidden and unwritable over DAV. Proof: `path: packages/api/tests/Feature/Dav/CollabSidecarDavTest.php` `test_put_on_the_sidecar_is_forbidden`, `test_propfind_hides_the_yjs_sidecar`.
- `MOVE` onto a document with a sidecar stays refused. Proof: `path: packages/api/tests/Feature/Dav/CollabSidecarDavTest.php` `test_move_onto_a_document_with_a_sidecar_is_forbidden`.
- Notes keeps its header and 304 suppression. Proof: `path: packages/api/tests/Feature/Notes/NotesYjsStateTest.php`.
- Nothing is saved while the prompt is up, also after a failed answer. Proof: `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-external-write-prompt.test.tsx` `keeps the prompt and the hold when saving the local version fails`.
- A refused DAV write leaves no row. Proof: `path: packages/api/tests/Feature/Collab/DocsCollabExternalWriteTest.php` `test_an_unauthorized_dav_put_leaves_no_row`, `test_a_dav_put_that_fails_its_precondition_leaves_no_row`.
- Chunk boundary: chunk B depends only on the `X-Wgw-External-Write` contract, not on chunk A's code. A renamed header breaks both apps. Proof: `path: packages/apps/src/text-editor-core/docs-collab/collab-app-conformance.test.ts` `an external writer changes the content`, and `path: packages/api/tests/Feature/Collab/DocsCollabExternalWriteTest.php` `test_markdown_changed_outside_sets_the_header_and_leaves_the_sidecar`.

## Chunks

### Chunk A: server detection

- **id:** `chunk-a-server`
- **Skill:** api
- **Inputs:** `DocCollabDocumentService::put()`, `FilesController::showCollaboration`, `FileNodeIndexService::recordMoveWithSidecar` / `recordDeleteWithSidecar`, `WebdavWriteGuardPlugin`, Sabre `beforeWriteContent` / `beforeCreateFile`
- **Done when:** the issue's server criteria have tests and pass
- **Verify with:** `cd packages/api && composer test -- --filter 'CollabSidecar|DocYjsState|FilesCollaboration|NotesYjsState'`, then `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk B: Docs client and conformance row

- **id:** `chunk-b-client`
- **Skill:** workspace
- **Inputs:** `docs-collab-workspace.tsx`, `use-docs-collab.ts` (`resolveExternalWrite`), `collab-app-conformance.test.ts`
- **Done when:** Docs shows the prompt with local work, rebuilds without it, and the seventh row runs for both apps
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab`, then `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] API: failing feature tests first (`DocsCollabExternalWriteTest`, inverted `CollabSidecarDavTest`), then implement, then `pnpm test:api-done-gate`
- [ ] UI: failing Vitest for the prompt hook and the conformance row, then implement, then `pnpm test:apps-done-gate`
