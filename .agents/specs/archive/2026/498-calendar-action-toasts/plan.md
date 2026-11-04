# Toasts with undo for key Calendar actions

Derived from [spec.md](./spec.md). Sequential — one chunk.

## Goal

Wire create/update and RSVP through the suite undo queue already used by delete.

## Non-goals

- New toast UI, view-change undo, Mail toasts

## Affected packages

- packages/apps

## Dependencies

- `useQueuedMutation` + delete-event undo on `main`
- RSVP persist + `persistInviteeRsvp` on `main`

## Chunks

### Chunk A: Undoable save + RSVP

- **id:** `calendar-action-toasts`
- **Skill:** workspace, apps-ui, testing
- **Inputs:** Task #498, `use-calendar-controller.ts`, `calendar-workspace.tsx`
- **Done when:** AC in #498 hold; save and RSVP undo covered by tests
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/use-calendar-controller.test.tsx src/calendar-core/src/calendar-rsvp-scope.test.ts`
- **Parallel with:** none

## Test plan

- [ ] Controller: create shows suite undo toast; undo deletes the created event
- [ ] Controller: update undo re-patches the original
- [ ] RSVP helper: execute then undo restores previous PARTSTAT
- [ ] Workspace sources the shared queue (not a Calendar-only stack)
