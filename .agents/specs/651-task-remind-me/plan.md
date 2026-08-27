# Task Remind me via shared alarm rows

Derived from [spec.md](./spec.md). Sequential chunks (shared form + mutations + a small API contract).

## Goal

Make PATCH-clear of `Task.alerts` valid, then wire multi-alarm Remind me as a bell icon + Tasks dialog around shared `CalendarAlarmsRows`, with mapping, list-row indicator, and state-based tooltips.

## Non-goals

- In-app notification scheduler (#390)
- Closed-tab push (#493)
- Re-applying an `alerts: null` clear across an offline conflict-resolution merge (`buildResolvedTaskPatch`)
- A standalone Reminders app

## Affected packages

- packages/api
- packages/apps

## Dependencies

1. Chunk A (PATCH-clear + mock/offline) before Chunk B clear-on-edit
2. Chunk B (icon + dialog + mapping + row indicator + tooltips) after A
3. Chunk C (verify) after A + B

## Chunks

### Chunk A: PATCH-clear alerts

- **id:** `chunk-a-api-clear`
- **Skill:** api, then apps-ui (mock/hybrid)
- **Inputs:** OpenAPI `TaskPatch`, `TaskPatchRequest`, `tasks-api-source.ts`, `applyTaskPatch`
- **Done when:** PATCH `alerts: null` after a task-with-alert leaves REST without `alerts` and CalDAV without `VALARM`; mock/offline clear does not keep the old reminder
- **Verify with:** `composer test -- --filter TasksCalDavInteropTest` (or new `TasksAlertPatchTest`) + targeted Vitest on mock/offline merge
- **Parallel with:** none

### Chunk B: Icon, dialog, mapping, row indicator

- **id:** `chunk-b-ui-wire`
- **Skill:** workspace, apps-ui, storybook, accessibility
- **Inputs:** Chunk A clear contract; extracted `CalendarAlarmsRows`; `TasksRemindPicker`; `TasksTaskFormFields`; `use-tasks-mutations`
- **Done when:** composer/edit open a bell icon → dialog with shared alarm rows (add/remove); OffsetTrigger ↔ form mapping with `relativeTo: end` default; list rows show display-only bell + badge; tooltip/aria-label is state-based; dialog uses Tasks copy (not Calendar “Alarms” / “At time of event”); Vitest covers set/change/clear/multi-alarm; mock-tier stories show picker + wired form
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/tasks-core src/calendar-core` then Storybook smoke for changed titles
- **Parallel with:** none

### Chunk C: Verify

- **id:** `chunk-c-verify`
- **Skill:** testing, verify-issue, clean-code
- **Inputs:** A + B
- **Done when:** browser create 30m → reload → edit clear; verify-issue on Task #651; apps + api done gates
- **Verify with:** worktree `pnpm dev` :5174; `verify-issue` on #651; `run_apps_done_gate` / `run_api_done_gate`
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI nullable `TaskPatch.alerts` → feature test PATCH-clear → implement → `composer done-gate`
- [ ] UI: mock-tier Storybook → Vitest for mapping/picker/form/mutations + calendar event dialog still green → browser on :5174
- [ ] verify-issue on Task #651 (not Goal #557)

## Doc updates (only if user wants)

- None unless a touched test fails because of stale docs
