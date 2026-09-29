Source: #981 (body-hash: e57dee26)
Goal: #617

# Calendar settings pane (timezone, working hours, locale)

Technical translation of Task #981. Calendar gets a real Settings pane on the app-settings registry from #973. Prefs are device-local (`localStorage`), not a new API.

## Goal

Register a reachable Calendar panel under Settings → Apps. The same pane opens from the Calendar workspace footer dialog. Saving timezone, working hours, and locale persists on this device and applies to Calendar views (labels, first day of week, grid timezone, timed-event default, day/week visible-hours window).

## Non-goals

- API / OpenAPI / cross-device sync
- Working-hours shading or a second timezone on the grid (#527)
- Per-event timezone editor (already shipped)
- Instance-wide admin locale / timezone defaults
- Default-calendar picker, iMIP account, notification prefs
- Persisting hidden calendars (#619 / #627)
- Empty placeholder copy or a production Notifications hub

## Affected packages

- packages/apps (`lib/` display prefs, `settings-core` pane + registry, `calendar-core` controller/surface, Lit view-group/surface)

## Technical constraints

- `settings-core` must not import `calendar-core`. Shared timezone list and display-prefs helpers live in `packages/apps/src/lib/`.
- Storage follows `calendar-view-prefs` (device `localStorage`, swallow quota / private-mode failures).
- Empty timezone / locale = device / browser default.
- Omitted or invalid working hours = full 24-hour grid. When both hours are set and start < end, `visibleHours = end - start` and `visibleHoursStart = start`.
- After save, `notifySettingsSliceSaved({ panelId: "calendar", sliceId: "calendar-display" })` so a mounted Calendar workspace refreshes without reload.
- Do not export `SettingsCalendarPane` from `settings-core` `index.ts`; add a Storybook story.
- Do not grow baselined `use-calendar-controller.ts` or `calendar-workspace.tsx`.
- `openPanel("calendar")` is a `BuiltinPanelId`. Footer already uses `appId="calendar"`.

## Edge cases

- Unset working hours, or start ≥ end, keep a 24-hour grid
- Stored IANA id not in the curated list still appears in the timezone select
- `registerBuiltinSettings()` remains idempotent; Calendar sits next to Mail under Apps
- jsdom without `Intl.Locale.getWeekInfo` falls back to Monday (1)
