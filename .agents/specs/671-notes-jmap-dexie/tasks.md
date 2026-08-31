# Engineering tasks — Notes JMAP + Dexie

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-a-stop-rebase` | builder | workspace | `notes-app.tsx`, `use-hybrid-bootstrap.ts`, `notes-note-utils.ts`, `use-notes-mutations.tsx` | `pnpm --dir packages/apps exec vitest run src/notes-core src/lib/offline/core` | done |
| `chunk-b-rest-inbound` | builder | workspace | `notes-jmap-inbound.ts`, `notes-inbound-sync.ts`, `use-notes-api.ts`, `notes-offline-store.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline/notes src/notes-core/src/use-notes-api` | done (fallback / reconnect) |
| `chunk-c-body-dexie` | builder | workspace | `notes-body-sync.ts`, `notes-list-preview-enrich.ts`, `use-notes-pending-sync.ts`, `notes-app.tsx` | `pnpm --dir packages/apps exec vitest run src/lib/offline/notes src/notes-core/src/use-notes-pending-sync` | done |
| `chunk-d-jmap-envelope` | builder | api | `JmapMethodDispatcher.php`, `NotesCapabilityProvider`, `Note*Method.php` | `composer --working-dir packages/api test --filter=JmapNotes` | done |
| `chunk-e-app-jmap` | builder | workspace | `JmapNotesAdapter`, `notes-jmap.ts`, offline-platform.md, notes.md | adapter unit tests | done |
| `chunk-v-verify` | verifier | code-review | touched files | apps + api done gates | in progress |

## Notes

- Chunk ids match plan.md.
- Live inbound is `POST /jmap`. REST `/changes` is not the poll path.
