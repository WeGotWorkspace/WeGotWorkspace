# Engineering tasks — Refuse a Notes save when the note changed outside the app

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-server` | builder | api | `packages/api/app/Services/Notes/`, `packages/api/app/Http/Controllers/Api/V1/Notes/NotesController.php`, `packages/api/openapi/openapi.json` | `pnpm test:api-done-gate` |
| `chunk-b-client` | builder | workspace | `packages/apps/src/note-detail-view/src/`, `packages/apps/src/notes-core/src/notes-external-write-dialog.tsx`, `packages/apps/src/text-editor-core/docs-collab/` | `pnpm test:apps-done-gate` |

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update the issue first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
