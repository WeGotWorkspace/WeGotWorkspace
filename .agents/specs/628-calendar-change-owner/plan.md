# Change the owner of an existing calendar

Derived from [spec.md](./spec.md).

## Goal

Enable post-create owner transfer (personal ↔ group) via `Calendar/set` `groupSlug` and the existing calendar dialog Owner field.

## Non-goals

- Person-to-person owner pick
- Share / delegate Goals

## Affected packages

- packages/api
- packages/apps

## Dependencies

1. OpenAPI `CalendarPatch.groupSlug` + failing feature tests
2. `CalendarRepository::update` transfer
3. Dialog + controller + hybrid operations
4. Verify

## Chunks

### Chunk A: API owner transfer

- **id:** `calendar-change-owner`
- **Skill:** api
- **Inputs:** Task #628, `CalendarRepository`, `CalendarPatch`
- **Done when:** Feature tests cover personal→group, group→personal, events + shareWith preserved, previous owner access, sharee/default/provisioned/subscription forbidden
- **Verify with:** `phpunit tests/Feature/Calendars/CalendarsChangeOwnerTest.php`
- **Parallel with:** none (contract first)

### Chunk B: Calendar dialog Owner on edit

- **id:** `calendar-change-owner-ui`
- **Skill:** workspace
- **Inputs:** Chunk A contract (`groupSlug` on patch)
- **Done when:** Owner is enabled on transferable calendars; `patchCalendar` forwards `groupSlug`; sharee/default/subscription stay disabled; owner transfer refuses offline
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/calendar-core/src/calendar-calendar-dialog.test.tsx src/calendar-core/src/calendar-collection-write.test.ts src/calendar-core/src/use-calendar-controller.test.tsx src/lib/offline/calendars-hybrid-operations.test.ts`
- **Parallel with:** none (after A)

## Test plan

- [ ] API: OpenAPI → failing feature test → implement
- [ ] UI: Vitest for dialog, write helper, controller, hybrid offline
