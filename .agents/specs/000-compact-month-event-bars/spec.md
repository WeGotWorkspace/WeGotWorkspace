Source: ad-hoc

# Compact month: slim view-only event bars

Technical translation of the ad-hoc compact-month treatment. No GitHub Task yet.

## Goal

On a narrow or `force-compact` month TimeLine (≤504px), show the same EventCard instances as slim, titled, view-only bars (20px lanes) instead of hiding them and falling back to day-dots. Day-number tap still opens the events popover when the day has events, or emits `day-selection` when empty. Year stays a cheap dots grid. Wide month, day, and week stay fully interactive.

## Non-goals

- Changing year (dots stay; year does not set `forceCompact`)
- A second card component or skipping EventCard custom elements
- Interactive slim bars (drag, resize, select)
- Temporal / rrule / worker changes
- Filing a GitHub issue

## Affected packages

- packages/apps
- `.agents/specs/000-compact-month-event-bars/`

## Technical constraints

- Same EventCard (`layout="flow"`); restyle via CSS tokens, not a new variant.
- Compact query `@container lc-timeline-month (max-width: 504px)` and `:host([force-compact])` stay in sync.
- Show `cell-main` + `cell-footer`; hide `day-dots`; keep a short start-aligned day-number header (wide-month metrics).
- Density tokens on `time-line.timeline-main`: `--event-height`, `--_lc-event-height`, `--time-line-event-min-size` = 20px (18–22px text-tier band, not the 12px pill).
- EventCard consumes `--_lc-event-card-heading-padding-block` (compact sets `1px`) and `--_lc-event-card-pointer-events` (compact sets `none`); compact also sets `--_lc-time-label-font-size: 0.625rem`.
- View-only hits: `pointer-events: none` on `::part(cell-main)`, `::part(event)`, `::part(event-card)`, plus the EventCard shell token. Header and footer stay hittable.
- TS changes are docs-only (`forceCompact` JSDoc / compact-treatment comments).
- Styling: BEM + `@apply` in CSS; tokens as `var(...)`; no long Tailwind in TS.

## Edge cases

- Lane height must stay above EventCard’s 12px accent-pill tier so title + optional compact start time remain visible.
- TimeLine `.event > * { pointer-events: auto }` and EventCard’s default `pointer-events-auto` shell recapture taps unless both `::part` rules and the shell token are set.
- Empty compact day → `day-selection`; event day → header popover; clipped lanes keep `+N` footer → overflow popover.
- `forceCompact` means slim-bar month, never year-dots.
