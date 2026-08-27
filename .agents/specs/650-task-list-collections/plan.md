# Task lists match Calendar collection UX

Derived from [spec.md](./spec.md). Chunk layout matches the Cursor plan `tasks_calendar_ux_367b1c10` (source of truth).

## Goal

Align Tasks list UX with Calendar. Technically a task list is the same CalDAV collection (VTODO-only). One shared collection-ACL layer; Tasks stays REST (no JMAP `TaskList/set`). UX forks: All Tasks default, Inbox role; visibility checkboxes match Calendar. Product context: Goal #559 / Epic #649 / Task #650.

**Scope change:** Later in the same delivery we added Calendar-parity visibility toggles + persist. This plan was updated to match. Sharee Remove/dismiss stays distinct from checkboxes.

## Non-goals

- Sharee Remove (dismiss inbound share) is in scope and is a different mechanism from visibility checkboxes
- Today / Upcoming / Overdue / Status / Priority filter changes
- ICS subscribe/publish for task lists
- Delete-list UI
- Sharing a single task; guest links (#388); assignee Goal #563
- Contacts/Notes sidebar rewrite
- JMAP `TaskList/set`; merging `TaskListRepository` into `CalendarRepository`
- Reopening #157; auto-closing Goal #559

## Affected packages

- packages/api | packages/apps | docs

## Dependencies

1. **setup** first — Goal #559 Adopted (no v0.9); Epic + Task filed; `feat/task-list-collections` from `origin/main`; spec/plan/tasks with body-hash.
2. **api-sharewith (A)** before B and C — extract collection-ACL, migrate Calendar, then Tasks REST.
3. **caldav-share-interop (B)** after A; may run **parallel with C**.
4. **shared-primitives (C)** after A; Calendar migrates onto extract.
5. **tasks-sidebar (D)** after A + C.
6. **verify (V)** after A–D merge.

## Chunks

### Chunk 0: Setup

- **id:** `setup`
- **Skill:** developer, plan-feature, git-workflow
- **Inputs:** Goal #559
- **Done when:** #559 Adopted (no v0.9 milestone); Epic + Task filed under #559 with AC from the Cursor plan; `git fetch origin` then `feat/task-list-collections` created from **origin/main** (not the current calendar branch / dirty tree); `.agents/specs/<N>-task-list-collections/{spec,plan,tasks}.md` with `Source: #<Task> (body-hash: …)` and `Goal: #559`
- **Verify with:** `gh issue view` parent links; spec header hash; `git merge-base feat/task-list-collections origin/main` equals `origin/main` HEAD at branch time
- **Parallel with:** none

### Chunk A: Shared collection ACL + Tasks REST

- **id:** `api-sharewith`
- **Skill:** api, testing
- **Inputs:** `CalendarRepository.php`, `TaskListRepository.php`, `TaskRepository.php`, `CalendarShareInvites`, `CalendarShareVisibility`, OpenAPI task-list schemas
- **First step (confirm before extract):** Open the Calendar repository/share files and record actual method names and signatures (plan snapshot: `accessibleVeventInstances`, `preferHighestAccessPerCalendar`, `assertEventWritable`, sharee update/delete). Confirm dismiss columns. Then **extract** those real methods into a shared helper and **migrate Calendar onto them**. Only then call the same helper from Tasks with `vtodoOnly()` as `componentQuery`.
- **Anti-pattern:** a second copy of list-inbound-sharees / sharee name-color / dismiss-on-delete / `assertWritable` inside `TaskListRepository` or `TaskRepository`.
- **Done when:**
  - Calendar still lists/shares/dismisses via the extract (no behavior change)
  - **Full** existing calendar-share PHPUnit suite is green after the extract — not only files you touched. Minimum: `CalendarsShareWithTest.php`, `CalendarsCalDavSharingTest.php`, `CalendarsSharedCalendarsTest.php`, and JMAP `shareWith` cases in `JmapCalendarMethodsTest.php`. This path landed 2026-08-25 (#403 / #606); treat it as newly stabilized, not battle-tested.
  - Short **manual smoke** on Calendar after extract: owner shares a calendar → second user sees it under Shared with me → read cannot edit an event → revoke hides it. Do this before wiring Tasks.
  - Owner can share a personal list (including Inbox) or a group list they manage with a user or `groups/{slug}` at read or write — via REST `PATCH` `shareWith`, same `CalendarShareInvites::apply`
  - Recipient `GET /tasks/tasklists` uses the shared lister; inbound instance has `shareWith: null`, live `myRights`; **shared Inbox has `role` not inbox and `isDefault: false`**
  - Recipient’s own Inbox remains `role: inbox` / `isDefault: true`
  - `TaskRepository` mutations go through shared `assertCollectionWritable` (same `isReadOnly` as Calendar). Read ACL (`access === 2`) cannot mutate tasks — including a list shared read-only with a group. Provisioned group-collection members keep Calendar’s current access (SHAREDOWNER ⇒ write). No new “group members always write” rule.
  - Sharee PATCH/DELETE on lists uses the same sharee rules as calendars (name/color only; delete = dismiss)
  - Group member who is not a manager still sees the group list (not as inbound share)
  - Inbox still not deletable; old `shareWith: null` / prohibited-PATCH tests updated
- **Verify with:** full calendar-share PHPUnit list above + Calendar smoke; then failing Tasks tests (`TasksTaskListsShareWithTest`, including shared-Inbox-is-not-recipient-default and read-group-share cannot write). Do **not** run `pnpm test:api-done-gate` in this chunk (later verify chunk).
- **Parallel with:** none — **A before B and C**

### Chunk B: CalDAV interop

- **id:** `caldav-share-interop`
- **Skill:** api, testing
- **Inputs:** Chunk A
- **Assumption to verify, not treat as given:** Sabre’s sharing plugin is collection-level and does not gate on `supported-calendar-component-set` (VEVENT vs VTODO). If a test shows it does, stop and document — do not paper over it. Many CalDAV **clients** have no “share task list” UI even when the server accepts the grant; this chunk is **server** interop only.
- **Done when:** REST share on a VTODO collection is visible over CalDAV invite; inbound `CS:share` / `DAV:share-resource` maps to REST `shareWith`; revoke both ways; read-only CalDAV PUT denied. Prefer a **shared test helper/trait** with `CalendarsCalDavSharingTest.php` (collection uri / component set as parameters) over a pasted second class.
- **Verify with:** targeted PHPUnit (VTODO cases + existing VEVENT cases still pass)
- **Parallel with:** `shared-primitives` (after A)

### Chunk C: Shared primitives + Calendar migration

- **id:** `shared-primitives`
- **Skill:** apps-ui, workspace, storybook
- **Inputs:** Calendar New menu, sidebar rows, `CalendarShareSection`
- **Done when:**
  - Shared segmented New, partition helper (`isSharee` + optional predicates), collection row, generic share section exist
  - `calendar-share.ts` helpers live in one module; Calendar and Tasks import them — no `task-share.ts` fork
  - Principal search is the existing live helper (or a rename-neutral wrapper); Tasks does not add a second search API
  - Row contract: `onToggleVisibility` (optional) and `onSelect` (optional) are **independent**. Calendar wires checkbox → visibility, row → create-target only (no route change). Tasks wires checkbox → visibility and `onSelect` → navigate. A Calendar row click must **not** start navigating or toggling visibility
  - Partition helper does not require `subscriptionId`; Calendar passes that predicate, Tasks does not
  - Share section copy is **injected** (title, hint, placeholder, empty, offline). Calendar keeps current “Team access” strings; no leftover “calendar” microcopy inside the generic component
  - **Calendar workspace uses them** with no visual/behavior regression (checkboxes still hide events; row still sets create-target; My/Shared unchanged; New menu items unchanged)
- **Verify with:** existing calendar Vitest/stories plus a focused test that Calendar row click ≠ checkbox and does not change the URL; new primitive tests; calendar-share helper tests still pass after the move
- **Parallel with:** `caldav-share-interop` (after A)

### Chunk D: Tasks sidebar + list dialog

- **id:** `tasks-sidebar`
- **Skill:** workspace, apps-ui, storybook
- **Inputs:** Chunk C primitives; Chunk A list payload (`mayShare`, `shareWith`, `isSharee` / `isDefault` / `role`)
- **Done when:**
  - Default view is All Tasks (`DEFAULT_TASKS_VIEW = state:all`); `/tasks` → `/tasks/state/all`
  - Inbox is a My lists row (color dot, not Inbox icon); name/color editable via per-row pencil
  - No Lists `+`; Add list is under segmented New
  - My lists vs Shared with me uses `isSharee`; group member (not manager) stays in My lists
  - Shared Inbox at the recipient is under Shared with me and is **not** `defaultTaskListId`; new tasks from All Tasks / time filters still go to the recipient’s own Inbox
  - List rows use `CollectionSidebarRow` visibility checkboxes (`onToggleVisibility` independent of `onSelect`); hidden list IDs persist (`tasks-view-prefs` / same pattern as calendar hidden IDs)
  - All Tasks and other aggregate filters (Today, Upcoming, Overdue, Status, Priority) exclude tasks from hidden lists; row click still navigates to that list without changing visibility; only the checkbox toggles hide/show; creating a task unhides the destination list (including Inbox when New task from All Tasks / time filters writes there)
  - Edit dialog hosts share section for `mayShare` with **list** copy (not calendar strings); sharees can rename/recolor; view-only cannot create/edit/complete/delete tasks
  - Sharee Remove dismisses the list without deleting the owner collection (distinct from visibility checkboxes)
  - Inbox identified by owned `role`/uri, not name
  - Hybrid: `shareWith` is online-only using the **same rule** as calendars-hybrid (refuse offline grants). A queued **task item** mutation that later gets `403` because the share was revoked or demoted to read-only must fail like other outbox errors — existing Tasks outbox 403/conflict path, no second grant-outbox
- **Verify with:** Vitest on sidebar model (group-member-not-manager → My lists; shared Inbox ≠ default), routes, project mutations, dialog, outbox 403 after revoke; mock-tier Tasks stories; then `pnpm test:apps-done-gate`
- **Parallel with:** none (after A + C)

### Chunk V: Verify

- **id:** `verify`
- **Skill:** testing, verify-issue, code-review
- **Inputs:** merged A–D; Task AC; Goal #559 success signals
- **Done when:** verify-issue PASS on the delivery Task; #559 success signals evidenced (do not auto-close the Goal); smells scan; both done gates green
- **Verify with:** `pnpm test:api-done-gate`, `pnpm test:apps-done-gate`, verify-issue
- **Parallel with:** none

## Test plan

- [ ] API: confirm method names → extract collection-ACL from CalendarRepository → **full** calendar-share PHPUnit + Calendar share smoke → OpenAPI + failing Tasks share tests → implement (Chunk A does not run `pnpm test:api-done-gate`)
- [ ] API extra: share Inbox → recipient list payload has `isDefault: false` and `role` ≠ inbox; recipient own Inbox still default; group member not manager still listed as group scope
- [ ] UI: mock-tier Tasks + Calendar stories; Vitest for rename-safe owned inbox, `state:all` default, `isSharee` partition, hidden-list filter on All Tasks, Calendar row-click ≠ checkbox / no navigation, New menu
- [ ] Browser when implementing UI: All Tasks landing → create task lands in **own** Inbox → toggle a list off and confirm All Tasks hides its tasks → rename Inbox → share Inbox to a second user → they see Shared with me → their New task still hits **their** Inbox → read cannot complete → write can → revoke hides without full reload

## Doc updates

Flip the task-list `shareWith` stub in both:

- `packages/api/docs/contacts/jmap-collection-crud.md` — shared #157 collection-CRUD status table (contacts + calendars + task lists)
- `packages/api/docs/tasks/jmap-tasks-summary.md` — Tasks-owned summary; update if it still says sharing is stubbed

Do not add new docs.
