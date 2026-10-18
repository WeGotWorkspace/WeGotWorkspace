# Engineering tasks — Offline storage keyed on document identity

**Not** a copy of the GitHub issue checklist.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `offline-cache-node-id` | builder | workspace | `packages/apps/src/lib/api/wgw/drive-jmap.ts`, `packages/apps/src/lib/offline/drive/drive-metadata-sync.ts`, `packages/apps/src/lib/offline/drive/drive-schema.ts`, `packages/apps/src/lib/offline/docs/docs-schema.ts` | `pnpm --dir packages/apps exec vitest run src/lib/offline/drive/drive-metadata-sync.test.ts src/lib/offline/drive/drive-node-id-upgrade.test.ts src/lib/api/wgw/drive.test.ts` |
| `docs-identity-db-key` | builder | workspace | `packages/apps/src/text-editor-core/docs-collab/docs-collab-persistence.ts`, `packages/apps/src/text-editor-core/docs-collab/use-docs-collab-join.ts`, `packages/apps/src/docs-core/src/use-docs-controller.tsx`, `packages/apps/src/lib/offline/docs/docs-hybrid-operations.ts` | `pnpm --dir packages/apps exec vitest run src/text-editor-core/docs-collab/docs-collab-persistence.test.ts src/lib/offline/notes/notes-collab-rooms.test.ts` |

## Notes

- Chunk ids match `plan.md`.
- On scope change: update issue #1363 first, then re-sync these files and the `Source:` body-hash.
