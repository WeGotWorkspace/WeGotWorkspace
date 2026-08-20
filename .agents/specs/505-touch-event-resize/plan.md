# Touch resize in day/week timed views

Derived from [spec.md](./spec.md). Single sequential chunk — same files, no parallel split.

## Goal

Two-step touch resize on the day/week TimeLine: select, then drag large grabbers. Mouse resize unchanged.

## Non-goals

- Month / all-day-only touch resize
- Dialog-only duration edits
- Recurrence scope UI

## Affected packages

- packages/apps

## Dependencies

- None (cut from `main`)

## Chunks

### Chunk A: Touch-safe resize handles

- **id:** `touch-event-resize`
- **Skill:** apps-ui
- **Inputs:** Issue #505 AC; `ResizeHandle.css` coarse hide; TimeLine resize session
- **Done when:** Coarse selected events show ≥24px grabbers; unselected coarse handles stay inert; mouse hover resize unchanged; unit tests cover CSS + selected-key wiring
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/ResizeHandle src/lib/calendar-elements/TimeLine/TimeLine.css.test.ts`
- **Parallel with:** none

## Test plan

- [x] UI: Vitest on handle CSS contract + selected-event-key helper (Storybook equivalent — no TimeLine catalog surface today)
- [ ] `pnpm test:apps-done-gate` before push
