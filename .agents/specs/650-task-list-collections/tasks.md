# Engineering tasks — Task lists match Calendar collection UX

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `setup` | builder (this phase) | developer, plan-feature, git-workflow | `.agents/specs/650-task-list-collections/` | `gh issue view` parents; body-hash `1a339013`; merge-base = origin/main | done |
| `api-sharewith` | builder (this phase) | api, testing | `packages/api/app/Services/Calendars/`, `packages/api/app/Services/Tasks/`, OpenAPI task-list schemas, `TasksTaskListsShareWithTest` | full calendar-share PHPUnit + Tasks share tests (not `pnpm test:api-done-gate`) | done |
| `caldav-share-interop` | builder (this phase) | api, testing | CalDAV sharing tests + shared trait | targeted PHPUnit (VTODO + existing VEVENT) | done |
| `shared-primitives` | later | apps-ui, workspace, storybook | `calendar-new-menu`, `calendar-sidebar-order`, `calendar-share-section`, `calendar-share.ts` | calendar Vitest/stories + primitive tests | done |
| `tasks-sidebar` | later | workspace, apps-ui, storybook | `tasks-core` sidebar, dialog, hybrid | Vitest + mock-tier stories (apps-done-gate in verify chunk) | done |
| `verify` | later | testing, verify-issue, code-review | merged A–D | `pnpm test:api-done-gate`, `pnpm test:apps-done-gate`, verify-issue | done |

## Notes

- Chunk B verified Sabre sharing is collection-level: CS:share / DAV:share-resource succeed on VTODO-only collections (no `supported-calendar-component-set` gate). Shared cases live in `CalDavCollectionSharingInterop`; VEVENT adapter is `CalendarsCalDavSharingTest`, VTODO adapter is `TasksCalDavSharingTest`.
- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **Task #650** first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- **Scope change:** Later in the same delivery we added Calendar-parity visibility toggles + persist (`tasks-view-prefs`). All Tasks (and other aggregate filters) exclude hidden lists. Row click navigates without changing visibility; only the checkbox toggles hide/show. Creating a task unhides the destination list (including Inbox when New task from All Tasks / time filters writes there). Sharee Remove/dismiss stays distinct from checkboxes. Re-hashed Source to `1a339013`.
- Branch `feat/task-list-collections` closes **#650**, not Goal #559. Goal Status stays **Adopted** until product marks Fulfilled.
