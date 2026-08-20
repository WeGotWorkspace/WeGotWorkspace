# Touch resize in day/week timed views

Derived from [spec.md](./spec.md). Single sequential chunk — same files, no parallel split.

## Goal

Two-step touch resize on the day/week TimeLine: short-press opens the details popover and shows thin event-accent pills on that event; then drag. Fine pointer shows the same pills on event hover. No drag drop-shadow.

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
- **Done when:** Coarse pills appear only for the short-pressed / popover-open event; unselected coarse handles stay inert; fine-pointer event hover shows the same pills; unit + mobile-viewport Playwright cover visibility
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/calendar-elements/ResizeHandle src/lib/calendar-elements/TimeLine/TimeLine.css.test.ts`
- **Parallel with:** none

## Test plan

- [x] UI: Vitest on handle CSS contract + selected-event-key helper (Storybook equivalent — no TimeLine catalog surface today)
- [ ] `pnpm test:apps-done-gate` before push
