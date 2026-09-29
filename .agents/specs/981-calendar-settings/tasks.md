# Engineering tasks — Calendar settings pane

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece**.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `file-spec` | builder | plan-feature | `.agents/specs/981-calendar-settings/` | `gh issue view 981` |
| `display-prefs` | builder | apps-ui | `packages/apps/src/lib/calendar-display-prefs.ts`, `packages/apps/src/lib/calendar-time-zones.ts` | `pnpm --dir packages/apps exec vitest run src/lib/calendar-display-prefs.test.tsx` |
| `calendar-pane` | builder | workspace, storybook | `settings-calendar-pane.tsx`, `register-builtin-settings.tsx`, `settings-types.ts` | `pnpm --dir packages/apps exec vitest run src/settings-core/src/settings-registry.test.ts src/settings-core/src/use-settings-calendar-form-saved.test.tsx` |
| `grid-wiring` | builder | workspace | `use-calendar-display-prefs.ts`, `calendar-surface.tsx`, `wgw-calendar-surface.ts`, `CalendarViewGroup.ts` | `pnpm --dir packages/apps exec vitest run src/calendar-core/src/use-calendar-display-prefs.test.tsx src/calendar-core/src/calendar-surface-display.test.tsx` |

## Notes

- Chunk `id` values must match `plan.md`.
- On scope change: update Task #981 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
