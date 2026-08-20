# Compact event-details popover

Derived from [spec.md](./spec.md). Sequential — one chunk.

## Goal

Click/tap event → compact popover → Edit opens the existing dialog. RSVP stays on the popover.

## Non-goals

- Edit-dialog redesign, custom recurrence, create-flow changes

## Affected packages

- packages/apps

## Dependencies

- Existing invitee/RSVP UI on `main` (`CalendarRsvpActions`, `persistInviteeRsvp`)

## Chunks

### Chunk A: Preview model + popover + workspace wiring

- **id:** `calendar-event-details-popover`
- **Skill:** workspace, apps-ui, storybook, testing
- **Inputs:** Task #496, current event-dialog / surface / RSVP
- **Done when:** AC in #496 hold; stories/RTL cover open + Edit
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-event-preview.test.ts src/calendar-core/src/calendar-event-details-popover.test.tsx src/calendar-core/src/use-calendar-controller.test.tsx`
- **Parallel with:** none

## Test plan

- [ ] Pure: resolve preview form for master + occurrence
- [ ] RTL: popover shows details; Edit fires; RSVP visible for invitee
- [ ] Storybook mock-tier + play for Edit
- [ ] Create-from-empty-slot still opens the dialog (no popover)
