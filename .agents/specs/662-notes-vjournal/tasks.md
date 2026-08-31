# Engineering tasks — Notes as CalDAV VJOURNAL notebooks

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `issues-arch-spec` | builder | document, issue-filing | `docs/architecture/notes.md`, `docs/architecture/tasks.md`, `.agents/specs/662-notes-vjournal/` | Goal #661 Identified on Product Project; Epic #662 hash `14483cc6`; Tasks #663–#669 | done |
| `isolation-provision` | builder | api | `UserCalendarCollectionsProvisioner`, `CalendarCollectionUris`, `Calendar` scopes, isolation migrator | targeted PHPUnit (event calendars no VJOURNAL; notebooks VJOURNAL-only) | done |
| `rest-converters-stars` | builder | api | OpenAPI `/notes/*`, `app/Services/Notes/`, stars migration, move helper | Notes feature tests (uid lookup, UNIQUE 409, cascade, move `/changes`, If-Match, 413) | done |
| `notebook-acl` | builder | api | `CalendarShareInvites`, Notes notebook `shareWith` | share/unshare PHPUnit matching Tasks | done |
| `collection-sidebar-shared` | builder | apps-ui, workspace | `packages/apps/src/collection-sidebar/` | already enough — architecture one-liner in notes.md Decision 16 | done |
| `apps-collab` | builder | workspace, apps-ui | `notes-core`, collab save, offline | Vitest dirty-reconnect + persist 403; mock stories | done |
| `migrate` | builder | api | notes migrator, path→UID map, stars join | fixture tree + starred path + group homes | done |
| `filenode-teardown` | builder | api, workspace | FileNode note projection, DocCollab note branch, `includeNotes` | architecture/route inventory; Docs collab unchanged | done |
| `verify` | later | testing, verify-issue | merged 1–6 | `pnpm test:api-done-gate`, `pnpm test:apps-done-gate` if feasible | pending |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs.
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **Epic #662** first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Branch `feat/notes-vjournal` closes **#662** (and child Tasks), not Goal #661. Goal Status stays **Identified** until product Adopts / marks Fulfilled.
- Do not edit the Cursor plan file.
