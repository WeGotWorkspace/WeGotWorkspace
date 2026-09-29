Source: #981 (body-hash: e57dee26)
Goal: #617

# Calendar settings pane (timezone, locale, day starts on)

Technical translation of Task #981. Calendar gets a real Settings pane on the app-settings registry from #973. Prefs are device-local (`localStorage`), not a new API.

## Goal

Register a reachable Calendar panel under Settings → Apps. The same pane opens from the Calendar workspace footer dialog. Saving timezone, locale, and day-starts-on persists on this device and applies to Calendar views (labels, first day of week, grid timezone, now line, today, timed-event default). Timed events with a zone convert into the display timezone on the grid.

## Non-goals

- API / OpenAPI / cross-device sync
- Working hours / visibleHours window (removed from this pane)
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
- Empty week start = locale first weekday (`getLocaleWeekInfo`, Monday when unknown).
- Timed events convert from `data.timeZone` into the display IANA zone at render time; all-day and floating wall clocks stay put. Engine storage keeps original wall clocks.
- After save, `notifySettingsSliceSaved({ panelId: "calendar", sliceId: "calendar-display" })` so a mounted Calendar workspace refreshes without reload.
- Do not export `SettingsCalendarPane` from `settings-core` `index.ts`; add a Storybook story.
- Do not grow baselined `use-calendar-controller.ts` or `calendar-workspace.tsx`.
- `openPanel("calendar")` is a `BuiltinPanelId`. Footer already uses `appId="calendar"`.
- Settings dialog is single-layer (no Card). Footer: Open in Settings outline + `me-auto`; Cancel outline; Save primary at the end when the pane registers a save handler.

## Product overrides vs original Task

Owner request during implementation (issue body-hash unchanged; `gh issue edit` was not available):

- Timezone must move the grid (now line, today, zoned event placement), not only the new-event default
- Remove working hours from the pane
- Add Day starts on with a locale-default option
- Dialog: no Card; Save primary at the end; Cancel next to it; Open in Settings on the other corner, not primary

## Edge cases

- Stored IANA id not in the curated list still appears in the timezone select
- `registerBuiltinSettings()` remains idempotent; Calendar sits next to Mail under Apps
- jsdom without `Intl.Locale.getWeekInfo` falls back to Monday (1)
- Cross-midnight zoned events stay visible after converting into the display zone
