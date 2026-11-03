# Engineering tasks — Notifications and live updates

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | issue | owner / agent | skill | key paths | verify command |
|----|-------|---------------|-------|-----------|----------------|
| `chunk-server` | #1660 | builder | api | `packages/api/app/Http/Controllers/Api/V1/Jmap/`, `packages/api/app/Services/Jmap/`, `packages/api/app/Http/RateLimiting/`, `packages/api/openapi/openapi.json` | `pnpm test:api-done-gate` |
| `chunk-client` | #1661 | builder | workspace | `packages/apps/src/lib/jmap-client/`, `packages/apps/src/lib/offline/core/` | `pnpm test:apps-done-gate` |
| `chunk-mesh` | #1662 | builder | meet | `packages/apps/src/meet-core/src/meet-mesh-sot.ts`, `packages/apps/src/presence-core/src/presence-envelope.ts` | `pnpm --dir packages/apps exec vitest run src/meet-core src/presence-core` |
| `chunk-notes` | #1533 | builder | workspace | `packages/apps/src/notes-core/src/` | `pnpm --dir packages/apps exec vitest run src/notes-core` |
| `chunk-drive` | #1663 | builder | workspace | `packages/apps/src/lib/offline/drive/` | `pnpm --dir packages/apps exec vitest run src/lib/offline/drive` |
| `chunk-calendar` | #1664 | builder | workspace | `packages/apps/src/calendar-core/src/` | `pnpm --dir packages/apps exec vitest run src/calendar-core` |
| `chunk-tasks` | #1665 | builder | workspace | `packages/apps/src/tasks-core/src/` | `pnpm --dir packages/apps exec vitest run src/tasks-core` |
| `chunk-contacts` | #1666 | builder | workspace | `packages/apps/src/contacts-core/src/` | `pnpm --dir packages/apps exec vitest run src/contacts-core` |
| `chunk-chat` | #1667 | builder | meet | `packages/apps/src/meet-core/src/use-meet-chat-api.ts` | `pnpm --dir packages/apps exec vitest run src/meet-core` |
| `chunk-inbox` | #1668 | builder | workspace | `packages/apps/src/notifications-core/src/` | `pnpm --dir packages/apps exec vitest run src/notifications-core` |
| `chunk-toast` | #1669 | builder | apps-ui | `packages/apps/src/notifications-core/src/`, `packages/apps/src/ui/` | `pnpm test:apps-done-gate` |
| `chunk-metadata` | #1671 | builder | api | `packages/api/app/Services/Notes/`, `packages/api/app/Services/Calendars/`, `packages/api/app/Services/Tasks/`, `packages/api/app/Services/Contacts/` | `pnpm test:api-done-gate` |
| `chunk-verify` | — | verifier | code-review | all of the above | `pnpm run ci:quality` |

Related, outside this Epic: #1670 (urgent Web Push for `meet.started`) under #1600, after #1601, #1605, `chunk-server`, `chunk-inbox` and `chunk-toast`.

## Notes

- Chunk `id` values match `plan.md` chunk IDs and multitask handoff names.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
