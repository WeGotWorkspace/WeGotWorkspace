# Color hex inventory

Leftover raw hex under `packages/apps` that are **not** We Got brand primitives (`--color-we-got-*`) or status token sources (`--color-error` / `--color-warning` / `--color-success` / `--color-info`).

This is a tech-debt queue from the brand color-token pass. It does **not** rewrite every site. Classify each row as:

| Recommendation      | Meaning                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **brand primitive** | Point at `--color-we-got-*` (or an existing alias of one)                                                                                                                                        |
| **semantic alias**  | Point at `--color-error` / `--color-warning` / `--color-success` / `--color-info`, or a real role token. Soft and Dark are primitives (`--color-we-got-soft`, `--color-we-got-dark`), not roles. |
| **keep**            | Intentional (third-party chart, user-picked swatch, mask black/white, Meet dark stage, fixture data)                                                                                             |

Excluded from this list on purpose:

- Primitive / status **source** hexes in `styles.css` (`#fff5e9`, `#003311`, `#0045ff`, …, `#b14242`, `#c98a1f`, `#3a8f5a`, `#a3c4e8`)
- `#ffffff` / `#000000` used as Docs full-rail on-color, primary button fg, or gradient masks (component on-color, not a second palette)
- Test / Storybook / mock fixture hexes (unless they define a shipped palette)

## Suite / theme leftovers (`styles.css`)

| File         | Hex                                            | Recommendation                                                      |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------- |
| `styles.css` | `#042318` (`--color-forest`)                   | **semantic alias** or retire — legacy green suite, not We Got Dark  |
| `styles.css` | `#34d399` (`--color-emerald`, `--color-paper`) | **keep** until ghost/emerald consumers remap; not a brand primitive |
| `styles.css` | `#0a3a2a` (`--color-slate-muted`)              | **semantic alias** or retire with forest                            |
| `styles.css` | `#22c55e` (`--color-ghost`)                    | **keep** (ghost control hue) or later map toward success/brat       |
| `styles.css` | `#1b1d3a` (`--workspace-home-bg`)              | **keep** (suite home navy; Home has no app accent)                  |
| `styles.css` | `#0000000a`, `#0f172a1f` (sheet shadow)        | **keep** (shadow alpha, not paint)                                  |

## Meet dark surfaces

| File                                     | Hex                                        | Recommendation                                                           |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `meet-workspace.css`                     | `#171826`, `#20223a` (panel)               | **keep** (Meet call chrome; dark-mode later remaps semantics, not these) |
| `meet-workspace.css`                     | `#fda4af`, `#e5484d`, `#93c5fd`, `#34d399` | **semantic alias** (error / mic-off / link / live → status or brand)     |
| `meet-workspace.css`                     | `#000000` (`--meet-screen-bg`)             | **keep** (true black screen share)                                       |
| `meet-workspace.css` / `app-sidebar.css` | `#1b1d3a` fallbacks on home bg             | **keep** or chain to `--workspace-home-bg` only                          |

## Status / destructive still as raw hex

| File                        | Hex                                    | Recommendation                                                                   |
| --------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| `calendar-rsvp-status.css`  | `#3a8f5a`, `#b14242`                   | **semantic alias** → `--color-success` / `--color-error`                         |
| `admin-panes.css`           | `#c98a1f` (tag wash)                   | **semantic alias** → `--color-warning`                                           |
| `docs-workspace.css`        | `#c98a1f` (busy meta tag)              | **semantic alias** → `--color-warning`                                           |
| `note-text-editor-body.css` | `#c98a1f`                              | **semantic alias** → `--color-warning`                                           |
| `button.css` / Meet         | `#dc2626` (`--color-red-500` fallback) | **semantic alias** → `--color-error` (do not reuse We Got Red)                   |
| `contacts-workspace.css`    | `#dc2626` (swipe delete)               | **semantic alias** → `--color-error`                                             |
| `callout.css`               | `#1a1a18` (info/neutral)               | **keep** for now (callout-info stays neutral; `--color-info` is Sky when needed) |
| `text-editor.css`           | `#b14242` (danger menu fallback)       | **semantic alias** → `--color-error`                                             |
| `installer.css`             | `#15803d`, `#b45309`                   | **semantic alias** → success / warning                                           |

## Avatar / chip / presence palettes

| File                       | Hex                                                                                    | Recommendation                                                     |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `user-avatar.css`          | `#f59e0b`, `#06b6d4`, `#f97316`, `#8b5cf6`, `#f43f5e`, `#84cc16`, `#14b8a6`, `#0ea5e9` | **keep** (per-user identity hues) or later a shared identity scale |
| `user-avatar.css`          | `#22c55e`, `#eab308` (presence)                                                        | **semantic alias** → success / warning                             |
| `docs-collab-presence.css` | `#c2410c` (connecting chip)                                                            | **keep** or **semantic alias** → warning/error mix                 |
| `docs-collab-utils.ts`     | peer color list (`#2563eb`, `#dc2626`, …)                                              | **keep** (collab author palette)                                   |

