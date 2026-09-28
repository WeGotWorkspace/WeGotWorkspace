Source: #973 (body-hash: 751c8d1a)
Goal: #971

# App settings registry and dual host

Technical translation of Task #973. Dual-home settings: Settings app catalog plus an in-app dialog that renders the same panel. This delivery is architecture plus the existing Mail IMAP pane, not empty app panels.

## Goal

A compile-time contribution registry in `settings-core` drives Settings nav and a shared `SettingsPanelHost`. Product workspaces get a Settings row above the avatar that opens that app’s panel in a dialog. Mail IMAP (already live in Settings) is the first app panel. Empty apps hide the row.

## Non-goals

- Empty Calendar / Contacts / Tasks / Notes / Drive / Docs / Meet panels
- Notification prefs table, OpenAPI, hub host, or tray control moves
- Calendar timezone / working hours / locale content (#617)
- MCP Connected assistants grant/revoke rewrite (#462 pane is migrated, not rewritten)
- Admin / Install / Meet-guest / plugin settings
- Dialog URL sync
- Shipping the Mail client
- `GET /capabilities` from the shell (login-only today)

## Affected packages

- packages/apps (`settings-core`, `workspace-shell`, product `*-workspace.tsx`, `wegotworkspace` shell)
- packages/apps/docs/workspace-shells.md (short note)

## Technical constraints

- `settings-core` must not import product cores. Product cores may import `settings-core`.
- `WorkspaceSidebarAccountFooter` is presentational in `workspace-shell` (no settings-core import).
- Footer hook must not call `useSettingsAPI` or `GET /capabilities`.
- `registerBuiltinSettings()` is an explicit call (package `sideEffects` allowlist would tree-shake a side-effect-only import).
- `openPanel(id: BuiltinPanelId)` is strict. Footer/JIT uses `openRegisteredPanel(panel: SettingsPanel)`.
- `SettingsPanelId = string` at registry/URL level. Do not write `BuiltinPanelId | string`.
- Gate bodies use `flag === true` (missing shell flag = hide).
- No new first SPA path segment (`/settings` + `/settings/$section` only).
- Dual-placement fixture is test-only; no production Notifications panel.

## Edge cases

- `/settings/assistants` while MCP off still replace-navigates to Profile
- `registerBuiltinSettings()` twice is a no-op; foreign duplicate ids throw
- `resetSettingsRegistryForTests` clears the builtin-registered flag
- Dismiss restores focus to the footer Settings control
- Open in Settings discards dirty state and must not restore focus to the unmounted opener
- Mail save emits `notifySettingsSliceSaved`; no mail-core subscriber in this Task
