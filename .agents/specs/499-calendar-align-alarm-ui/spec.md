Source: #499 (body-hash: 7cd14f75)
Goal: #385

# Align alarm UI with invite UI

Technical translation of Task #499 — alarm rows in the event dialog follow the invitee list pattern.

## Goal

Alarm / reminder rows use the same **ShareAccessCard + ShareAccessRow** layout and density as invitees. The parent card stays titled **Alarms** with the bell icon only there. Each row shows **Alert** (no icon), an offset dropdown that includes **None**, and delete on set rows. There is no footer Add button and no “No alarms” empty-state copy. A writable card always ends with one unused **None** slot.

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
- Card title remains `eventAlarmsLabel` (“Alarms”); do not rename the section to Alerts.
- Bell / title icon only on the parent card — not on each row.
- Each row is numbered `Alert 1`, `Alert 2`, … (trailing None is the next number).
- Persist only real alerts via `alertsAfterOffsetChange`. Choosing None on a set row removes it; choosing an offset on the trailing slot appends one. Keep exactly one trailing None in the UI, never in the form.
- Do not render `eventAlarmsNone` or an Add-alert footer.
- Preserve leftover absolute `when` and display-only leftover email (no action menu).
- BEM + `@apply` in CSS; keep alarm-row controls inside the shared row trailing slot.

## Edge cases

- Empty writable card: one Alert + None row only (no “No alarms” copy).
- Invitee read-only dialog: existing rows only; no trailing None; no delete.
- Multiple alarms: one persisted row per alert id plus one trailing None.
