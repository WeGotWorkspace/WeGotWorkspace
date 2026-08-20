# Touch resize in day/week timed views

Derived from [spec.md](./spec.md). Single sequential chunk — same files, no parallel split.

## Goal

Two-step touch resize on the day/week TimeLine: short-press opens the details popover and shows large grabbers on that event; then drag. Mouse resize unchanged.

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
- **Done when:** Coarse grabbers appear only for the short-pressed / popover-open event; unselected coarse handles stay inert; mouse hover resize unchanged; unit + mobile-viewport Playwright cover visibility
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/ResizeHandle src/lib/calendar-elements/TimeLine/TimeLine.css.test.ts`
- **Parallel with:** none

## Test plan

- [x] UI: Vitest on handle CSS contract + selected-event-key helper (Storybook equivalent — no TimeLine catalog surface today)
- [ ] `pnpm test:apps-done-gate` before push
