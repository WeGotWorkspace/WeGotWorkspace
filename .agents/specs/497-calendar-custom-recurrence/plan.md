# Create and edit custom recurrence rules

Derived from [spec.md](./spec.md). Single sequential chunk — UI + persist live in `calendar-core`.

## Goal

Unlock Custom in the event dialog with frequency, interval, frequency-specific repeat-on, and end fields that persist JSCalendar `recurrenceRules`.

## Non-goals

- Full RRULE parity
- Recurrence exceptions

## Affected packages

- packages/apps
- `.agents/specs/497-calendar-custom-recurrence/`

## Dependencies

1. Spec files
2. Pure custom-rule helpers + editor-model persist
3. Dialog fields + tests/story

## Chunks

### Chunk A: Custom recurrence editor

- **id:** `calendar-custom-recurrence`
- **Skill:** apps-ui
- **Inputs:** Task #497, existing presets + `form.customRecurrenceRules`
- **Done when:** create/edit custom works; presets unchanged; tests cover all three; spec committed
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-custom-recurrence.test.ts src/calendar-core/src/calendar-editor-model.test.ts src/calendar-core/src/calendar-event-dialog.test.tsx src/calendar-core/src/calendar-recurrence-presets.test.ts`
- **Parallel with:** none

## Test plan

- [ ] Vitest: seed/patch/toggle helpers
- [ ] Vitest: create custom, edit custom, title-only no patch, presets unchanged
- [ ] RTL: Custom offered on create; existing custom editable; daily preset hides custom fields
- [ ] Storybook: `Apps/Calendar/CustomRecurrenceFields`
