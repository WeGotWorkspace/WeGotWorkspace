# JMAP Tasks — REST subset summary

> **Issue:** [#134](https://github.com/WeGotWorkspace/wegotworkspace/issues/134)  
> **Architecture:** [docs/architecture/tasks.md](../../../../docs/architecture/tasks.md)

## Scope (v1)

- **Wire protocol:** CalDAV VTODO (RFC 5545) — not JMAP `Task/set` on the wire.
- **REST bodies:** JMAP-shaped `TaskList` and `Task` (draft-ietf-jmap-tasks / RFC 8984 JSCalendar alignment).
- **Capabilities:** `GET /tasks/capabilities` — feature flags + supported subset.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/tasks/capabilities` | Capabilities |
| GET | `/tasks/tasklists` | List task lists |
| GET | `/tasks/tasklists/{taskListId}` | Single task list |
| GET | `/tasks/items?taskListId={id}` | Tasks in list |
| GET | `/tasks/items/{taskId}` | Single task |
| POST | `/tasks/items` | Create task |
| PUT/PATCH | `/tasks/items/{taskId}` | Update task |
| DELETE | `/tasks/items/{taskId}` | Delete task |

Planned incremental sync ([#158](https://github.com/WeGotWorkspace/wegotworkspace/issues/158)):

- `GET /tasks/tasklists/changes?since=`
- `GET /tasks/items/changes?taskListId=&since=`

## Non-goals (v1)

- Full JMAP protocol methods (`Task/query`, blob upload, `TaskNotification`)
- Task list REST CRUD (CalDAV-only — [#157](https://github.com/WeGotWorkspace/wegotworkspace/issues/157))
- Server-side recurrence instance expansion

## Persistence

- Converters: `app/Services/Tasks/Conversion/`
- Persistence: Sabre CalDAV PDO (`calendarobjects`, `calendarinstances`)
- Feature gate: `tasks_enabled` setting (mirror `contacts_enabled`)
- Default task list: VTODO-only CalDAV collection uri `tasks-inbox` (display name "Inbox", REST `role: inbox`), provisioned on install and upgrade via `InboxTaskListProvisioner` / `wgw:tasks:provision-inbox`. The CalDAV name `inbox` is reserved for the RFC 6638 schedule-inbox.
- Strict separation: task list REST returns **VTODO-only** collections; calendar REST returns **VEVENT** collections only
- Provisioning: `home` / `work` VEVENT calendars plus `tasks-home` / `tasks-work` / `tasks-inbox` VTODO lists (display names Home, Work, Inbox) via `UserCalendarCollectionsProvisioner` / migration `2026_07_07_000150_wgw_provision_user_calendar_collections`
- Legacy mixed `default` calendar: migration `2026_07_07_000140_wgw_migrate_default_mixed_calendar_vtodos` moves VTODOs to `tasks-inbox` and strips VTODO from `default`
- Pre-#482 instances with VTODO uri `inbox` are renamed to `tasks-inbox` by `InboxTaskListProvisioner` / migration `2026_08_19_000240_wgw_rename_tasks_inbox_uri`
- Task list CRUD: `POST/PATCH/DELETE /tasks/tasklists` (VTODO-only collections)
- Calendar create via REST remains VEVENT-only; mixed collections are not supported going forward

Conversion detail: [ics-jmap-task-conversion-matrix.md](./ics-jmap-task-conversion-matrix.md) (filled in with #134).
