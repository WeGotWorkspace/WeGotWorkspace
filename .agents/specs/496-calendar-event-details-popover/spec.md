Source: #496 (body-hash: 766512c6)
Goal: #385

# Compact event-details popover

Technical translation of Task #496 — clicking a calendar event opens a compact popover instead of the full editor.

## Goal

Selecting an event on the Lit calendar surface opens a dismissible **details popover** (title, when, calendar, location/notes/invitees) with **Edit** to the existing `CalendarEventDialog`. Invitee RSVP stays on the popover via the existing `CalendarRsvpActions` / `persistInviteeRsvp` path. Empty-slot create still opens the create dialog.

## Non-goals

- Redesigning the edit dialog
- Custom recurrence editor
- Changing empty-slot / drag-create (still create dialog)
- Calendar sharing, iMIP, or new scheduling transport

## Affected packages

- packages/apps (`calendar-core`)
- `.agents/specs/496-calendar-event-details-popover/`

## Technical constraints

- Reuse `resolve` + form mapping already used by `openEditEventKey` (do not duplicate occurrence-anchor logic).
- Do not grow `use-calendar-controller` with preview UI state — keep preview in a small hook / workspace wiring.
- RSVP uses existing suite actions + `persistInviteeRsvp` (`source: "preview"` treated like dialog for occurrence-scope prompts).
- BEM + `@apply` in CSS; popover is portaled (own surface tokens, like the event dialog).
- Keyboard: Escape / outside click dismisses; user is not forced into the editor to read details.
- Read-only calendars can still open the popover; Edit is omitted when the user cannot write.

## Edge cases

- Recurring occurrence: popover shows that occurrence’s wall times; Edit still opens the existing editor with `recurrenceId`.
- Pending deleted master: ignore selection (same as editor).
- Invitee without write: popover + RSVP, no Edit.
- No click origin: popover still opens (viewport-centered anchor).
