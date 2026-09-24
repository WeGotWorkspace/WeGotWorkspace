# Compact event-details popover

Derived from [spec.md](./spec.md). Sequential — one chunk.

## Goal

Click/tap event → popover. Writable events host the shared editable form in the popover; invitees keep details + RSVP. Create still uses the dialog.

## Non-goals

- Custom recurrence; create-flow changes

## Affected packages

- packages/apps

## Dependencies

- Existing invitee/RSVP UI (`CalendarRsvpActions`, `persistInviteeRsvp`)
- Shared `CalendarEventForm` (dialog + interactive popover)

## Chunks

### Chunk A: Preview model + popover + interactive edit + workspace wiring

- **id:** `calendar-event-details-popover`
- **Skill:** workspace, apps-ui, storybook, testing
- **Inputs:** Task #496, current event-dialog / surface / RSVP; UX iteration (editable popover)
- **Done when:** Writable selection edits in the popover; invitee RSVP unchanged; create dialog unchanged
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-event-preview.test.ts src/calendar-core/src/calendar-event-details-popover.test.tsx src/calendar-core/src/calendar-event-dialog.test.tsx`
- **Parallel with:** none

## Test plan

- [x] Pure: resolve preview form for master + occurrence
- [x] RTL: details popover for invitees; interactive form for writers; save/cancel/delete
- [x] Storybook mock-tier + play for interactive edit
- [x] Create-from-empty-slot still opens the dialog (no popover)
