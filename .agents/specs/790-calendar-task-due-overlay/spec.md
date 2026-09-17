Source: #790 (body-hash: d32768e7)
Goal: #528

# Show task due dates on every Calendar view

Technical translation of Task [#790](https://github.com/WeGotWorkspace/wegotworkspace/issues/790). Product context: Goal [#528](https://github.com/WeGotWorkspace/wegotworkspace/issues/528) (see task due dates on Calendar).

## Goal

Calendar paints **task due dates** on day, week, month, list, and year from the Tasks Dexie/hybrid store. Each task list is its own colored, hideable sidebar row. Clicks open a read-only preview with Open in Tasks (`?task=`). Overlay keys never enter Calendar JMAP, EventsAPI, or event create-target.

## Non-goals

- Birthday overlay (#620)
- Creating, editing, or completing tasks on the grid
- Alert delivery (#390 / #493)
- Recurring tasks (#562)
- Sharing or renaming lists from Calendar
- Merging overlay hide prefs with Tasks `hiddenTaskListIds`
- New Tasks due-range API
- Dexie liveQuery / BroadcastChannel
- A fourth year-cell dot or year-only "+N" badge
- Attaching v0.9 to Goal #528 or Task #790
- Mounting full `useTasksAPI` in the calendar controller

## Affected packages

- `packages/apps` — calendar-core, calendar-elements (render-only overlay), tasks-core route search
- `.agents/specs/790-calendar-task-due-overlay/`

## Technical constraints

- Hydrate via `loadTasksBootstrapHybrid` / Dexie. Never Calendar JMAP/REST / VTODO.
- Render-only synthetic engine rows (`overlayKind: "task"`, key `task:{id}`) merged **after** calendar visibility filter. No `calendarId` on overlay rows so `visibleCalendarIds` does not hide them.
- Overlay refresh listens to the same **browser events** (`visibilitychange`, `online`) with its **own** handler and `useOfflineReconnectFlush`. Do not call `use-calendar-api` `applyBootstrapRefresh` or the calendar outbox flush.
- Hide prefs: `hiddenOverlayTaskListIds` on `CalendarViewPrefs` (Calendar-local).
- Sidebar: `CollectionSidebarRow` checkbox only — no `onSelect` / edit pencil.
- Year: feed overlay colors into existing `uniqueDayDotColors` (limit 3) and the year-day overflow popover.
- Timed dues: 30-minute blocks on day/week; date-only: all-day chips.
- Completed/cancelled tasks omitted.
- Deep-link: `/tasks/lists/{listId}?task={taskId}` opens the Tasks edit dialog.
- Overlay UI state stays in workspace / dedicated hooks — do not grow `use-calendar-controller`.

## Edge cases

- Cold Calendar session still populates Tasks Dexie via hybrid bootstrap; overlay empty if bootstrap fails.
- Focus-spam: overlay in-flight guard independent of Calendar’s.
- Task-list row click must not change `defaultCalendarId`.
- Delete / move / resize on overlay cards is a no-op (locked + EventsAPI skip).
- Hidden overlay lists stay hidden after reload on the same device.
