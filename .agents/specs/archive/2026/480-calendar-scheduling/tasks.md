# Engineering tasks — Calendar iTIP scheduling inbox

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `tasks-inbox-uri` | builder | api | `InboxTaskListProvisioner`, `CalendarCollectionUris`, Tasks tests, CalDAV home listing | `pnpm test:api-done-gate` | done |
| `rest-itip-local` | builder | api | `CalendarEventRepository`, Schedule/`ITip\Broker`, `tests/Feature/Calendars/` | `pnpm test:api-done-gate` | done |
| `scheduling-notifications-rest` | builder | api | `openapi/schemas/calendars/`, scheduling controllers/services, ACL tests | `pnpm test:api-done-gate` | done |
| `calendar-invitations-ui` | builder | workspace | `packages/apps/src/calendar-core/`, calendars offline outbox, stories | `pnpm test:apps-done-gate` | done |
| `verify-calendar-scheduling` | verifier | testing | merged tree; Tasks #482–#485 | verify-issue + done gates | pending |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names (`tools/worktree-agent.sh create <id>`).
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Delivery issues: Epic #480; Tasks #482 (uri), #483 (REST iTIP), #484 (notifications REST), #485 (UI); Goal #478.
- Sibling spec: [../481-calendar-imip/](../481-calendar-imip/spec.md) (do not implement on this Source).
