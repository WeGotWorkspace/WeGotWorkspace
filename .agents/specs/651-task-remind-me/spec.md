Source: #651 (body-hash: 174900b1)
Goal: #557

# Task Remind me picker on create and edit

Technical translation of Task [#651](https://github.com/WeGotWorkspace/wegotworkspace/issues/651). Product context: Goal [#557](https://github.com/WeGotWorkspace/wegotworkspace/issues/557) (set, change, or clear a reminder stored as VTODO VALARM). API create/read already persist `Task.alerts`; this work makes PATCH-clear valid and wires the existing picker into the shared create/edit form.

## Goal

Users can set, change, or clear a single reminder from the task composer and edit dialog. The control is a composer meta chip (Radix + BEM). Set/change persist `Task.alerts` (OffsetTrigger `relativeTo: "end"` or AbsoluteTrigger). Clear sends `alerts: null` so REST omits `alerts` and CalDAV storage has no `VALARM`. Mock, hybrid/offline, and live REST all persist set and clear.

## Non-goals

- In-app/PWA notification delivery (#390)
- Closed-tab push (#493)
- Reminder icon / chrome on list rows
- Calendar multi-alarm UI (`CalendarAlarmsCard`)
- Capabilities advertising or stale parity-doc cleanup
- Re-applying an `alerts: null` clear across an offline conflict-resolution merge (`buildResolvedTaskPatch` has no `alerts` field)

## Affected packages

- `packages/api` — `TaskPatch.alerts` nullable in OpenAPI + `TaskPatchRequest`; feature test for PATCH-clear
- `packages/apps` — mock/offline clear, form value, Remind picker chip, create/edit mutations, Vitest + mock-tier Storybook

## Technical constraints

- Widen **only** `TaskPatch.alerts` to `type: ["object", "null"]`. `Task` / `TaskCreate` stay object.
- Laravel: `'alerts' => ['sometimes', 'nullable', 'array']`. Never send `{}` on clear — `array_replace` would keep old keys.
- Mock `patchTask` must not use `??` for alerts (`null` is a clear). Offline `applyTaskPatch` maps `null` → omit/`undefined` on `Task`.
- Reuse `TasksRemindPicker` presets (`none | at-due | 30m | 1h | 1d | custom`) and helpers in `tasks-task-utils.ts`. Do not reuse `CalendarAlarmsCard`.
- UI: BEM + `@apply` in `tasks-main-view.css`; no Tailwind-in-TSX on the picker. Shared `COMPOSER_SELECT_*` classes. Render inside `TasksTaskFormFields` so composer and `TasksEditDialog` both get it.
- `createTaskFromForm` passes `alerts` on create + optimistic task. `saveEditedTask` sets `patch.alerts = next ?? null` when changed.

## Edge cases

- Choosing None on create omits `alerts` (no PATCH). Choosing None on edit sends `alerts: null`.
- Custom preset uses `datetime-local` (popover or second row) and `AbsoluteTrigger`.
- Conflict-merge of a local `alerts: null` is an accepted gap (non-goal).
