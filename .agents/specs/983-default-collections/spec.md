Source: #983 (body-hash: 3c10a483)
Goal: #971

# Default list, address book, and notebook settings

Technical translation of Task #983. Tasks, Contacts, and Notes each get a one-control Settings pane on the #973 registry. Prefs are device-local (`localStorage`), not a new API. The saved id is the create target when the sidebar is on All.

## Goal

Register reachable Tasks, Contacts, and Notes panels under Settings → Apps. The same pane opens from each workspace footer dialog. Saving the default collection persists on this device and is the destination for the primary New button while All Tasks / All contacts / All Items is selected. A single-collection sidebar view still creates into that collection.

## Non-goals

- API / OpenAPI / cross-device sync
- Extra settings on these panes
- Changing Calendar Default calendar (incoming-invite target stays)
- Drive / Docs / Meet panels
- Workspace-wide i18n
- Empty placeholder copy

## Affected packages

- packages/apps (`lib/` prefs + picker collections, `settings-core` panes + registry, `tasks-core` / `contacts-core` / `notes-core` create-target helpers)

## Technical constraints

- `settings-core` must not import product cores. Shared prefs, collection loaders, and the color+name picker live in `packages/apps/src/lib/`.
- Storage follows Calendar display prefs (device `localStorage`, swallow quota / private-mode failures). Empty id = existing app fallback (Tasks Inbox / Contacts `isDefault` / Notes first personal notebook).
- Settings trigger shows color + collection name (`CalendarEventCalendarPicker` `showName`).
- After save, `notifySettingsSliceSaved({ panelId, sliceId })` so a mounted workspace refreshes the New target without reload.
- Do not export the new panes from `settings-core` `index.ts`; add Storybook stories.
- Do not grow baselined `use-contacts-controller.tsx`, `contacts-edit-utils.ts`, or `use-notes-mutations.tsx`. A shrink must lower the ratchet integer.
- `openPanel("tasks" | "contacts" | "notes")` is a `BuiltinPanelId`. Footers already pass `appId`.
- Settings dialog is single-layer (no Card). Footer chrome is the existing Save / Cancel / Open in Settings pattern.

## Edge cases

- Stored id missing from the writable set falls back to the app default
- Sidebar `list:` / `book:` / `nb:` views ignore the setting
- Notes Starred / Archive New still goes through All Items, then the saved notebook
- `registerBuiltinSettings()` remains idempotent; Apps nav is Mail, Calendar, Tasks, Contacts, Notes
- Drive / Docs / Meet still hide the footer Settings row
