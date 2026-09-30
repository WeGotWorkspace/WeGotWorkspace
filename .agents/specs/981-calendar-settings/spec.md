Source: #981 (body-hash: e57dee26)
Goal: #617

# Calendar settings pane (timezone, day starts on, default calendar)

Technical translation of Task #981. Calendar gets a real Settings pane on the app-settings registry from #973. Prefs are device-local (`localStorage`), not a new API.

## Goal

Register a reachable Calendar panel under Settings → Apps. The same pane opens from the Calendar workspace footer dialog. Saving timezone, day-starts-on, and the default calendar persists on this device and applies to Calendar views (first day of week, grid timezone, now line, today, timed-event default) and invitation RSVP targets. Timed events with a zone convert into the display timezone on the grid, including card time labels.

## Non-goals

- API / OpenAPI / cross-device sync
- Working hours / visibleHours window (removed from this pane)
- Working-hours shading or a second timezone on the grid (#527)
- Per-event timezone editor (already shipped)
- Instance-wide admin locale / timezone defaults
- Calendar-only language / locale UI (wait for workspace-wide i18n)
- iMIP account, notification prefs
- Persisting hidden calendars (#619 / #627)
- Empty placeholder copy or a production Notifications hub

## Affected packages

- packages/apps (`lib/` display prefs, `settings-core` pane + registry, `calendar-core` controller/surface, Lit view-group/surface)

## Technical constraints

- `settings-core` must not import `calendar-core`. Shared timezone list, display-prefs helpers, and the calendar color picker live in `packages/apps/src/lib/`.
- Storage follows `calendar-view-prefs` (device `localStorage`). Writes return false on quota / private-mode failures so the form shows an error toast instead of “saved”.
- Empty timezone = device default. Calendar labels follow the browser locale until workspace i18n exists. A previously stored `locale` key is ignored on read and stripped on write.
- Empty week start = browser first weekday (`getLocaleWeekInfo`, Monday when unknown). Day-starts-on offers browser default, Monday, and Sunday (Google/Apple-style). Stored ISO 1–7 still applies if present.
- Timed events convert from `data.timeZone` into the display IANA zone at render time; all-day and floating wall clocks stay put. Engine storage keeps original wall clocks. Card labels use the converted display times.
- Empty default calendar id = writable `isDefault` / first writable collection. Settings trigger shows color + calendar name. A stored id that is missing or not writable falls back to the first writable calendar; the Settings pane marks the form dirty with that fallback.
- After save, `notifySettingsSliceSaved({ panelId: "calendar", sliceId: "calendar-display" })` so a mounted Calendar workspace refreshes without reload. Other tabs fire a `storage` event that is re-emitted into the same bus.
- Do not export `SettingsCalendarPane` from `settings-core` `index.ts`; add a Storybook story.
- Do not grow baselined `use-calendar-controller.ts` or `calendar-workspace.tsx`.
- `openPanel("calendar")` is a `BuiltinPanelId`. Footer already uses `appId="calendar"`.
- Settings dialog is single-layer (no Card). Footer: Open in Settings outline + `me-auto`; Cancel outline; Save primary at the end when the pane registers a save handler.

## Product overrides vs original Task

Owner request during implementation (issue body-hash unchanged; `gh issue edit` was not available):

- Timezone must move the grid (now line, today, zoned event placement and card times), not only the new-event default
- Remove working hours from the pane
- Add Day starts on with a browser-default option; Monday and Sunday only (not all seven weekdays)
- Hide Language until workspace-wide i18n
- Default calendar (incoming invites) is the first control, reusing the event-dialog calendar dropdown with the name visible on the closed trigger
- Dialog: no Card; Save primary at the end; Cancel next to it; Open in Settings on the other corner, not primary

## Edge cases

- Stored IANA id not in the curated list still appears in the timezone select
- `registerBuiltinSettings()` remains idempotent; Calendar sits under Apps (Mail is hidden from nav)
- jsdom without `Intl.Locale.getWeekInfo` falls back to Monday (1)
- Cross-midnight zoned events stay visible after converting into the display zone
- A stored week start other than Monday/Sunday still appears in the select until changed
