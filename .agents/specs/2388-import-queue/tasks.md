# Engineering tasks — One resumable import queue

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `server-import-job-vcard` | builder | api, security | `packages/api/app/Services/Import/`, `packages/api/app/Services/Jmap/Methods/Import*Method.php`, `packages/api/openapi/` | `pnpm test:api-done-gate` |
| `server-ics-adapters` | builder | api | `packages/api/app/Services/Import/Adapters/`, `packages/api/app/Services/VObject/` | `pnpm test:api-done-gate` |
| `client-import-queue-core` | builder | workspace, testing | `packages/apps/src/lib/offline/import/` | `pnpm --dir packages/apps exec vitest run src/lib/offline/import` |
| `import-ui-contacts` | builder | apps-ui, workspace, accessibility | `packages/apps/src/import-ui/`, `packages/apps/src/contacts-core/src/` | `pnpm test:apps-done-gate` + browser e2e |
| `calendar-tasks-client` | builder | workspace | `packages/apps/src/calendar-core/src/`, `packages/apps/src/tasks-core/src/` | `pnpm test:apps-done-gate` + browser e2e |
| `notes-on-queue` | builder | workspace | `packages/apps/src/notes-core/src/notes-markdown-import*.ts` | `pnpm --dir packages/apps exec vitest run src/notes-core` + browser e2e |
| `vcard-uid-seed` | builder | api | `packages/api/app/Services/Contacts/Conversion/` | `pnpm test:api-done-gate` |

## Notes

- Chunk `id` values match `plan.md` chunks A–G in order.
- `import-ui-contacts`, `calendar-tasks-client` and `notes-on-queue` change visible UI: they wait for the product lead's review before merge.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
