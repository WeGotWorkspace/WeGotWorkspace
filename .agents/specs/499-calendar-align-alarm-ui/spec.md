Source: #499 (body-hash: 7cd14f75)
Goal: #385

# Align alarm UI with invite UI

Technical translation of Task #499 — alarm rows in the event dialog follow the invitee list pattern.

## Goal

Alarm / reminder rows use the same **ShareAccessCard + ShareAccessRow** layout, density, and add/remove pattern as invitees: list rows with a leading mark, trailing offset control, outline remove, and an add control in the card footer — not a header-only picker.

## Non-goals

- Alert delivery (#390)
- Redesigning the invitee UI
- Custom recurrence editor
- Changing offset presets, leftover email-alarm interop, or JSCalendar alert mapping

## Affected packages

- packages/apps (`calendar-core`)
- `.agents/specs/499-calendar-align-alarm-ui/`

## Technical constraints

- Reuse `ShareAccessCard` / `ShareAccessRow` (do not invent a third row chrome).
- Preserve existing alarm behavior: offset presets, custom amount/unit, leftover absolute `when`, display-only leftover email (no action menu).
- BEM + `@apply` in CSS; keep alarm-row controls inside the shared row trailing slot.
- RTL still covers add / change offset / remove.

## Edge cases

- Empty list: show the existing “no alarms” hint; add control still available when writable.
- Invitee read-only dialog: no add/remove (same as invitees `readOnly`).
- Multiple alarms: one row per alert id; remove only that row.
