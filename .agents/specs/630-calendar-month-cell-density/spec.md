Source: #630 (body-hash: 6c0fd105)
Goal: #616

# Slimmer wide month-cell event cards

Technical translation of Task #630 — raise month-grid density on large screens by shrinking EventCard lane height, not by growing cells.

## Goal

Wide `calendar-timeline-view` month mode (`:host([mode="month"])`, above the `lc-timeline-month` 504px compact query) must use slimmer interactive event cards than the default 32px timed/all-day lane so a typical large day cell shows **more than three** titles before TimeLine clips and the “+N more” footer appears.

## Non-goals

- Compact / `force-compact` month treatment (20px view-only bars, header popover)
- Overflow popover behavior on narrow month
- Week/day timed lane height (32px / 28px fine-pointer)
- Growing month cell height to fit more cards
- Showing every event with no overflow

## Affected packages

- `packages/apps` — `CalendarTimelineView` CSS tokens + CSS contract tests; optional mock-tier Calendar story at desktop width

## Technical constraints

- Density lives in CSS custom properties consumed by `<time-line>` / `<event-card>` (`--event-height`, `--_lc-event-height`, `--time-line-event-min-size`, heading padding/line-height). Do not add a JS cap of “3 cards”.
- Wide-month cards stay interactive: do **not** set `--_lc-event-card-pointer-events: none` or hide the accent bar (those belong to compact only).
- Heading tokens must keep a 12px title’s x-height unclipped at the new lane height (compact heading tier is `@container (max-height: 31px)`).
- Overflow footer already exists for `height="auto"` horizontal masonry; leave that path intact.

## Edge cases

- Compact container query and `:host([force-compact])` must still override to the 18–22px view-only band
- Day overflow popover resets lane tokens to `--_lc-default-event-height` (32px) — do not inherit slim month density into the popover
- Multi-day spanning bars use the same lane height; slimming must not break masonry row math
