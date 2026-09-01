# Workspace shell patterns

The frontend has **three coexisting workspace shell patterns**. Pick one before building or refactoring a product workspace. This doc is the decision matrix; [feature-blueprint.md](../../.agents/skills/workspace/feature-blueprint.md) is the deep dive for the **split** pattern only.

## Patterns at a glance

| Pattern        | Entry components                                       | Typical UX                                                              |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Split**      | `WorkspaceAppLayout` (`sidebar`, `mainHeader`, `main`) | Fixed sidebar + main column with optional pinned header and scroll body |
| **Collection** | `WorkspaceApp` → `CollectionListWorkspace`             | Sidebar + list column + detail pane (mobile view-transition overlay)    |
| **Custom**     | `WorkspaceShellHeader` + bespoke layout                | Product-owned full-page chrome (lobby, room, auth)                      |

Shared layout CSS for split and collection lives under `packages/apps/src/workspace-shell/` and `packages/apps/src/workspace-app/`.

## Decision matrix

| You are building…                                                                  | Use                      | Why                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-section settings, admin, or config                                           | **Split**                | Section nav in sidebar; one pane at a time in scrollable main                                                                             |
| Installer / wizard with sidebar steps                                              | **Split**                | Same chrome as settings; wizard panes swap in `main`                                                                                      |
| File browser or document library (folder tree + main)                              | **Split**                | Tree/nav in sidebar; browser or editor in main                                                                                            |
| Meet **product** workspace (named channels + chat + optional call)                 | **Split**                | Same sidebar + main as Tasks/Docs; the call stage is a resizable rail inside `main`, not a reason to stay Custom                          |
| Mailbox, notes, or any **list + detail** collection                                | **Collection**           | Shared list/detail/mobile back behavior via `WorkspaceApp`                                                                                |
| Live `/meet` lobby + in-call room, or other **non-standard** fullscreen RTC chrome | **Custom**               | Today's routed `MeetCallWorkspace` until a later API chunk remounts `MeetWorkspace`; do **not** keep the new Meet product shell on Custom |
| Auth / marketing screen with app header only                                       | **Custom** (header only) | No workspace body chrome — see `login-core`                                                                                               |

When unsure: if the primary interaction is **pick an item from a list, show detail beside it**, use **Collection**. If it is **pick a section, show one full pane**, use **Split**.

## If building X, use Y

Agent-readable routing — read this before scaffolding a new `*-core` package:

```
IF product = multi-section config OR admin OR install wizard OR drive browser OR docs library OR Meet channel workspace
  THEN shell = split
  THEN entry = WorkspaceAppLayout(sidebar, mainHeader?, main)
  THEN blueprint = feature-blueprint.md
  THEN Meet guest stripped view = MeetGuestChannel (no channel sidebar; hideSidebarToggle)

IF product = list + detail collection (mail, notes, similar)
  THEN shell = collection
  THEN entry = WorkspaceApp with list/detail render props
  THEN inner layout = CollectionListWorkspace (via WorkspaceApp; do not mount alone in *Workspace)

IF product = live /meet lobby-room (MeetCallWorkspace) OR other fullscreen RTC chrome that cannot map to sidebar + main OR list + detail
  THEN shell = custom
  THEN entry = WorkspaceShellHeader + product root layout
  THEN do NOT force WorkspaceAppLayout or WorkspaceApp
  NOTE: do not keep new Meet product work on Custom — that shell is Split (MeetWorkspace) above

IF product = login or standalone screen with global header only
  THEN shell = custom (header only)
  THEN entry = WorkspaceShellHeader; no *Workspace split/collection wrapper
```

## `*-core` app catalog

Verified against current `*-workspace.tsx` (or equivalent) sources:

| Package                    | Shell                    | Entry file                                                                                                       |
| -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `admin-core`               | Split                    | `admin-core/src/admin-workspace.tsx`                                                                             |
| `calendar-core`            | Split                    | `calendar-core/src/calendar-workspace.tsx`                                                                       |
| `docs-core`                | Split                    | `docs-core/src/docs-workspace.tsx`                                                                               |
| `drive-core`               | Split                    | `drive-core/src/drive-workspace.tsx`                                                                             |
| `install-core`             | Split                    | `install-core/src/install-workspace.tsx`                                                                         |
| `settings-core`            | Split                    | `settings-core/src/settings-workspace.tsx`                                                                       |
| `mail-core`                | Collection               | `mail-core/src/mail-workspace.tsx`                                                                               |
| `notes-core`               | Collection               | `notes-core/src/notes-workspace.tsx`                                                                             |
| `meet-core`                | Split                    | `meet-core/src/meet-workspace.tsx` — channels + chat + optional `MeetCallStage`                                  |
| `meet-core` (live `/meet`) | Custom                   | `meet-core/src/meet-call-workspace.tsx` — lobby/room until a later API chunk remounts `MeetWorkspace`            |
| `meet-core` (guest)        | Split (stripped)         | `meet-core/src/meet-guest-channel.tsx` — `MeetGuestChannel`: one room, no channel sidebar (`hideSidebarToggle`)  |
| `login-core`               | Custom (header only)     | `login-core/src/login-screen.tsx` — not a product workspace                                                      |
| `text-editor-core`         | Split (collab submodule) | `text-editor-core/docs-collab/docs-collab-workspace.tsx` — editor primitive + docs collab demo, not a routed app |

