# Engineering tasks — Notes lean-first first download

**Not** a copy of the GitHub issue acceptance checklist. It tracks which agent/chunk implements which technical piece.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `notes-lean-server` (N1) | builder | api, security | `packages/api/app/Services/Jmap/Methods/NoteGetMethod.php`, `app/Services/Notes/NoteRepository.php`, `app/Services/Notes/Conversion/NoteJournalConverter.php`, `tests/Feature/Jmap/NoteProjectedGetTest.php` | `php scripts/done-gate.php` |
| `notes-lean-pass` (N2) | builder | workspace, testing | `src/lib/jmap-client/notes/JmapNotesClient.ts`, `src/lib/api/wgw/notes-vjournal.ts`, `src/lib/offline/notes/notes-offline-store.ts`, `notes-lean-first.test.ts` | `pnpm --dir packages/apps exec vitest run src/lib/jmap-client src/lib/offline/notes` |
| `notes-partial-rule` (N3) | builder | workspace, apps-ui, testing | `src/notes-core/src/notes-workspace.tsx`, `use-note-body-collab.ts`, `use-notes-controller.tsx`, `notes-pending-bodies.ts`, `src/lib/offline/notes/notes-list-preview-enrich.ts` | `pnpm --dir packages/apps exec vitest run src/notes-core src/lib/offline/notes` |
| `notes-detail-pass` (N4) | builder | workspace, testing | `src/lib/offline/notes/notes-detail-pass.ts`, `src/lib/offline/core/background-sync-pacer.ts`, `e2e/notes-detail-pass.spec.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline/notes src/lib/offline/core` |
| `notes-measure` (N5) | builder | testing, document | `packages/apps/e2e/traffic-budget.spec.ts`, `e2e/helpers/traffic-meter.ts`, `docs/realtime-capacity.md` | `WGW_TRAFFIC_MINUTES=3 pnpm --dir packages/apps exec playwright test --config playwright.traffic.config.mjs` |

## Notes

- Chunk ids match `plan.md`. N2 and N3 ship together; N4 after both.
- Reuse the marker, detail pass and page-cap code of PR #2340; build after it merges.
- On scope change: update #2284 first, then re-sync these files and the body-hash in `spec.md`.
