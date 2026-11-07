# In-grid double-click and header + create

Derived from [spec.md](./spec.md).

## Goal

Open the existing create dialog from a double-click on empty slots/cells, or from a day-header + button. Day-number stays navigate.

## Non-goals

- Drag-to-create behavior changes, year-view create, dialog redesign, day-number create

## Affected packages

- packages/apps

## Dependencies

Single sequential chunk — TimeLine commit, month header wiring, and weekday-header + share the same create event.

## Chunks

### Chunk A: calendar-grid-create

- **id:** `calendar-grid-create`
- **Skill:** workspace, apps-ui, testing, accessibility
- **Inputs:** #629 AC, TimeLine create session, CalendarTimelineView month headers, CalendarWeekdayHeader
- **Done when:** AC on #629 pass via Vitest; drag-to-create and toolbar create unchanged; smells scan on touched files
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/TimeLine/TimeLine.create-click.test.tsx src/lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.month-create.test.tsx src/lib/calendar-elements/TimeLine/TimeLine.move-click.test.tsx src/lib/calendar-elements/CalendarWeekdayHeader/CalendarWeekdayHeader.create-button.test.tsx src/lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.header-create.test.tsx`
- **Parallel with:** none

## Test plan

- [x] TimeLine: single click without drag does **not** emit `timeline-event-create`
- [x] TimeLine: double-click emits `timeline-event-create` (one-step at click time)
- [x] TimeLine: drag past threshold still emits a spanned create
- [x] TimeLine: Enter/Space on a focused timed **cell** emits create at the default slot
- [x] Month: empty day-number click / Enter emit `day-selection`, not create
- [x] Month: empty day-number double-click emits all-day `event-create-requested`, not only `day-selection`
- [x] Month / week / day: header **+** has accessible name and activate emits all-day create
- [x] Month: day with events still uses existing popover / day-selection path
