# Align alarm UI with invite UI

Derived from [spec.md](./spec.md). Sequential — one chunk.

## Goal

Match alarm rows to invitee list + add/remove density without changing alarm semantics.

## Non-goals

- Invitee redesign, alert delivery, recurrence editor

## Affected packages

- packages/apps

## Dependencies

- Existing `CalendarInviteesCard` / share-ui row pattern on `main`

## Chunks

### Chunk A: Alarms card

- **id:** `calendar-align-alarm-ui`
- **Skill:** apps-ui, testing
- **Inputs:** Task #499, `calendar-event-dialog.tsx`, `calendar-invitees-card.tsx`
- **Done when:** AC in #499 hold; add/change/remove still covered
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-event-dialog.test.tsx`
- **Parallel with:** none
