# Slimmer wide month-cell event cards

Derived from [spec.md](./spec.md). Single UI chunk — no parallel split.

## Goal

Wide month cells show more than three event titles before “+N more” by using slimmer EventCard lanes.

## Non-goals

- Compact-month / overflow-popover / week-day timed-lane changes

## Affected packages

- packages/apps

## Dependencies

1. CSS contract test for wide-month tokens (red)
2. Token implementation on `:host([mode="month"])`
3. Mock-tier story at desktop width for visual check

## Chunks

### Chunk A: Wide-month density tokens

- **id:** `calendar-month-cell-density`
- **Skill:** apps-ui
- **Inputs:** Task #630 AC; `CalendarTimelineView.css` compact-month block (must stay)
- **Done when:** Wide month lane < 32px and > compact-only view-only rules; titles readable; +N still clips; compact + week/day unchanged; CSS tests green
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.css.test.ts`
- **Parallel with:** none

## Test plan

- [ ] CSS test asserts wide-month tokens separately from compact-month
- [ ] Existing compact-month CSS test stays green
- [ ] Mock-tier Calendar story at desktop width with a busy day (optional visual)
