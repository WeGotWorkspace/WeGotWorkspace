# Workspace feature blueprint (split shell)

> **Shell choice first.** This document applies to the **split** pattern (`WorkspaceAppLayout`). For mail/notes-style **collection** or meet-style **custom** shells, read [workspace-shells.md](../../../packages/apps/docs/workspace-shells.md) before refactoring.

Use **`packages/apps/src/settings-core/`** as the reference when splitting a product into a thin route **`*App`**, a composable **`*Workspace`**, a **controller** hook, and **panes**. Aligns with the workspace shell skill for `WorkspaceAppLayout`, `AppSidebar`, and navigation ownership.

## When this blueprint applies

| Shell | Use this blueprint? | Entry |
|-------|---------------------|-------|
| Split (settings, admin, drive, docs) | **Yes** | `WorkspaceAppLayout` |
| Collection (mail, notes) | **No** — list/detail via `WorkspaceApp` | [workspace-shells.md](../../../packages/apps/docs/workspace-shells.md) |
| Custom (installer, login header) | **No** — bespoke layout | [workspace-shells.md](../../../packages/apps/docs/workspace-shells.md) |

## Layers (top to bottom)

1. **`*App.tsx`** — Wiring only: `use*API` (or injectable `apiSource`), `WorkspaceLiveAppShell` (loading / error / `successVersion` remount), render **`*Workspace`** with `data`, `session`, `operations`, and **callbacks** for shell-owned navigation (`onLogout`, etc.). No feature layout here beyond the live shell.
2. **`*Workspace.tsx`** — `WorkspaceAppLayout` split (`sidebar`, `mainHeader`, `main`). Root **`className={cn("<product>-workspace", className)}`** imports **one shell CSS file** (tokens + descendant pane helpers). **File-private** helpers (`Sidebar`, `MainHeader`, `MainContent`, footer) keep this file readable; pass **typed controller state** into children.
3. **`use*Controller`** — Holds **shell state** (section nav, `sidebarOpen`, sidebar item model) together with **domain slices** (`use*ProfileForm`, `use*MailForm`, …) when the shell is small and only composed here. If shell logic grows large, extract a dedicated **`use*Shell`** hook again and call it from the controller.
4. **`*WorkspaceProps`** — Explicit contract: `data` (UI/bootstrap shape), `session` (`WorkspaceSession` for chrome/footer), optional `operations`, optional `className` / `onLogout`. **Session drives chrome** (footer, avatars); **data drives forms** — mocks/stories must align both (see `createSettingsAppBootstrap`).
5. **Panes** — **`SettingsProfilePane`**, **`SettingsMailPane`**, etc.: presentational; receive **only the slice** they need (`profile`, `mail`, …). Use the **shared pane building blocks** below — do **not** add product-prefixed clones (`InstallField`, `InstallCard`, …).
6. **`*workspace.css`** — Scoped to **`.<product>-workspace`**: CSS variables for sidebar, footer, buttons, **`--field-label-color`** (shared with `field-label-row__label`). Descendant utilities (**`settings-form-field`**, **`settings-grid-2`**, …) instead of repeating a long BEM prefix on every node. Read-only display rows: **`FieldLabelRow` + `Input readOnly`**; shell may style via **`.<product>-workspace .field-label-row:has(input[readonly]) .input`** so inputs need no extra `className`.

## Shared pane building blocks (reuse, do not reimplement)

Structural refactors must still compose **existing** UI from `packages/apps/src/`. Layout/spacing tokens live in **`*-workspace.css`**; components stay shared.

| Need | Use | Reference |
|------|-----|-----------|
| Section surface + title | **`Card`** (`@/card/src/card`) | `settings-profile-pane.tsx`, `admin-meet-pane.tsx` |
| Label + control (uncontrolled / controller state) | **`FieldLabelRow`** + **`Input`** / **`Select`** / **`Switch`** | `admin-mail-pane.tsx`, `admin-meet-pane.tsx` |
| Label + control (react-hook-form + zod) | **`Form`** + **`FormTextField`** + **`FormSaveActionRow`** | `settings-profile-pane.tsx` |
| Boolean row with title + description | **`FeatureRow`** pattern: copy **`admin-workspace-widgets.tsx`** `FeatureRow` markup and add **`.<product>-feature-row`** rules in **`*-workspace.css`** (same structure as `admin-panes.css`) — do not invent a second TS wrapper per product unless promoting to `@/ui` |
| Primary / ghost actions | **`Button`** / **`IconButton`** (`@/button/src/button`) with workspace CSS variables on the root class — no `*PrimaryButton` wrappers |
| Sidebar nav | **`AppSidebar`** + **`SidebarSection`** + **`MenuItemProps`** — not `settings-sidebar` `SidebarGroup` / `SidebarLink` |
| Main column header | **`ViewHeader`** — not a bespoke `<header>` |

