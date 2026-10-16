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

| File         | Hex                                     | Recommendation                                                        |
| ------------ | --------------------------------------- | --------------------------------------------------------------------- |
| `styles.css` | `#34d399` (`--color-emerald`)           | **keep** — list, drive, and mail still read it; not a brand primitive |
| `styles.css` | `#1b1d3a` (`--workspace-home-bg`)       | **keep** (suite home navy; Home has no app accent)                    |
| `styles.css` | `#0000000a`, `#0f172a1f` (sheet shadow) | **keep** (shadow alpha, not paint)                                    |

## Meet dark surfaces

| File                 | Hex                             | Recommendation                                                                     |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| `meet-workspace.css` | `#171826`, `#20223a` (panel)    | **keep** (Meet call chrome; dark-mode later remaps semantics, not these)           |
| `meet-workspace.css` | `#fda4af`, `#e5484d`, `#34d399` | **semantic alias** (error / mic-off / live). `--meet-link` was unread and removed. |
| `meet-workspace.css` | `#000000` (`--meet-screen-bg`)  | **keep** (true black screen share)                                                 |
| `meet-workspace.css` | `#1b1d3a` on home bg            | **keep** (Meet dark scope). App sidebar now chains `--workspace-home-bg` only.     |

## Status / destructive still as raw hex

Product sheets below now use `--color-success`, `--color-error`, `--color-warning`, or `--destructive`. Meet still falls back to `#dc2626` on `--button-destructive-bg` (palette migration is a later PR).

| File                 | Hex                                    | Recommendation                                 |
| -------------------- | -------------------------------------- | ---------------------------------------------- |
| `meet-workspace.css` | `#dc2626` (`--color-red-500` fallback) | **semantic alias** → `--destructive` with Meet |

## Avatar / chip / presence palettes

| File                       | Hex                                                                                    | Recommendation                                                     |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `user-avatar.css`          | `#f59e0b`, `#06b6d4`, `#f97316`, `#8b5cf6`, `#f43f5e`, `#84cc16`, `#14b8a6`, `#0ea5e9` | **keep** (per-user identity hues) or later a shared identity scale |
| `user-avatar.css`          | `#22c55e`, `#eab308` (presence)                                                        | **semantic alias** → success / warning                             |
| `docs-collab-presence.css` | warning chip uses `--color-warning`                                                    | done                                                               |
| `docs-collab-utils.ts`     | peer color list (`#2563eb`, `#dc2626`, …)                                              | **keep** (collab author palette)                                   |

## Chat / search accents

| File                                   | Hex                                                             | Recommendation                                            |
| -------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| `chat-ui.css` / message / link-preview | accent and mention use `--workspace-accent` / `--color-warning` | done                                                      |
| `unified-search-results-dropdown.css`  | row accents fall back to `--workspace-accent`                   | done                                                      |
| `contacts-conflict-dialog.css`         | `#0e7490`                                                       | **semantic alias** → chat/Meet accent or workspace accent |

## Drive / share leftovers

| File                      | Hex                                            | Recommendation                                   |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `drive-browser.css`       | offline available badge uses `--color-success` | done                                             |
| `drive-access.css`        | via-link uses `--workspace-accent-strong`      | done                                             |
| `drive-folder-picker.css` | docs listing inherits `--workspace-accent`     | done                                             |
| `drive-detail-panel.css`  | `#8ace00` hard-set accent                      | **brand primitive** → `var(--color-we-got-brat)` |
| `drive-workspace.css`     | `#1d6635` (wai / switch fg)                    | **keep** (Drive mark contrast mix toward ink)    |
| `share-ui.css`            | accent is `--workspace-accent`                 | done                                             |

## Calendar timeline / engine (third-party-ish)

| File                                                                                 | Hex                                | Recommendation                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------ |
| `CalendarTimelineView.css` / `CalendarTimeSidebar.css` / `CalendarWeekdayHeader.css` | `#fff` today-pill ink fallback     | **keep** (ink fallback; today fill is `--lc-higlight-color` → `--color-error`) |
| `TimeLine.css`                                                                       | now-marker                         | **semantic alias** → `--lc-higlight-color` / `--color-error`                   |
| `CalendarsSidebar.css`                                                               | `#f8fafc`, `#1e293b`               | **brand primitive** → Soft / Dark                                              |
| `EventColor.ts` / `eventColor.ts` / JMAP defaults                                    | `#94a3b8`, `#4285f4`, `#6366f1`, … | **keep** (user calendar colors + defaults)                                     |
| `calendar-calendar-dialog.tsx`, addressbook/notebook/task color lists                | Tailwind-like swatches             | **keep** (user-picked collection colors)                                       |

## Tasks / notes / docs collab

| File                            | Hex                                                                 | Recommendation                              |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| `tasks-priority.tsx`            | `#ef4444`, `#eab308`, `#3b82f6` (low fill is `--workspace-surface`) | **semantic alias** → error / warning / info |
| `notes-notebook-color.ts`       | `#14b8a6` default                                                   | **keep** (notebook default swatch)          |
| `docs-collab-sidebar-panel.css` | `#0f172a` in strong mix                                             | **semantic alias** → `--color-we-got-dark`  |
| `workspace-split-app.css`       | `#2f302c` primary bg                                                | **brand primitive** → `--color-we-got-dark` |
| `workspace-app-layout.css`      | comment `#2563eb`                                                   | docs only — ignore                          |

## Charts / swatches / icons

| File                                    | Hex                                                  | Recommendation                                 |
| --------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `ui/chart.tsx`                          | Recharts `#ccc` / `#fff`                             | **keep** (third-party chart)                   |
| `ui/swatch-color-picker.css`            | conic rainbow in `oklch()` (no hex)                  | **keep** (picker spectrum)                     |
| `app-icons/*.svg`, `public/app-icons/*` | brand hex fallbacks in `var(--app-icon-layer-*, #…)` | **keep** (SVG fallbacks mirror primitives)     |
| `reminders.svg`                         | `#f43f5e`                                            | **keep** or map if Reminders ships under Tasks |

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
