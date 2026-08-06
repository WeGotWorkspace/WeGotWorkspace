# Engineering tasks — Notes sharing via Drive path ACL

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `api-path-grants` | builder | api | `packages/api/app/Services/Drive/`, `packages/api/app/Services/Notes/`, OpenAPI, `tests/Feature/Notes/`, `tests/Feature/Drive/` | `pnpm test:api-done-gate` | done |
| `ensure-group-notes-dir` | builder | api | `AdminGroupManagementService`, `database/migrations/wgw/`, seed, group tests | targeted PHPUnit + `pnpm test:api-done-gate` | done |
| `share-ui-notes-mode` | builder | apps-ui | `packages/apps/src/share-ui/`, notes share wiring | Vitest / Storybook; `pnpm test:apps-done-gate` | done |
| `notes-sidebar-ui` | builder | workspace | `packages/apps/src/notes-core/`, sidebar model | Vitest / Storybook; `pnpm test:apps-done-gate` | done |
| `verify-notes-sharing` | verifier | testing | merged tree; Tasks #415–#418 | verify-issue + done gates | done |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Delivery issues: Epic #414; Tasks #415 (API), #416 (group `.notes`), #417 (share-ui), #418 (sidebar); Goal #412.
