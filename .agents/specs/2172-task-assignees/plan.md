# Assign people to a task — plan

Source spec: [spec.md](./spec.md). Lines are pinned to `db6a4f161`.

## Goal

People who share a task list can put one or more teammates on a task. The assignee is stored as a VTODO `ATTENDEE`, so native clients that understand it keep working. The assignee is notified once in the app, sees the task in "Assigned to me" and shows on the task and in the list. One task change set is shared by REST, MCP and CalDAV writes. It is the base for Epic #2173's activity log.

## Budget

This draws from the Tasks Pioneer budget (Product#60 is Identified, with no milestone). It displaces nothing scheduled. It comes before Epic #2173, which needs the change set and the audience resolver.

## Non-goals

See spec.md, Non-goals.

## What exists

- **Participants on tasks.**
  - Reading: ORGANIZER becomes `participants.org` with role `owner`, and each ATTENDEE becomes a positional `att1`, `att2`… with role `attendee`. `path: packages/api/app/Services/Tasks/Conversion/TaskConversionSupport.php:284`
  - Writing: a role `owner` becomes ORGANIZER and every other participant becomes ATTENDEE. `path: packages/api/app/Services/Tasks/Conversion/TaskConversionSupport.php:321`
- **A patch merges `participants` entry by entry, and a `null` entry removes one.** With positional ids a removal shifts the other ids. `path: packages/api/app/Services/Tasks/Conversion/TaskConversionSupport.php:128`
- **The API accepts any `participants` array.** No check that a participant exists or can see the list. `path: packages/api/app/Http/Requests/Api/V1/TaskUpsertRequest.php:97`, `path: packages/api/app/Http/Requests/Api/V1/TaskPatchRequest.php:69`
- **The OpenAPI `TaskParticipant` schema exists.** `path: packages/api/openapi/schemas/tasks/task.json:58`
- **ATTENDEE parameters survive a title edit (#1406, via the in-place patch from #1392).** `path: packages/api/tests/Unit/Tasks/TaskRoundTripLossTest.php:91` (`test_rt_t5_participant_parameters_survive_a_title_edit`)
- **Participants written by CalDAV are readable over REST.** `path: packages/api/tests/Feature/Tasks/TasksCalDavInteropTest.php:314`
- **Who can see a list.**
  - Accessible instances are personal, Team or sharee instances, with the highest access per calendar. `path: packages/api/app/Services/Calendars/CalendarCollectionAccess.php:41`
  - Writes are gated by `assertCollectionWritable`. `path: packages/api/app/Services/Calendars/CalendarCollectionAccess.php:98`
- **Share grants of a list.** Grants that fail the Team rule are hidden. `path: packages/api/app/Services/Calendars/CalendarShareInvites.php:50`
- **There is no "everyone who can see this list" resolver.** The closest, `listAclOwnerUsernames`, covers owner rows and Team members only, with no sharees. It feeds #798's status notification. `path: packages/api/app/Services/Tasks/TaskRepository.php:533`
- **Team colleagues and the per-surface check table** (attendee picker and mentions use `isColleague`). `path: packages/api/app/Services/Teams/TeamColleagues.php:21`, `path: packages/api/app/Services/Teams/TeamColleagues.php:55`
- **Status-change notification (#798).**
  - It is built after every REST or MCP write. `path: packages/api/app/Services/Tasks/TaskRepository.php:491`
  - It is called at the end of `rewriteOwnedTask`. `path: packages/api/app/Services/Tasks/TaskRepository.php:318`
  - Tested. `path: packages/api/tests/Feature/Notify/TaskStatusChangedNotifyTest.php:31` (`test_sharee_status_change_notifies_owner_not_actor`)
- **Notifications pipeline.**
  - The allow-list. `path: packages/api/app/Events/NotifyListener.php:30`
  - The actor is skipped. `path: packages/api/app/Events/NotifyListener.php:57`
- **No iTIP or iMIP for VTODO.**
  - The app's scheduling handles VEVENT only. `path: packages/api/app/Services/Calendars/CalendarSchedulingService.php:72`
  - `WgwSchedulePlugin` overrides only free/busy. `path: packages/api/app/Dav/Server/WgwSchedulePlugin.php:20`
  - The vobject iTIP broker skips other components. `cmd: grep -n "VEVENT" packages/api/vendor/sabre/vobject/lib/ITip/Broker.php` (vendor copy, sabre/vobject 4.6.1 per `composer.lock`)
- **CalDAV write hooks.**
  - `EventDispatchPlugin` fires after a successful write method, with the path only (no content) and the actor. `path: packages/api/app/Dav/Server/EventDispatchPlugin.php:29`
  - `beforeWriteContent` and `beforeCreateFile` are already used by a plugin to look at the incoming body. `path: packages/api/app/Dav/Server/DocYjsStateDavPlugin.php:30`
  - Tested. `path: packages/api/tests/Feature/Events/EventDispatchWritePathTest.php`
- **The Tasks UI.**
  - Detail field rows. `path: packages/apps/src/tasks-core/src/tasks-detail-view.tsx:187`
  - Sidebar top items (All, Today, Upcoming, Overdue). `path: packages/apps/src/tasks-core/src/use-tasks-sidebar-model.tsx:58`
  - Views filter one cross-list task set (`list:` is a filter, not a fetch). `path: packages/apps/src/tasks-core/src/tasks-task-utils.ts:203`
- **No assignee UI exists.** The client's offline merge does **not** merge `participants` the way the server does. `applyTaskPatch` and `coalesceTaskPatches` replace the map whole, and only `alerts` merge per id. Two offline assigns would therefore coalesce into the last one. `path: packages/apps/src/lib/offline/tasks/tasks-patch-merge.ts:9`, `path: packages/apps/src/lib/offline/tasks/tasks-patch-merge.ts:32`
- **The task body for a move or replace copies `participants` as they are.** `path: packages/apps/src/lib/offline/tasks/tasks-patch-merge.ts:59`
- **Rescuing a parked task posts it anew with that body.** A failed create parks it again, so a rejected rescue fails on every retry. `path: packages/apps/src/lib/offline/tasks/tasks-parked-writes.ts:34`, `path: packages/apps/src/lib/offline/core/rescue-parked-writes.ts:78`
- **Cross-list views drop lists hidden in the sidebar, except on a list view.** `path: packages/apps/src/tasks-core/src/tasks-task-utils.test.ts:138`
- **A move is a write with a target list through the same rewrite path as an edit.** `path: packages/api/app/Services/Tasks/TaskRepository.php:245`, `path: packages/api/app/Services/Tasks/TaskRepository.php:349`
- **The principal search used by share dialogs searches colleagues, not a list audience.** `path: packages/apps/src/lib/models/tasks-types.ts:63`, `path: packages/apps/src/share-ui/share-principal-search-dropdown.tsx`
- **Apple Reminders keeps unknown properties on edit.** `path: packages/api/tests/Feature/Tasks/TaskInPlaceUpdateTest.php:34` (`test_title_edit_keeps_everything_else_reminders_wrote`)

## Considered

- **The existing component.** `participants`, already mapped to ATTENDEE, is the storage. A new `X-WGW-ASSIGNEE` property was rejected: native clients that show task attendees (Thunderbird, jtx Board) would not see it, and the converter already round-trips ATTENDEE.
- **Writing an ORGANIZER with the first assignment** was rejected. In clients that treat an organised item as an invitation, a non-organiser could not edit the task. And the server has no iTIP for VTODO to make the organiser mean anything.
- **Reusing `listAclOwnerUsernames` as the audience** was rejected. It leaves out sharees, and changing it would change #798's recipients. A new resolver is added. #798 keeps its function.
- **Allowing read-only viewers as assignees** was rejected. They cannot tick the task off. The Goal's "people who can see the list" is narrowed to "can edit the list" (decision to review, see Open decisions).
- **Notifying from `EventDispatchPlugin`** was rejected, because it has no before/after content. A separate observer plugin computes the change set. `EventDispatchPlugin` stays as it is.
- **A server-side "assigned to me" query** was rejected for now. The client already holds the cross-list task set that the Today and Overdue views use.

## Affected packages

- `packages/api`
- `packages/apps`
- `docs`

## Dependencies

1. Chunk A (audience, ids, validation) is first. B, C and D need its contract.
2. B (change set, notification, CalDAV observer) and C (detail UI) run in parallel after A.
3. D (Assigned to me) runs after A, in parallel with B and C. It touches different files from C.
4. E (interop and docs) runs after A and B.
5. V comes last.

## Open decisions

- [x] Assignees need write access to the list. Taken tonight without the product owner, so it is listed under "Decisions to review" in the PR; it only changes chunk A's validation and C's picker state.
- [x] No ORGANIZER is written. Also listed under "Decisions to review".
- [x] The members endpoint answers writers only and filters by the caller's Teams (#1915). This came from the review loop (2026-11-14): otherwise a person sharee would see the names and emails of a Team they are not in. It is the conservative choice and is listed for the product owner; it only changes chunk A.

## Invariants

- **#798's recipients do not change.** A status change still notifies the list owners or Team members (not sharees) and never the actor. A wrong change would start notifying sharees, or the actor. Proof: `path: packages/api/tests/Feature/Notify/TaskStatusChangedNotifyTest.php` assertions `test_sharee_status_change_notifies_owner_not_actor`, `test_owner_self_status_change_does_not_self_notify`.
- **ATTENDEE parameters and other clients' properties survive an edit from the web app, including an assign or unassign of another person.** A wrong change would drop RSVP or `SCHEDULE-AGENT`, or rewrite all ATTENDEE lines. Proof: `path: packages/api/tests/Unit/Tasks/TaskRoundTripLossTest.php` `test_rt_t5_participant_parameters_survive_a_title_edit`, plus a new `test_assigning_one_person_keeps_the_other_attendee_lines` in the same file (chunk A).
- **Apple Reminders' own properties survive.** Proof: `path: packages/api/tests/Feature/Tasks/TaskInPlaceUpdateTest.php` `test_title_edit_keeps_everything_else_reminders_wrote`.
- **A CalDAV write that fails or is not allowed produces no change set, no notification and no row.** A wrong change would leak a notification for a write that never happened, or read a document before authorization. Proof: `path: packages/api/tests/Feature/Tasks/TaskChangeObserverPluginTest.php` assertion `test_forbidden_caldav_put_on_read_only_list_notifies_nobody` (new in chunk B).
- **The members endpoint never lists people to someone who cannot see the list.** A wrong change would let anyone enumerate a Team's members by list id. Proof: `path: packages/api/tests/Feature/Tasks/TaskListMembersTest.php` assertion `test_members_of_unknown_or_hidden_list_is_404` (new in chunk A).
- **Only attendees a write adds are validated.** A full `PUT` that resends a stored `e:` attendee, a move to a list where an assignee has no access, and an edit of a task whose assignee lost access all succeed. A wrong change would make tasks with native-client attendees or former members impossible to edit or move. Proof: `path: packages/api/tests/Feature/Tasks/TaskAssigneeValidationTest.php` assertions `test_put_resending_an_existing_external_attendee_succeeds`, `test_move_keeps_assignees_without_access_in_the_target_list`, `test_adding_a_reader_or_outsider_is_422` (new in chunk A).
- **Rescuing a parked task never fails on its attendees.** A wrong change would park a task forever after its owner left the Team. Proof: `path: packages/apps/src/lib/offline/tasks/tasks-parked-writes.test.ts` assertion `rescue drops assignees the target list cannot hold` (new in chunk C), and `path: packages/api/tests/Feature/Tasks/TaskAssigneeValidationTest.php` assertion `test_create_with_external_attendee_succeeds` (new in chunk A).
- **Offline assigns and unassigns merge per person.** Two queued assigns keep both people, and an unassign removes only that person, in the queue and in the optimistic task. A wrong change would silently drop an assignee. Proof: `path: packages/apps/src/lib/offline/tasks/tasks-patch-merge.test.ts` assertion `coalesces participants per id like alerts` (new in chunk C).
- **After chunk A, main still works without B to E.** Existing tasks with attendees still read (now with `u:`/`e:` ids) and accept edits of other fields. Proof: `cmd: composer --working-dir packages/api test -- --filter 'Tasks|TaskRoundTrip|TaskInPlace'`.
- **After chunk B, CalDAV writes still succeed when the observer throws.** Proof: `path: packages/api/tests/Feature/Tasks/TaskChangeObserverPluginTest.php` assertion `test_observer_exception_does_not_fail_the_put` (new in chunk B).

## Chunks

### Chunk A: Audience, stable ids and validation
- **Skill:** api, security
- **Inputs:**
  - the participant read and write code (`TaskConversionSupport.php:284`, `:321`);
  - the patch merge (`TaskConversionSupport.php:128`);
  - the request rules (`TaskUpsertRequest.php:97`, `TaskPatchRequest.php:69`);
  - access (`CalendarCollectionAccess.php:41`);
  - grants (`CalendarShareInvites.php:50`);
  - Team members (`TaskRepository.php:533`, for the Team part only).
- **Done when:**
  - Participant ids are `u:<username>`, `e:<email>` or `org`.
  - `X-WGW-USERNAME` is written on assignees the app adds.
  - `TaskListAudience` exists with feature tests covering owner, Team list, person share, Team share, hidden grant and disabled user.
  - `GET /api/v1/tasks/tasklists/{id}/members` is in OpenAPI and tested, including the 404 for unknown or hidden lists.
  - REST and MCP reject a **newly added** assignee outside the target list's audience, or with read access only, with 422 `invalid_participant`. The added set is the merged result minus the stored task.
  - A move keeps assignees who lack access in the target list (200).
  - A full `PUT` that resends an existing `e:` attendee returns 200.
  - A REST create with an `e:` attendee whose address no account has returns 201. An `e:` id whose email belongs to a user is checked as that user.
  - For `u:` attendees the server writes `mailto:` and `CN` from the principal, whatever the payload says.
  - A patch with a positional `attN` key returns 422 `stale_participant_id`.
  - The members endpoint answers writers only (read-only callers get 403) and filters its list by the caller's Teams (#1915).
  - The invariant tests above pass.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** none

### Chunk B: Change set, `tasks.assigned` and the CalDAV observer
- **Skill:** api, security
- **Inputs:**
  - `notifyStatusChanged` (`TaskRepository.php:491`) and where it is called (`:318`);
  - the allow-list (`NotifyListener.php:30`);
  - the write hooks (`EventDispatchPlugin.php:29`, `DocYjsStateDavPlugin.php:30`);
  - the audience from chunk A.
- **Done when:**
  - `TaskChangeSet::between` has unit tests for every field in spec.md.
  - REST and MCP create, update, patch and delete compute it.
  - `TaskChangeObserverPlugin` computes it for CalDAV PUT and DELETE on task lists, after the write succeeds and never before.
  - `tasks.assigned` is delivered to newly added assignees in the audience, not to the actor. It is the same for REST and CalDAV.
  - The copy is in the PHP and TypeScript formatters.
  - The invariants for B pass.
- **Verify with:** `pnpm test:api-done-gate`
- **Parallel with:** C, D

### Chunk C: Assignees in the detail view and list rows
- **Skill:** apps-ui, workspace, accessibility
- **Inputs:**
  - the detail fields (`tasks-detail-view.tsx:187`);
  - the offline patch merge (`tasks-patch-merge.ts:9`, `:32`);
  - the members endpoint from chunk A.
- **Done when:**
  - An Assignees row with a picker limited to the audience, read-only people disabled, keyboard reachable and announced.
  - Avatars on list rows with "+N" and names on hover.
  - The audience is cached per list for offline use.
  - `rescueBody` drops `u:` attendees outside the target list's cached audience with write access, keeps only the person's own `u:` entry when nothing is cached, and keeps `e:` attendees. Vitest on `tasksRescueOperations`: rescuing a parked task that has a `u:` assignee without access to the target list and an `e:` attendee creates the task, with the `e:` attendee kept.
  - `applyTaskPatch` and `coalesceTaskPatches` merge `participants` per id, where a `null` entry removes one, the same as `alerts`. Vitest covers two queued assigns, an assign then an unassign, and the optimistic task.
  - Mock API, Storybook stories (empty, three assignees, no-access assignee, offline) and Vitest.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** B, D

### Chunk D: Assigned to me
- **Skill:** apps-ui
- **Inputs:**
  - the sidebar items (`use-tasks-sidebar-model.tsx:58`);
  - the view filter (`tasks-task-utils.ts:203`).
- **Done when:**
  - `state:assigned-to-me` is in the filter, matching by id `u:<me>` or by attendee email.
  - It leaves out done and cancelled tasks.
  - It ignores sidebar-hidden lists: it does not go through `filterTasksByHiddenLists`.
  - A sidebar item after Overdue, with a route and title.
  - Vitest on the filter.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** B, C

### Chunk E: Interop and docs
- **Skill:** testing, document
- **Inputs:**
  - the real-client fixtures (`packages/api/tests/fixtures/Interop/RealClients/README.md`);
  - the tasks architecture, property mapping (`docs/architecture/tasks.md:374`).
- **Done when:**
  - A Thunderbird-shaped VTODO with ORGANIZER and two ATTENDEEs reads as `org` + `u:`/`e:` ids and survives an assign from the web app.
  - An Apple Reminders fixture keeps the ATTENDEE that the web app wrote.
  - `docs/architecture/tasks.md` gets a "Decision 17 — Assignees" and an updated mapping row.
  - `docs/architecture/notifications.md` lists `tasks.assigned`.
- **Verify with:** `pnpm test:api-done-gate`, `pnpm run check:agent-docs`
- **Parallel with:** none (after A and B)

### Chunk V: Cross-chunk verify
- **Skill:** testing
- **Done when:**
  - The verifier, prompted from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md), returns `PASS` or `PASS_WITH_NITS`.
  - A two-user browser e2e on a Team list: A assigns B, B gets the notification, opens the task and sees it under "Assigned to me".
  - Then B leaves the Team: A sees B greyed, and B no longer sees the task.
  - A CalDAV PUT that adds B notifies B once.
  - **A live Playwright spec for offline assigning** (`packages/apps/e2e/tasks-assignees-offline.spec.ts`):
    - User A opens a Team list and goes offline, assigns B and then C on one task, and reloads while still offline. Both B and C show.
    - A goes back online. A second tab on A's account shows both B and C after sync.
    - A unassigns B in one tab, and the other tab drops B without a reload.

## Test plan

- [ ] API: OpenAPI first, then failing feature tests for the audience, validation, members endpoint, change set and observer, then the implementation, then `composer done-gate`.
- [ ] UI: mock-tier Storybook for the picker and list row, Vitest for the filter and the audience cache.
- [ ] Interop: a Thunderbird fixture and an Apple Reminders round trip.
- [ ] E2E: two users and one Team list (chunk V).

## Doc updates

- `docs/architecture/tasks.md`: Decision 17, the property mapping row, Known limitations ("assignees from native clients are not notified when they are not users here").
- `docs/architecture/notifications.md`: `tasks.assigned`.
