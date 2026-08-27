Source: #650 (body-hash: 0c3c549b)
Goal: #559

# Task lists match Calendar collection UX

Technical translation of Task #650. Product context: Goal #559 (share a task list read/read-write from the browser). Delivery parent: Epic #649.

**Scope change:** Later in the same delivery we added Calendar-parity visibility toggles + persist. This spec was updated to match Task #650. Sharee Remove/dismiss stays distinct from checkboxes.

## Goal

A task list is the same CalDAV collection as a calendar (`calendars` + `calendarinstances`) with `VTODO` only. Extract one shared collection-ACL layer from Calendar; Calendar keeps using the extract (no behavior change). Tasks stays REST (`PATCH /tasks/tasklists/{id}` `shareWith`) — no JMAP `TaskList/set`. Inbox `role` / `isDefault` apply only to the viewer’s owned personal Inbox (`!isSharee`). Recipients see inbound ACL under Shared with me. Item write is `!isReadOnly` (same as Calendar). UX chrome (All Tasks default, My lists / Shared with me, segmented Add list, Calendar-parity visibility checkboxes) lands in later chunks.

## Non-goals

- Sharee Remove (dismiss) is in scope and is a different mechanism from visibility checkboxes
- Today / Upcoming / Overdue / Status / Priority filter changes
- ICS subscribe/publish for task lists
- Delete-list UI (API already exists)
- Sharing a single task; guest links (#388); assignee Goal #563
- Implementing the new sidebar in Contacts or Notes
- JMAP `TaskList/set`
- Merging `TaskListRepository` into `CalendarRepository`
- Reopening #157; marking Goal #559 Fulfilled from this PR alone

## Affected packages

- `packages/api` — shared collection-ACL extract from `CalendarRepository`; Tasks REST `shareWith` / `mayShare`; OpenAPI `TaskList` / `TaskListPatch` / `TaskListRights`; `TaskRepository` writable via extract; calendar-share PHPUnit stays green
- `packages/apps` — shared segmented New, sidebar partition/row, share-ui section, share helpers, principal search (Chunks C/D; Calendar migrates onto them)
- `packages/api/docs` — flip task-list `shareWith` stub in `jmap-collection-crud.md` and `jmap-tasks-summary.md` (verify chunk / after A)

## Technical constraints

- **One collection-ACL layer.** Extract from Calendar; both repositories call it. Do not copy list-inbound-sharees / sharee name-color / dismiss-on-delete / `assertWritable` into `TaskListRepository` or `TaskRepository`.
- **Confirm before extract.** Plan snapshot names (`accessibleVeventInstances`, `preferHighestAccessPerCalendar`, `assertEventWritable`, …) may be wrong. Open the files; extract follows the repo.
- `accessibleInstances($username, $componentQuery)` — Calendar passes `supportsVevent()`; Tasks passes `vtodoOnly()`.
- Dismiss table `calendar_share_dismissals` is `username` + `calendarid` with no component-set FK. Reuse it. If a future constraint filters component-set, stop and add a generic dismiss store.
- `CalendarShareInvites` already owns `getInvites` / `updateInvites`, `canShare`, `isSharee`, `isReadOnly`. Neutralize calendar-only copy. Tasks reaches invites only through the extract.
- **Inbox is owner-instance only.** `role: inbox` and `isDefault: true` only when `!isSharee`, personal principal, uri `tasks-inbox`. Shared Inbox: `role` not inbox, `isDefault: false`, `isSharee` / `mayShare: false`.
- **Shared with me = inbound ACL** (`isSharee` / access 2 or 3), not `mayShare === false`. Group member who is not a manager stays in My lists.
- **Rights follow Calendar.** Item write is `!isReadOnly`. Provisioned group-collection members keep `ACCESS_SHAREDOWNER`. An inbound read ACL (`access === 2`) cannot mutate items — including a personal list shared read-only with a group. No “group members always write.”
- Sharee PATCH: name/color only; reject `shareWith` / description. Sharee DELETE: dismiss, not destroy. Inbox: PATCH name/color/shareWith allowed; DELETE still forbidden.
- Wire stays different: Calendar JMAP `Calendar/set`; Tasks REST. OpenAPI: `shareWith` on `TaskListPatch`, `mayShare` on `TaskListRights`; lift prohibited in `TaskListPatchRequest`.
- Do not invent a second invites class, dismiss table, `searchTaskSharePrincipals`, second `mergeShareWith` / rights mapper, or second hybrid share-outbox.
- Tasks list rows use the same `CollectionSidebarRow` visibility checkbox as Calendar (`onToggleVisibility` independent of `onSelect`). Hidden IDs persist like Calendar. Sharee dismiss is not checkbox state.

## Edge cases

- Sharing an owned list (including Inbox) with a group you belong to must not list a second inbound copy — owner instance wins (`preferHighestAccess`).
- Recipient `GET /tasks/tasklists`: inbound instance has `shareWith: null`, live `myRights`; shared Inbox is not recipient default.
- Recipient’s own Inbox remains `role: inbox` / `isDefault: true`.
- Read ACL to a group cannot mutate tasks; provisioned group-collection members keep Calendar’s current write access.
- Group member, not manager → listed as group scope (My lists), not inbound share.
- Sabre auto-accepts invites — no accept/reject UI; dismiss is visibility only.
- Offline outbox: queued task write that later `403`s after revoke/demote surfaces as failed sync (Chunk D).
- Hidden list IDs persist in `tasks-view-prefs` (same pattern as calendar hidden IDs). All Tasks and other aggregate filters exclude tasks from hidden lists. Row click still navigates; create into a list may unhide it (Calendar create-target parity).
