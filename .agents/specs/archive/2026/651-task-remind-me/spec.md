Source: #651 (body-hash: 30611db1)
Goal: #557

# Task Remind me via shared alarm rows

Technical translation of Task [#651](https://github.com/WeGotWorkspace/wegotworkspace/issues/651). Product context: Goal [#557](https://github.com/WeGotWorkspace/wegotworkspace/issues/557) (set, change, or clear reminders stored as VTODO VALARM). API create/read already persist `Task.alerts`; this work makes PATCH-clear valid and wires multi-alarm Remind me into create/edit and list rows.

## Goal

Users can set, change, or clear **one or more** reminders from the task composer and edit dialog. The control is a bell **icon button** that opens a Tasks dialog wrapping extracted `CalendarAlarmsRows` (add/remove rows). Set/change persist the `Task.alerts` map (OffsetTrigger mapped to/from calendar `relatedTo`; new task offsets default `relativeTo: "end"`). Clear sends `alerts: null`. List rows show a display-only bell plus a count badge when set. Tooltip / aria-label is state-based.

## Non-goals

- In-app/PWA notification delivery (#390)
- Closed-tab push (#493)
- Re-applying an `alerts: null` clear across an offline conflict-resolution merge (`buildResolvedTaskPatch` has no `alerts` field)
- A standalone Reminders app

## Affected packages

- `packages/api` — `TaskPatch.alerts` nullable in OpenAPI + `TaskPatchRequest`; feature test for PATCH-clear
- `packages/apps` — extract `CalendarAlarmsRows`; Tasks dialog + mapping + row indicator; Vitest + mock-tier Storybook

## Technical constraints

- Widen **only** `TaskPatch.alerts` to `type: ["object", "null"]`. `Task` / `TaskCreate` stay object.
- Laravel: `'alerts' => ['sometimes', 'nullable', 'array']`. Never send `{}` on clear — `array_replace` would keep old keys.
- Mock `patchTask` must not use `??` for alerts (`null` is a clear). Offline `applyTaskPatch` maps `null` → omit/`undefined` on `Task`.
- Extract `CalendarAlarmsRows` from `CalendarAlarmsCard` and reuse it in the Tasks dialog. Do **not** drop back to the 6-preset dropdown.
- Map OffsetTrigger ↔ calendar form `relatedTo` (`RelativeAlert`). New task offsets default `relativeTo: "end"` (due). Preserve `relativeTo: "start"` when already stored.
- Dialog copy is Tasks-owned: title **Remind me**, at-due **At time of task**. Do not leak Calendar “Alarms” / “At time of event”. Pass a Tasks label adapter into `CalendarAlarmsRows`; Calendar event dialog stays on `defaultCalendarLabels`.
- Offset **presets** (5 / 10 / 15 / 30 minutes, 1 hour, 1 day) stay the shared card’s calendar strings — intentional DRY. Override only event-specific strings.
- UI: BEM + `@apply` in `tasks-main-view.css`; shared `IconButton` + `Dialog`. Render the picker inside `TasksTaskFormFields` so composer and `TasksEditDialog` both get it. List rows use `TasksRemindIndicator` (display-only).
- `createTaskFromForm` passes `alerts` on create + optimistic task. `saveEditedTask` sets `patch.alerts = next ?? null` when changed.

## Edge cases

- Choosing None / removing the last row on create omits `alerts` (no PATCH). Same on edit sends `alerts: null`.
- Leftover (non-preset) offsets render as a disabled select option and round-trip without coercion.
- Conflict-merge of a local `alerts: null` is an accepted gap (non-goal).
