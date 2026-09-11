# Drive Core Reuse Guide

`drive-core` exposes reusable building blocks for file-browser apps with grid/list views, batch actions, and Docs handoff.

## Shell pattern

**Split** — `DriveWorkspace` composes `WorkspaceAppLayout` with `sidebar`, `mainHeader`, and `main` slots (`AppSidebar`, `ViewHeader`, `DriveMainPane`). See [feature blueprint](../../../../.agents/skills/workspace/feature-blueprint.md).

## Reusable exports

Public (`src/drive-core/src/index.ts`):

- `DriveApp` (`src/drive-core/src/drive-app.tsx`)
- `DriveWorkspace` (`src/drive-core/src/drive-workspace.tsx`)
- `DriveAPIOperations`, `DriveUIData`, `DriveAppBootstrap` (`src/drive-core/src/drive-types.ts`)
- `driveLabels` (`src/drive-core/src/drive-labels.ts`)

Internal composition (import from `@/drive-core/src/…` in stories or sibling packages):

- `useDriveController` (`src/drive-core/src/use-drive-controller.tsx`) — thin composer (~200 lines)
- `useDriveShell`, `useDriveList`, `useDriveMutations` — shell navigation, list/selection, and mutation slices
- `useDriveAPI` (`src/drive-core/src/use-drive-api.ts`)
- `DriveMainPane`, `DriveDetailActionBar`, `DriveNewMenu`
- `DriveGridView`, `DriveListView` (`src/drive-core/src/drive-browser.tsx`)
- `DriveDetailPanel` (`src/drive-core/src/drive-detail-panel.tsx`) — DocsCollabSidebarPanel shell; docked via WorkspaceAppLayout `panel` / SideDrawer
- `DriveMoveToDialog`, `DriveFolderPicker`, `DriveMediaPreview`

## Provider wiring

Implement `DriveAPIOperations` (or inject `DriveApiSource` via `createDefaultDriveApiSource`) and pass `data`, `session`, and `operations` into `DriveWorkspace`.

`DriveApp` wires `useDriveAPI` → `WorkspaceLiveAppShell` → `DriveWorkspace`, including route-driven view state (`drive-route-search.ts`).

## Styling

Pane and browser styling lives under `.drive-workspace` in `drive-workspace.css` (grid/list, selection bar, modals). Storybook pane stories wrap components in `stories/drive-story-scope.tsx` (`DriveStoryScope`) so the same root class applies as production.

## Storybook

| Story                                        | Purpose                                        |
| -------------------------------------------- | ---------------------------------------------- |
| `Apps/Drive`                                 | Full workspace with mock bootstrap             |
| `Apps/Drive/Panes/DriveMainPane`             | Main column (grid/list, selection, detail)     |
| `Apps/Drive/Components/DriveDetailActionBar` | Detail toolbar variants                        |
| `Apps/Drive/Components/DriveNewMenu`         | New file/folder menu                           |
| `Apps/WeGotWorkspace`                        | Full shell (login → home → all apps, mock API) |

## Further reading

- [Workspace feature blueprint](../../../../.agents/skills/workspace/feature-blueprint.md) — `*App` / `*Workspace` / controller / pane split
- [Apps docs index](../../docs/README.md)