## Required imports and CSS

### Split (`WorkspaceAppLayout`)

**TSX**

```tsx
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { ViewHeader } from "@/view-header/src/view-header";
import "@/<product>-core/src/<product>-workspace.css";
```

**CSS** — one root file per product, e.g. `settings-workspace.css`:

```css
@import "../../workspace-shell/src/workspace-split-app.css";

.<product > -workspace {
  /* product-specific tokens and descendant pane helpers only */
}
```

**Storybook** — `*-story-scope.tsx` wraps panes with `className="<product>-workspace"` and imports the workspace CSS. Full workspace stories use `layout: "fullscreen"` on `*Workspace`. Examples: `settings-story-scope.tsx`, `admin-story-scope.tsx`, `drive-story-scope.tsx`, `install-story-scope.tsx`.

**Reference:** `packages/apps/src/settings-core/src/settings-workspace.tsx`

### Collection (`WorkspaceApp` + `CollectionListWorkspace`)

**TSX**

```tsx
import { WorkspaceApp } from "@/workspace-app/src/workspace-app";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import "@/<product>-core/src/<product>-workspace.css";
// WorkspaceApp imports workspace-app.css and composes CollectionListWorkspace internally
```

**CSS** — same split tokens import on the product root class:

```css
@import "../../workspace-shell/src/workspace-split-app.css";

.<product > -workspace {
  /* list column, detail pane, swipe list overrides */
}
```

Optionally import `react-swipeable-list/dist/styles.css` when using swipe lists (mail, notes).

**Storybook** — product `*-story-scope.tsx` with variants for list column, detail pane, dialogs (see `mail-story-scope.tsx`, `notes-story-scope.tsx`). List-pane stories may mount `CollectionListWorkspace` directly with fixtures; workspace stories render full `*Workspace` fullscreen.

**Reference:** `packages/apps/src/mail-core/src/mail-workspace.tsx`

### Custom (`WorkspaceShellHeader` + bespoke layout)

**TSX**

```tsx
import { WorkspaceShellHeader } from "@/workspace-shell/src/workspace-shell-header";
import "@/<product>-core/src/<product>-workspace.css";
// Product-owned <main> regions — lobby, room, etc.
```

**CSS** — product file owns layout; meet still imports split tokens for shared chrome variables:

```css
@import "../../workspace-shell/src/workspace-split-app.css";

.<product > -workspace {
  /* full custom layout grid/flex */
}
```

**Storybook** — scope component with layout variants (see `meet-story-scope.tsx`: `root`, `in-call`, `chat-column`, …). Live `/meet` stories mount `MeetCallWorkspace`.

**Reference:** `packages/apps/src/meet-core/src/meet-call-workspace.tsx`

## Anti-patterns

- **Hand-rolling** split chrome (`<section>`, scroll wrappers, mobile detail translate) when `WorkspaceAppLayout` split props or `WorkspaceApp` already provide it.
- **Mounting `CollectionListWorkspace` directly** in `*Workspace` instead of going through `WorkspaceApp` (loses sidebar/detail mobile orchestration).
- **Using split layout for mail/notes-style** list+detail — you lose shared back button, empty states, and mobile view-transition overlay.
- **Keeping the new Meet product shell on Custom** — `MeetWorkspace` is Split (channels + chat + optional call). Custom is only for live `MeetCallWorkspace` (lobby/room) until the `/meet` route flips.
- **Forcing `WorkspaceAppLayout` on live lobby/room RTC** (`MeetCallWorkspace`) — that chrome stays bespoke until a later API chunk.
- **Second mobile scrim** beside `AppSidebar` — scrim is rendered inside `AppSidebar` when open.
- **Navigation in `*-core`** — no `window.location` or router calls; expose `onLogout` / callbacks from `*App` (see workspace skill).
- **Duplicating `workspace-split-app.css` variables** per product — import the shared sheet and override only on `.<product>-workspace`.

## Reference implementations

| Pattern    | Canonical file                                               |
| ---------- | ------------------------------------------------------------ |
| Split      | `packages/apps/src/settings-core/src/settings-workspace.tsx` |
| Collection | `packages/apps/src/mail-core/src/mail-workspace.tsx`         |
| Custom     | `packages/apps/src/meet-core/src/meet-call-workspace.tsx`    |

Additional split references: `admin-workspace.tsx`, `drive-workspace.tsx`, `install-workspace.tsx`, `docs-workspace.tsx`, `meet-workspace.tsx`.

### Install-specific deviations

- **`useInstallAPI`** follows the shared `useWorkspaceApi` bootstrap (`data`, `session`, `operations`) like settings/admin, but **`InstallWorkspace` does not take `session`** — the installer runs before login, so sidebar chrome uses a **step progress footer** instead of `WorkspaceUserFooter`. Mock/live bootstraps still carry `mockWorkspaceSession` for API symmetry; stories use `createInstallWorkspaceStoryArgs()` to omit `session` from workspace args.

## Related docs

- Split feature layers, panes, controller hooks: [feature-blueprint.md](../../.agents/skills/workspace/feature-blueprint.md)
- Browser tab titles (`document.title`): [document-title.md](../../.agents/skills/workspace/document-title.md)
- Shell scrim, toasts, navigation ownership: [workspace SKILL.md](../../.agents/skills/workspace/SKILL.md)
- Shell migration status: [rollout-pattern.md](./rollout-pattern.md)
