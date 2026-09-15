Source: #496 (body-hash: 766512c6)
Goal: #385

# Compact event-details popover

Technical translation of Task #496 — clicking a calendar event opens a compact popover instead of the full editor.

## Goal

Selecting an event on the Lit calendar surface opens a dismissible **popover**. For **writable organizers / writers**, the popover hosts the shared **editable event form** (`CalendarEventForm`) so common edits save in one surface (no separate Edit → dialog hop). For **invitees / read-only**, the popover stays a compact details card with RSVP / Join. Empty-slot create still opens the create dialog.

## Non-goals

- Custom recurrence editor
- Changing empty-slot / drag-create (still create dialog)
- Calendar sharing, iMIP, or new scheduling transport

## Affected packages

- packages/apps (`calendar-core`)
- `.agents/specs/496-calendar-event-details-popover/`

## Technical constraints

- Reuse `resolve` + form mapping already used by `openEditEventKey` (do not duplicate occurrence-anchor logic).
- Do not grow `use-calendar-controller` with preview UI state — keep preview in workspace wiring; interactive edit opens the existing editor state into the popover.
- Shared form layout: FieldLabelRow fields; desktop multi-column (`min-width: 40rem`); mobile single column. Create dialog wraps the same form.
- RSVP uses existing suite actions + `persistInviteeRsvp` (`source: "preview"` treated like dialog for occurrence-scope prompts).
- BEM + `@apply` in CSS; popover is portaled (own surface tokens, like the event dialog).
- Larger viewports: CSS `anchor-name` + `position-try` (flip-block / flip-inline / corner areas) around the **event card** rect, plus Radix collision shift with padding, so corner and edge cells stay fully visible with inset — never flush or clipped.
- Small viewports (`max-width: 40rem`) and compact-month cell origins: dock the Radix popper wrapper to the viewport bottom and size the card to its content. Do not apply `position-try` / `position-area` on that path.
- Keyboard: Escape / outside click dismisses (discards like cancel on the interactive form).
- Read-only calendars can still open the details popover; the editable form is omitted when the user cannot write.

## Edge cases

- Recurring occurrence: interactive edit opens with `recurrenceId`; save/delete still use recurrence scope prompts.
- Pending deleted master: ignore selection (same as editor).
- Invitee without write: details popover + RSVP, no editable form.
- No card origin: popover still opens (viewport fallback; small screens stay center-bottom).
- Bottom-right / bottom-left month cells and day/week timed events on the edge: flip or shift inward with margin; do not pin flush to the pane corner.
- Compact month: tapping a day with events opens the day-overflow card (day number + chips), not the details popover. Tapping a chip there opens details/edit and dismisses the overflow card.
