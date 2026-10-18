# Refuse a Notes save when the note changed outside the app

Derived from [spec.md](./spec.md). Two chunks, built in order by one agent.

## Goal

Bring the #1380 save refusal to Notes without a Notes-only contract.

## Budget

Draws from the `notes hardening` milestone. Displaces nothing.

## Non-goals

See [spec.md](./spec.md#non-goals).

## What exists

- The Notes save checks only the state ETag. `path: packages/api/app/Services/Notes/NoteCollaborativeWrite.php:70`
- Content detection already exists for the read. `path: packages/api/app/Services/Notes/NoteYjsProjection.php:47`
- The shared refusal handling. `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-external-write-refusal.ts:1`
- The shared prompt hooks. `path: packages/apps/src/text-editor-core/docs-collab/use-docs-external-write-prompt.ts:1`
- Notes keeps its own prompt state and does not catch a failed answer. `path: packages/apps/src/note-detail-view/src/note-text-editor-body.tsx:110`

## Considered

- The VJOURNAL ETag as the acknowledgement — rejected: a tag, move, or archive while the dialog is up would ask again about the same text.
- A new response header for the content tag — rejected: no second header name. A JSON field on the existing Note representation carries it.
- Keep the Notes prompt state in `NoteCollabSession` and patch it — rejected: the shared hooks already hold the room scope, failed-answer, and question-chain rules from #1380.

## Affected packages

- packages/api | packages/apps

## Dependencies

Chunk A (server) before chunk B (the client reads `contentEtag`).

## Open decisions

None — every choice for this work is made.

## Invariants

- A metadata-only journal change does not refuse a save. Proof: `path: packages/api/tests/Feature/Notes/NotesCollabExternalWriteTest.php` `test_a_metadata_only_change_does_not_refuse_the_save`.
- No row keeps today's save. Proof: `path: packages/api/tests/Feature/Notes/NotesCollabExternalWriteTest.php` `test_a_save_without_a_state_row_is_not_refused`.
- Docs keeps the #1380 behavior. Proof: `path: packages/api/tests/Feature/Collab/DocsCollabExternalWriteTest.php`.
- Chunk boundary: the client depends on the 409 code and `contentEtag`, not on chunk A's code. Proof: `path: packages/apps/src/text-editor-core/docs-collab/collab-app-conformance.test.ts` `an external writer changes the content while the document is open`.

## Chunks

### Chunk A: server refusal

- **id:** `chunk-a-server`
- **Skill:** api
- **Inputs:** `NoteCollaborativeWrite::put()`, `NoteYjsProjection`, `NoteRepository::show()`
- **Done when:** the issue's API criteria have tests and pass
- **Verify with:** `cd packages/api && vendor/bin/phpunit -c phpunit.xml --filter 'NotesCollabExternalWriteTest|NotesYjsStateTest'`, then `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk B: Notes client and conformance row

- **id:** `chunk-b-client`
- **Skill:** workspace
- **Inputs:** `note-text-editor-body.tsx`, `notes-external-write-dialog.tsx`, `docs-collab-server-io.ts`, `collab-app-conformance.test.ts`
- **Done when:** the refusal reaches the Notes dialog, a failed answer keeps it, and the open-document row runs for Notes
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/note-detail-view src/text-editor-core/docs-collab`, then `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] API: failing feature tests first, then the refusal
- [ ] UI: failing Vitest for the Notes dialog and the conformance row, then the wiring
