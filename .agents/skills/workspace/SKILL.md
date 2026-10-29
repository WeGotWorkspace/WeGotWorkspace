---
name: workspace
description: Workspace shell layout, sidebar scrim, app-owned navigation, and settings-style feature blueprint for packages/apps. Use when working on *App, *Workspace, workspace-shell, or controller hooks.
paths:
  - "packages/apps/src/**/*-app.tsx"
  - "packages/apps/src/**/*-workspace.tsx"
  - "packages/apps/src/workspace-shell/**"
  - "packages/apps/src/**/*-core/**/use-*-controller.tsx"
  - "packages/apps/src/**/*-core/**/use-*-api.ts"
  - "packages/apps/src/**/*-core/**/*-workspace*.css"
  - "packages/apps/src/**/*-core/**/*-workspace.styles.ts"
  - "packages/apps/src/text-editor-core/docs-collab/**"
---

# WeGotWorkspace Apps — Workspace Shell

## Quick decision matrix

| Task | Read |
|------|------|
| **Which shell pattern?** (split vs collection vs custom) | [workspace-shells.md](../../../packages/apps/docs/workspace-shells.md) |
| Shell layout, sidebar, navigation, toasts | This file |
| Split product into App + Workspace + panes | [feature-blueprint.md](feature-blueprint.md) |
| Collab / text-editor hooks (`docs-collab/`, Yjs + TipTap) | [collab-hooks.md](collab-hooks.md) |
| **Browser tab titles** (`document.title`) | [document-title.md](document-title.md) |
| **Add offline support to a new app** (Dexie, outbox, sync, conflicts) | [offline-platform.md](../../../packages/apps/docs/offline-platform.md) |

## `WorkspaceAppLayout` split mode

For settings-style shells (fixed `AppSidebar` + main column with header and scroll body), use the **split** API instead of hand-rolling `<section>`, header, and scroll wrappers:

- `sidebar` — e.g. `AppSidebar` and nav.
- `mainHeader` — optional pinned header (e.g. `ViewHeader`).
- `main` — scrollable body (pane content).

Shared layout chrome lives in `workspace-app-layout.css` (`.workspace-app-layout__main*`). **Shared split-workspace tokens** (sidebar chrome, footer, primary buttons, main column `--workspace-main-content-max-width`, etc.) live in `workspace-shell/src/workspace-split-app.css` and apply to `:is(.admin-workspace, .settings-workspace)` — import that sheet from each product workspace CSS, then only set product-specific overrides on the root class. Do not duplicate those variables across admin and settings.

## `AppSidebar` mobile scrim

The dimmed full-screen scrim is **rendered inside `AppSidebar`** when `open` is true. Do not add a second scrim component beside the sidebar.

## Navigation and logout

**Workspace / feature packages must not call `window.location.assign` or router APIs** for flows the app shell should own (logout, deep links to other apps). Expose **callbacks** on workspace props (e.g. `onLogout?: () => void`) and implement navigation only in route-level **`*App`** components (or route modules).

**Lint:** `workspaceNavigationRules` in [`packages/apps/eslint.config.js`](../../../packages/apps/eslint.config.js) fails CI when a `*-workspace.tsx` or `use-*-controller.ts(x)` file uses `location` or `history`, uses `window.location` for anything but reading `.origin`, or imports `@tanstack/react-router`, a `use-*-route-sync` hook, or the app router.

## Toasts and deferred API writes

- Use **`useAppToast`** / **`useToast`** (`@/hooks/use-app-toast`, `@/hooks/use-toast`) for in-app feedback. Toasts render **`Callout`** via Sonner `toast.custom` (severity: `info` | `success` | `warning` | `error`). Prefer **`showSuccess` / `showError`** when the tone is fixed.
- For **`canUndo`**, pass `canUndo: true` with **`onUndo`**; the surface shows an Undo control on the callout.
- For **optimistic writes** with a delay and **`AbortSignal`**, use **`useQueuedMutation`** and the shared **`DeferredApiWriteArgs`** shape (or **`runQueuedBatchAction`** for batch helpers). Do not duplicate timer + abort + undo toast logic in product code.

## Local slot helpers

When split props become large, **file-private** helpers (`Sidebar`, `MainHeader`, `MainContent`) are fine. Import concrete types (`SettingsControllerState`, `WorkspaceSession`, `MenuItemProps[]` for `SidebarSection` items) from their defining modules instead of inventing local aliases like `Session` or `SidebarItem`.
