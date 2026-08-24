# Compact month: slim view-only event bars

Derived from [spec.md](./spec.md). Sequential CSS-first work; tests lead implementation.

## Goal

Repurpose compact month (mobile / ≤504px / `forceCompact`) to show slim, view-only EventCard bars. Year stays dots. Wide month stays interactive.

## Non-goals

- Year-grid changes, a second card component, interactive slim bars, GitHub issue filing

## Affected packages

- packages/apps

## Dependencies

1. Red CSS contract tests (CalendarTimelineView + EventCard) before CSS/token edits
2. Compact CSS rewrite and density tokens together (same files, keep query / `force-compact` in sync)
3. Browser-check after Vitest is green

## Chunks

### Chunk A: CSS contract tests

- **id:** `tests-browser`
- **Skill:** testing
- **Inputs:** current compact month hides `cell-main`/`cell-footer` and shows `day-dots`
- **Done when:** failing then green contract tests assert both compact blocks show lanes, hide dots, set 18–22px tokens, and disable event hits; EventCard heading/pointer-events tokens are asserted; year tests still expect 0 `event-card`s
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/CalendarTimelineView src/lib/calendar-elements/EventCard/EventCard.css.test.ts`
- **Parallel with:** none (leads build)

### Chunk B: Compact CSS + density tokens

- **id:** `compact-css`
- **Skill:** apps-ui
- **Inputs:** Chunk A red tests; [CalendarTimelineView.css](../../../packages/apps/src/lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.css)
- **Done when:** query and `:host([force-compact])` show cell-main/footer, hide dots, short start-aligned header, chrome-off, 20px lanes, pointer-events none on events; JSDoc comments no longer say year-style/dots
- **Verify with:** same Vitest command as Chunk A
- **Parallel with:** `density-tokens` (same edit set)

### Chunk C: EventCard heading / pointer-events tokens

- **id:** `density-tokens`
- **Skill:** apps-ui
- **Inputs:** Chunk A red tests; [EventCard.css](../../../packages/apps/src/lib/calendar-elements/EventCard/EventCard.css)
- **Done when:** ≤47px / ≤31px headings consume `--_lc-event-card-heading-padding-block` (defaults `0.5rem` / `0.375rem`); shell uses `pointer-events: var(--_lc-event-card-pointer-events, auto)`; compact month sets `1px` padding and `none` hits
- **Verify with:** EventCard CSS contract test + compact-month token assertions
- **Parallel with:** `compact-css`

## Test plan

- [x] UI: write failing CSS contract tests, then implement until green
- [x] Browser-check Storybook `Apps/Calendar/Default` at desktop (>504px) and ~390px; year remains dots-only
