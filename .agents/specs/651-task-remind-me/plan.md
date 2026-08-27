# Task Remind me picker

Derived from [spec.md](./spec.md). Sequential chunks (shared form + mutations + a small API contract).

## Goal

Make PATCH-clear of `Task.alerts` valid, then wire Remind me into create/edit so set/change/clear persist as VALARM.

## Non-goals

- In-app notification scheduler (#390)
- Closed-tab push (#493)
- Reminder icon on `TaskRow`
- Calendar alarm UI
- Conflict-merge of `alerts: null` (`buildResolvedTaskPatch`)
- Capabilities / parity-doc rewrites

## Affected packages

- packages/api
- packages/apps

## Dependencies

1. Chunk A (PATCH-clear + mock/offline) before Chunk B clear-on-edit
2. Chunk B (UI + mutations) after A
3. Chunk C (verify) after A + B

## Chunks

### Chunk A: PATCH-clear alerts

- **id:** `chunk-a-api-clear`
- **Skill:** api, then apps-ui (mock/hybrid)
- **Inputs:** OpenAPI `TaskPatch`, `TaskPatchRequest`, `tasks-api-source.ts`, `applyTaskPatch`
- **Done when:** PATCH `alerts: null` after a task-with-alert leaves REST without `alerts` and CalDAV without `VALARM`; mock/offline clear does not keep the old reminder
- **Verify with:** `composer test -- --filter TasksCalDavInteropTest` (or new `TasksAlertPatchTest`) + targeted Vitest on mock/offline merge
- **Parallel with:** none

### Chunk B: Wire Remind me on create/edit

- **id:** `chunk-b-ui-wire`
- **Skill:** workspace, apps-ui, storybook, accessibility
- **Inputs:** Chunk A clear contract; `TasksRemindPicker`, `TasksTaskFormFields`, `use-tasks-mutations`
- **Done when:** create can set a reminder; edit can change or clear; control is a composer meta chip (Radix + BEM); Vitest covers set/change/clear; mock-tier stories show picker + wired form
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/tasks-core` then Storybook smoke for changed titles
- **Parallel with:** none

### Chunk C: Verify

- **id:** `chunk-c-verify`
- **Skill:** testing, verify-issue, clean-code
- **Inputs:** A + B
- **Done when:** browser create 30m → reload → edit None; verify-issue on Task #651; apps + api done gates
- **Verify with:** worktree `pnpm dev` :5174; `verify-issue` on #651; `run_apps_done_gate` / `run_api_done_gate`
- **Parallel with:** none

## Test plan

- [ ] API: OpenAPI nullable `TaskPatch.alerts` → feature test PATCH-clear → implement → `composer done-gate`
- [ ] UI: mock-tier Storybook → Vitest for utils/form/mutations → browser on :5174
- [ ] verify-issue on Task #651 (not Goal #557)

## Doc updates (only if user wants)

- None unless a touched test fails because of stale docs
