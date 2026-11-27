# Engineering tasks — Per-member sharing only on personal collections

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `api-rule` | builder | api | `packages/api/app/Services/Calendars/CalendarShareInvites.php`, `packages/api/app/Services/Contacts/AddressBookShareInvites.php`, `packages/api/app/Dav/Server/TeamGatedSharingPlugin.php`, `packages/api/openapi/openapi.json` | `composer done-gate` |
| `api-move` | builder | api | `packages/api/app/Services/{Calendars/CalendarRepository,Tasks/TaskListRepository,Notes/NotebookRepository,Chat/ChatChannelRepository}.php` | `composer done-gate` |
| `migration` | builder | api | `packages/api/database/migrations/wgw/` | `composer done-gate` |
| `ui-hide-section` | builder | apps-ui | `packages/apps/src/share-ui/`, `packages/apps/src/{calendar-core,meet-core,contacts-core,project-dialog}/` | `pnpm run ci:quality:apps` |
| `ui-move-confirm` | builder | apps-ui | `packages/apps/src/ui/owner-scope-field.tsx`, the owner confirm in the Calendar, Project and Meet dialogs, `packages/apps/src/lib/workspace/workspace-labels.ts` | `pnpm run ci:quality:apps` |
| `per-app-check` | verifier | testing | all of the above | per-app feature tests + browser run |

## Notes

- Chunk `id` values match `plan.md`.
- Order: `api-rule`, then `api-move` and `migration` and `ui-hide-section`, then `ui-move-confirm`, then `per-app-check`.
- Chunks blocked by an open question in `plan.md` do not start until the Epic records the answer.
- On scope change: update the issue first, then re-sync spec/plan/tasks and the `Source:` body-hash.
