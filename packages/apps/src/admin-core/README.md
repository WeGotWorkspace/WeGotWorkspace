# Admin Core Reuse Guide

`admin-core` exposes reusable building blocks for settings-style admin consoles: section nav, wizard panes, and user/group management modals.

## Shell pattern

**Split** — `AdminWorkspace` composes `WorkspaceAppLayout` with `sidebar`, `mainHeader`, and `main` slots. One pane per admin section from `useAdminController` (thin composer over `useAdminShell` + `useAdminMutations`). See [feature blueprint](../../../../.agents/skills/workspace/feature-blueprint.md).

## Reusable exports

Public (`src/admin-core/src/index.ts`):

- `AdminApp` (`src/admin-core/src/admin-app.tsx`)
- `AdminWorkspace` (`src/admin-core/src/admin-workspace.tsx`)
- `useAdminAPI`, `createDefaultAdminApiSource` (`src/admin-core/src/use-admin-api.ts`, `admin-api-source.ts`)
- `AdminAPIOperations`, `AdminUIData`, `AdminSection`, and domain settings types (`src/admin-core/src/admin-types.ts`)
- `AdminControllerState`, `useAdminShell`, `useAdminMutations` (`src/admin-core/src/use-admin-controller.tsx`, `use-admin-shell.tsx`, `use-admin-mutations.tsx`)

Pane components (import from `@/admin-core/src/…`):

- `AdminUsersPane`, `AdminBackupsPane`, `AdminUpdatesPane`, `AdminMailPane`
- `AdminWebdavPane`, `AdminSearchPane`, `AdminPluginsPane`, `AdminRealtimeCollaborationPane`
- `AdminWorkspaceModals`, `FeatureRow` (`admin-workspace-widgets.tsx`)

## Provider wiring

Implement `AdminAPIOperations` (or inject `AdminApiSource`) and pass `data`, `session`, and `operations` into `AdminWorkspace`.

`AdminApp` wires `useAdminAPI` → `WorkspaceLiveAppShell` → `AdminWorkspace`. Mock bootstrap: `createAdminAppBootstrap` in `@/lib/api/mock/admin-bootstrap`.

## Styling

Section and form styling lives under `.admin-workspace` in `admin-workspace.css` and `admin-panes.css` (feature rows, wizard footers, `--field-label-color`). Pane stories wrap content in `stories/admin-story-scope.tsx` (`AdminStoryScope`) for the workspace root class.

## Storybook

| Story                              | Purpose                                        |
| ---------------------------------- | ---------------------------------------------- |
| `Branding/Admin`                   | Full workspace chrome + branding knobs         |
| `Shared/Admin/Panes/Users`         | User and group management                      |
| `Shared/Admin/Panes/Backups`       | Backup configuration                           |
| `Shared/Admin/Panes/Updates`       | Update channel / version state                 |
| `Shared/Admin/Panes/Mail`          | IMAP/SMTP settings                             |
| `Shared/Admin/Panes/WebDAV`        | WebDAV credentials and paths                   |
| `Shared/Admin/Panes/Search`        | Unified search indexing                        |
| `Shared/Admin/Panes/Plugins`       | Plugin enablement                              |
| `Shared/Admin/Panes/Collaboration` | RTC / STUN / TURN settings                     |
| `Shared/WeGotWorkspace`            | Full shell (login → home → all apps, mock API) |

## Further reading

- [Workspace feature blueprint](../../../../.agents/skills/workspace/feature-blueprint.md) — settings-style pane building blocks
- [Apps docs index](../../docs/README.md)
