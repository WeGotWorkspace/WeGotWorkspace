# Engineering tasks — Calendar iMIP and RSVP links

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `imip-rsvp` | builder | api | MailDelivery iMIP emitter, RSVP token/route, `UiStaticServer`, Calendar send-gating | `pnpm test:api-done-gate` | done |
| `verify-calendar-imip` | verifier | testing | merged tree; Task #486 | verify-issue + done gates | pending |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Delivery issues: Epic #481; Task #486; Goal #479.
- Prerequisite spec: [../480-calendar-scheduling/](../480-calendar-scheduling/spec.md) chunk `rest-itip-local`.