## Chat / search accents

| File                                              | Hex                                        | Recommendation                                            |
| ------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `chat-ui.css` / message / reaction / link-preview | `#0e7490`, `#06b6d4`, `#eab308`, `#1d4ed8` | **semantic alias** or Meet-scoped component tokens        |
| `unified-search-results-dropdown.css`             | `#2563eb`, `#8b5cf6`, `#16a34a`            | **keep** (row-type accents) or map to workspace accents   |
| `contacts-conflict-dialog.css`                    | `#0e7490`                                  | **semantic alias** → chat/Meet accent or workspace accent |

## Drive / share leftovers

| File                      | Hex                                   | Recommendation                                                                       |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `drive-browser.css`       | `#22c55e`, `#d97706` (offline badges) | **semantic alias** → success / warning                                               |
| `drive-access.css`        | `#047857`                             | **semantic alias** or Drive brat/ink mix                                             |
| `drive-folder-picker.css` | `#3b82f6`, `#0f172a` fallbacks        | **brand primitive** / ink — stale Tailwind blue; should inherit `--workspace-accent` |
| `drive-detail-panel.css`  | `#8ace00` hard-set accent             | **brand primitive** → `var(--color-we-got-brat)`                                     |
| `drive-workspace.css`     | `#1d6635` (wai / switch fg)           | **keep** (Drive mark contrast mix toward ink)                                        |
| `share-ui.css`            | `#10b981` primary fallback            | **brand primitive** / workspace accent — stale emerald                               |

## Calendar timeline / engine (third-party-ish)

| File                                                                                 | Hex                                         | Recommendation                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------- |
| `CalendarTimelineView.css` / `CalendarTimeSidebar.css` / `CalendarWeekdayHeader.css` | `#ff0000`, `#222`, `#fff` grid / now-marker | **keep** (library defaults; overridden by `--lc-*`) |
| `TimeLine.css`                                                                       | `#d0d0d0`, `#505050`, `#e0342f`, `#ff6b64`  | **keep** (timeline chrome defaults)                 |
| `CalendarsSidebar.css`                                                               | `#f8fafc`, `#1e293b`                        | **brand primitive** → Soft / Dark                   |
| `EventColor.ts` / `eventColor.ts` / JMAP defaults                                    | `#94a3b8`, `#4285f4`, `#6366f1`, …          | **keep** (user calendar colors + defaults)          |
| `calendar-calendar-dialog.tsx`, addressbook/notebook/task color lists                | Tailwind-like swatches                      | **keep** (user-picked collection colors)            |

## Tasks / notes / docs collab

| File                            | Hex                             | Recommendation                              |
| ------------------------------- | ------------------------------- | ------------------------------------------- |
| `tasks-priority.tsx`            | `#ef4444`, `#eab308`, `#3b82f6` | **semantic alias** → error / warning / info |
| `notes-notebook-color.ts`       | `#14b8a6` default               | **keep** (notebook default swatch)          |
| `docs-collab-sidebar-panel.css` | `#0f172a` in strong mix         | **semantic alias** → `--color-we-got-dark`  |
| `workspace-split-app.css`       | `#2f302c` primary bg            | **brand primitive** → `--color-we-got-dark` |
| `workspace-app-layout.css`      | comment `#2563eb`               | docs only — ignore                          |

## Charts / swatches / icons

| File                                    | Hex                                       | Recommendation                                 |
| --------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `ui/chart.tsx`                          | Recharts `#ccc` / `#fff`                  | **keep** (third-party chart)                   |
| `ui/swatch-color-picker.css`            | conic rainbow hexes                       | **keep** (picker UI)                           |
| `app-icons/*.svg`, `public/app-icons/*` | brand hex fallbacks in `var(--wai-*, #…)` | **keep** (SVG fallbacks mirror primitives)     |
| `reminders.svg`                         | `#f43f5e`                                 | **keep** or map if Reminders ships under Tasks |

## App switch / branding defaults

| File                               | Hex                                      | Recommendation                                                                                     |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `workspace-app-icons.ts`           | `#1B1D3A` (`WORKSPACE_HOME_ACCENT`)      | **keep** (same as `--workspace-home-bg`)                                                           |
| `branding-cssprops.ts`             | `#1d6635`, `#1b1d3a`, `#ffffff` defaults | **keep** (Storybook knobs match production)                                                        |
| Notes / Drive primary fg `#003311` | brand Dark literal on light accents      | **brand primitive** → `var(--color-we-got-dark)` / `--color-we-got-dark` when touching those files |

## How to shrink this list

1. Prefer `var(--color-*)` / `var(--workspace-accent)` over new hex.
2. Status paints → `--color-error|warning|success|info`.
3. Leave user-chosen calendar/notebook/task colors and chart/library defaults alone.
4. When a file is already open for another change, fold nearby rows from this inventory.
