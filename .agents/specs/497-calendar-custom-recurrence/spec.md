Source: #497 (body-hash: e402f3db)
Goal: #385

# Create and edit custom recurrence rules

Technical translation of Task #497 — the event dialog can create and edit unmatched JSCalendar recurrence rules instead of treating `custom` as display-only.

## Goal

Users can pick **Custom** from the existing Repeat select and set frequency, interval, by-day, and series end (never / until / count). Saving writes JSCalendar `recurrenceRules`. Reopening an unmatched rule stays `custom` and shows the same fields. Named presets stay one-click and do not open the custom editor.

## Non-goals

- Full RRULE / every `BY*` product parity
- Recurrence exceptions / this-occurrence-only (already shipped)
- Changing preset matching or preset option labels

## Affected packages

- packages/apps (`calendar-core`)
- `.agents/specs/497-calendar-custom-recurrence/`

## Technical constraints

- Keep preset matching in `calendar-recurrence-presets.ts`; do not flatten custom rules to a wrong preset.
- Persist via existing `form.customRecurrenceRules` + `formRecurrenceRules()`; apply never/until/count the same way presets do.
- Extra wire fields (`byMonthDay`, `nthOfPeriod`, hourly frequency, …) survive edits of the supported fields.
- Unlock the Repeat select when the preset is `custom`; include Custom in the create-event options.
- BEM + `@apply` in CSS; do not grow `use-calendar-controller.ts`.
- Extract custom field mapping to a pure module; keep the dialog as wiring.

## Edge cases

- Switching from a preset to Custom seeds from that preset rule (or weekly on the start weekday from None).
- Switching away from Custom to a named preset clears `customRecurrenceRules`.
- Weekly by-day cannot be emptied (keep at least one day).
- Read-only invitee dialog: fields visible, disabled.
- Title-only save of an unchanged custom series must not emit a `recurrenceRules` patch.