**Form strategy:**

- **Settings-style** (per-section save, RHF dirty state): `use*ProfileForm` + `Form` / `FormTextField` / `FormSaveActionRow` + `*WorkspacePaneClasses.formTextField`.
- **Wizard / admin-style** (controller `useState`, Next at bottom): `FieldLabelRow` + primitives only; validation stays in the controller. Do **not** skip shared `Card` / `FieldLabelRow` because the flow is not RHF.

**Hints / errors under fields:** prefer a shared pattern in workspace CSS (e.g. `.field-label-row + .<product>-field-hint`) applied beside **`FieldLabelRow`**, not a custom `*Field` component with its own label styles.

**Promote to `@/ui` only when** the same control appears in **two or more products** with identical behavior (e.g. password reveal toggle). Until then, `Input type="password"` or local pane markup is fine.

## Data and API

- **`use*API`**: `useMemo` default **`*ApiSource`**, **`placeholderData`** for stable loading shape, **`useWorkspaceApi`** with `loadBootstrap`, `createOperations`, `fallbackSession`. Keeps Storybook and routes consistent.
- **Operations** optional on props/hooks so panes render without writes in stories.
- **Target DI pipeline:** App → `operations` → controller → pane slices — see [apps-ui/components.md](../apps-ui/components.md). Legacy direct `@/lib/api/wgw` imports in controllers are tech debt; file refactor issues rather than copying the pattern.
- **Toasts / saves**: domain hooks (`useSettingsProfileForm`) use **`useRunWithAppToast`** (or project equivalent) around server calls; keep **zod** schema + **`settingsProfileFormToRequest`**-style mappers next to the schema file.

## Shell chrome

- **Sidebar**: `AppSidebar` + **`SidebarSection`**; items as **`MenuItemProps[]`** from controller (`selected`, `onClick`). Footer: **`WorkspaceUserFooter`** + `workspaceUserInitials(session.user)`.
- **Main header**: **`ViewHeader`** with section label/description from shell model and **`sidebarOpen` / toggle** from controller.
- **Main body**: Switch or conditional render **one pane per section**; avoid mounting all panes at once unless needed.

## Refactoring another app toward this shape

- [ ] If nav / layout state is tangled with data fetching, peel **`use*Shell`** (or similar) out of **`use*Controller`** once it earns its own file.
- [ ] **`use*Controller`** composes shell state + domain hooks; **`Workspace`** passes `Pick<Props, "data" | "operations">` (or the same shape settings uses).
- [ ] Move layout from route files into **`*Workspace.tsx`** using **`WorkspaceAppLayout`** split props.
- [ ] Replace inline `window.location` / logout in packages with **`onLogout`** (or similar) props implemented in **`*App`**.
- [ ] Colocate **shell CSS variables** on the workspace root class (e.g. `.settings-workspace`); panes use **shared caption** patterns (`field-label-row__label`, `--field-label-color`).
- [ ] Panes use **`Card`**, **`FieldLabelRow`**, and (where applicable) **`Form` / `FormTextField`** — delete any interim `*Card`, `*Field`, `*FeatureRow` helpers added during the split.
- [ ] Storybook: story file per UI component (`Features/<Product>/Components/*` + `Panes/*`), Controls on simple props, named stories per meaningful state; no Storybook `decorators` (use `*-story-scope.tsx` in `render` when tokens need a workspace root); workspace chrome Default under `Themes/<Product>`; unique state matrices under `Features/<Product>`; bootstrap returns coherent **`data` + `session`** (and **`operations`** when needed).

## Anti-patterns

- Duplicating **`WorkspaceAppLayout`** scroll/header markup in a route instead of split props.
- A second **mobile scrim** beside `AppSidebar` (scrim lives inside `AppSidebar`).
- **`*Workspace`** importing routers or assigning `window.location` (belongs in **`*App`** or routes).
- **`use*Controller`** reading/writing `window.location` or router search (belongs in **`*App`** via route-sync hooks and callbacks such as `onNavigate`, `onRoomChange`).
- **Panes** importing **`use*API`** or holding section state (belongs in controller / shell hook).
- **Read-only `Input`** styling via repeated one-off `className`s when the shell can scope **`:has(input[readonly])`** under the workspace root.
- Product-prefixed **`InstallCard`**, **`InstallField`**, **`SettingsCard`**, etc. that duplicate **`Card`** / **`FieldLabelRow`** / **`Label`** — rename to shared imports and workspace-scoped CSS only.
- New **`*-form-primitives.tsx`** files in `*-core` unless they export domain-specific behavior (e.g. installer status dots), not layout clones of existing UI.
