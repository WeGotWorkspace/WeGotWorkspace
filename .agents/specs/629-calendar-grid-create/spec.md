Source: #629 (body-hash: efb46151)
Goal: #618

# In-grid double-click and header + create

Technical translation of [#629](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/629) (parent Goal [#618](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/618)).

## Goal

Reuse the existing create dialog (`event-create-requested` → `openCreateFromSurface`) from empty grid geometry via:

1. **Double-click** on an empty week/day timed slot or empty month-view day cell
2. A day-header **+** icon button (pointer or Enter/Space on the +)

Day-number click and Enter/Space stay **day-selection** / navigate. Drag-to-create and toolbar create stay unchanged.

## Non-goals

- Changing drag-to-create duration
- Optimistic-create flicker (#540)
- Recurrence / invites / alarms beyond current create
- Year-view click-to-create (keep `day-selection` / navigate)
- Create dialog redesign
- Opening create from the day-number control (click or keyboard)

## Affected packages

- packages/apps (`calendar-elements` TimeLine, CalendarTimelineView, CalendarWeekdayHeader)

## Technical constraints

- Lit `time-line` starts a create session on empty-cell pointerdown but **does not commit** unless travel passes the drag threshold (or touch long-press). Double-click on `.cell-main` commits a one-step range at the pointer using the same `#createRangeForPointer` snap as drag.
- Month day-number buttons emit `day-selection` on click and Enter/Space (including synthesized `detail === 0`). Empty-day pointer single-click is delayed so a following double-click can create without also navigating. Days with events keep compact popover / regular day-selection.
- Day/week composed headers live in `calendar-weekday-header` date mode. Month (and gantt `#dayHeaderTemplate`) headers live in CalendarTimelineView templates. All three views get a native **+** `<button>` with accessible name `Create event on {full date}`.
- Activating **+** opens all-day create for that day (`#holdCreatePreview`).
- `cell-main` already contains `role="button"` event cards — do not wrap the cell as a button. Focus the `.cell` and handle Enter/Space only when the cell itself is the event target (timed/all-day grid, not the day-number).
- React `CalendarSurface` already maps `event-create-requested` → `onCreateRequested`; no adapter change unless month create fails to reach it.

## Edge cases

- Click on an event card still selects (must not start create).
- Single click on an empty timed slot does not create.
- Day-number Enter/Space never opens create.
- Drag past threshold still creates a span, not a one-step click.
- Escape during an in-progress drag-create still cancels.
- Keyboard create on a focused timed **cell** (no headerTemplate) uses a default snapped slot (09:00 of that day when the axis is a 24h grid).
- Keyboard create on a horizontal / all-day **cell** uses a one-step all-day range for that cell.
- Month empty day-number: pointer double-click creates; click / Enter/Space navigate.
