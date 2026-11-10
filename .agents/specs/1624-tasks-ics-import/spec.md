Source: #1624 (body-hash: c27c9594)
Goal: WeGotWorkspace/Product#148

# Import tasks from an ICS file

## Goal

Tasks gets the same ICS import as Calendar, for VTODOs instead of VEVENTs. The person picks an `.ics` file from the Tasks new menu, chooses an existing writable task list or a new one, and the file's VTODO UID groups are stored in that list as-is. Afterwards they see how many tasks were imported, which ones failed and why, and how many events in the file were skipped.

The code Calendar and Tasks share is generalised, not copied: the UID-group splitter (over the component type), the whole-body size check, the `.ics` file helpers and the destination picker dialog.

## Non-goals

- Raising the whole-body import limit, or the signal for stored over-cap objects (#931).
- Showing subtasks or repeating tasks in the Tasks UI. The data is stored, not shown.
- Export, subscriptions, account imports, drag-and-drop import.
- Telling Calendar users about VTODOs in a calendar import, in the Tasks import PR (#1989). The issue keeps it out of the Tasks import; it lands as its own small PR (#2002) into the same integration branch (see *Calendar follow-up* below).

## Affected packages

- `packages/api`: splitter, payload guard, task import service + controller + route, OpenAPI, feature/unit/ownership tests.
- `packages/apps`: shared `lib/ics-import/` (file helpers, destination dialog), Tasks client call, offline op, hook, dialog, menu item, labels, Vitest, Storybook.

## API contract

`POST /api/v1/tasks/items/import?taskListId=<id>`, raw `text/calendar` body, in the `wgw.tasks` group.

| Case | Status | Body |
|------|--------|------|
| At least one task imported | 201 | `{list: Task[], errors: TaskImportError[], skipped: {events: int}}` |
| Groups present, none imported | 400 | same shape |
| `taskListId` missing, empty or unreadable body, no VTODO in file | 400 | `{error, code: bad_request}` |
| Unknown or invisible list | 404 | `{error, code: not_found}` |
| Read-only list | 403 | `{error, code: forbidden}` |
| Body over the whole-body import cap | 413 | `{error, code: payload_too_large}` |

`TaskImportError` is `{index, message, code?, uid?, title?}`. `index` is the UID group's position in the file, as in Calendar. `uid` and `title` (the VTODO `SUMMARY`) are extra so the client can name the task that failed. `skipped.events` counts VEVENT UID groups (a series with overrides counts once).

Per group, in order: component cap (`VObjectPayloadGuard::readICalendar`), recurrence guard (`RecurrenceRuleGuard`), a UID present, existing UID in the target list (`409`-style error entry with `code: already_exists`, nothing overwritten), then one transaction that stores the group, syncs search and maps the stored tasks. The `tasks` mutation event fires once per stored object after its transaction. No notifications.

## Client behaviour

- New menu item *Import tasks* (Upload icon) next to *New list*. Offline it is disabled with the reason *Needs an internet connection*.
- The dialog is the Calendar import dialog, generalised: destination menu of writable lists (task-list icon and colour), separator, *New list*; the new-list path asks for name (default from the file name) and colour.
- After import:
  - Everything imported: toast *Imported N tasks*, dialog closes.
  - Anything to report (errors or skipped events): toast as above when N > 0, and the dialog switches to a result step with *Imported N tasks*, each failed task with its reason, and *N events were skipped. Import them in Calendar.*
  - Nothing imported because every group failed: result step with *No tasks were imported* and the reasons.
  - The destination list is selected in both cases, and a newly created list appears in the sidebar.
- Imported tasks are written to the Tasks offline cache.

## Edge cases

- A file without VTODOs: the client sees it in the file text and shows *This file has no tasks.* before it creates a list or calls the API. The server still answers 400 *No VTODO data found* for such a body.
- A list created for the import stays when the import then fails (same as Calendar). The result step says so implicitly by selecting it.
- A duplicate import of the same file: every group is an `already_exists` error; status 400 with the list/errors body; the client shows the result step, not a generic failure.
- Missing `UID` on a VTODO: the splitter seeds a stable id for grouping, but the stored ICS stays as-is, so CalDAV would index an empty UID and a second one would collide. Such a group is an error entry *This task has no UID.* (`bad_request`); the other groups still import.
- The list in view is preselected when it is writable, shared lists included.

## Calendar follow-up

A separate PR (#2002), after the Tasks import (#1989). Calendar import now tells people about the tasks in their file, using the shared splitter's count:

- `POST /calendars/events/import` returns `skipped: {tasks: int}`, counting VTODO UID groups. The status rule is unchanged.
- When events were imported and `skipped.tasks > 0`, the success toast adds "N tasks were skipped. Import them in Tasks." (for one: "1 task was skipped. Import it in Tasks.").
- A file with VTODOs and no VEVENTs still gets 400 from the server. The client checks the file text before it creates a calendar or calls the API, and shows "This file has tasks, not events. Import it in Tasks." in the dialog.
