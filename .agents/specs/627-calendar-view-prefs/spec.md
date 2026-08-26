Source: #627 (body-hash: d4e6017b)
Goal: #619

# Persist Calendar view preferences on this device

Technical translation of Task #627 — device-local `localStorage` for hidden calendars and last view/presentation. No API.

## Goal

Calendar remounts and later visits on the same browser restore the user's hidden-calendar set and last time-range view + grid/list presentation. Bare `/calendar` hydrates from stored prefs; an explicit `/calendar/:view/:date` (or list) path still wins. Date/anchor is not persisted.

## Non-goals

- Cross-device or account-synced prefs
- Persisting the date/anchor (new visit uses today)
- Calendar settings (timezone, working hours, locale) — Goal #617

## Affected packages

- packages/apps (`calendar-core`)

## Technical constraints

- Follow the Drive/Docs `persisted-view-mode` pattern: named storage key, parse/read/write helpers that swallow quota/private-mode failures
- Keep `calendarStateFromLocation` injectable (optional fallback prefs) so route parsing stays testable without implicit storage
- Persist on user change (hide/show, view, presentation) and when an explicit URL hydrates the controller
- Hidden IDs are filtered to calendars that still exist; unknown IDs are dropped
- Server `isVisible: false` still seeds hidden state when no stored override exists for that id
- Persist the calendar ids this device has already seen so an explicit un-hide of a server-default-hidden calendar survives reload; only genuinely new calendars take the server default

## Edge cases

- Missing, corrupt, or throwing `localStorage` → defaults (month + grid; hide only `isVisible: false`)
- Cleared site data → same defaults
- New calendars after persist → visible unless `isVisible: false`
- Auto-show (create/move onto a hidden calendar, sidebar select) must persist the updated hidden set
