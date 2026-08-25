# Persist Calendar view preferences

Derived from [spec.md](./spec.md). Single sequential chunk — one package, no contract change.

## Goal

Device-local restore of hidden calendars and last view/presentation for Goal #619 / Task #627.

## Non-goals

- API / cross-device sync
- Date/anchor persistence
- Calendar settings pane (#617)

## Affected packages

- packages/apps

## Dependencies

None.

## Chunks

### Chunk A: calendar view prefs

- **id:** `calendar-view-prefs`
- **Skill:** workspace, testing
- **Inputs:** Task #627 AC; existing `persisted-view-mode` helpers; `use-calendar-controller`, `calendar-route-search`, `use-calendar-route-sync`
- **Done when:** Hidden calendars and last view/presentation restore after remount; explicit URL wins; corrupt storage falls back; Vitest green for prefs + controller + route sync
- **Verify with:** `pnpm --dir packages/apps test -- src/calendar-core/src/calendar-view-prefs.test.tsx src/calendar-core/src/calendar-route-search.test.ts src/calendar-core/src/use-calendar-route-sync.test.tsx src/calendar-core/src/use-calendar-view-prefs.test.tsx`
- **Parallel with:** none

## Test plan

- [x] UI: Vitest first for parse/read/write, then controller remount + bare `/calendar` restore
- [ ] No new Storybook export — persistence is hook/util, not a new pane
