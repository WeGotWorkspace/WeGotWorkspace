# Type size inventory

Raw `font-size` and `text-[Npx]` / `text-[Nrem]` call sites under `packages/apps`.
Classify each as **snap** (fold into the Tailwind text scale) or **keep** (layout metric or intentional off-scale).

Shared roles live in [`workspace-type.css`](../src/workspace-shell/src/workspace-type.css): `.text-title`, `.text-title-lg`, `.text-caption`, `.text-lockup`. Captions use `text-xs` + `leading-4` on `.text-caption` only — do not set `--text-xs--line-height`.

Chrome weight stays `font-semibold` (600). Do not add `font-ui`.

## Second-slice snaps (done)

| File                                               | Was                    | Now                                 |
| -------------------------------------------------- | ---------------------- | ----------------------------------- |
| `CalendarTimelineView.css` (weekday month card)    | `11px`                 | `0.75rem` (`text-xs`)               |
| `CalendarTimelineView.css` (day count badge)       | `text-[12px]`          | `text-xs`                           |
| `CalendarTimelineView.css` (day-header / overflow) | `12px`                 | `text-xs`                           |
| `CalendarTimeSidebar.css` (now-badge fallback)     | `11px`                 | `0.75rem`                           |
| `text-editor.css` (carets label)                   | `11px` / weight `600`  | `text-xs` / `font-semibold`         |
| `text-editor.css` (format print btn)               | `0.75rem`              | `text-xs`                           |
| `text-editor.css` (heading option / slash title)   | `0.8125rem`            | `text-sm`                           |
| `text-editor.css` (slash menu label)               | `10px`                 | `text-xs`                           |
| `text-editor.css` (slash item)                     | `0.875rem`             | `text-sm`                           |
| `text-editor.css` (slash desc)                     | `0.6875rem`            | `text-xs`                           |
| `text-editor.css` (source size token)              | `0.875rem`             | kept as component token = `text-sm` |
| `user-avatar.css` (lg / xl marks)                  | `0.75rem` / `0.875rem` | `text-xs` / `text-sm`               |

## Keep (layout / component metrics)

| File                                                   | Value                                                       | Why                                           |
| ------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------- |
| `text-editor.css`                                      | `clamp(15px, 0.875rem + 0.35vw, 16px)`                      | Editor body prose floor — not a chrome role   |
| `user-avatar.css` (xs / sm / md / 2xl)                 | `10px` / `11px` / `1.8125rem` via `--user-avatar-font-size` | Circle-fitted initials                        |
| `CalendarTimelineView.css` / `CalendarTimeSidebar.css` | `0.625rem` time labels                                      | Dense timeline metric (below caption floor)   |
| `styles.css`                                           | `max(1rem, 100%)` / mobile `--input-font-size*: 1rem`       | iOS zoom floor — control rule, not type token |
| `input.css` / `button.css` / control sizes             | `--input-font-size-*`                                       | Control size scale                            |
| `AllDayEvent.css`                                      | `text-[0px]`                                                | Visually hide text, not a type role           |

## Remaining snap candidates (not this slice)

| File                                                                  | Value                                   | Suggested fold                              |
| --------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------- |
| `menu-item.css`, badges (Meet / Docs / Calendar / notifications)      | `text-[10px]`                           | `text-xs` when visual budget allows         |
| `meet-workspace.css`, chat, drive-detail, content-label, collab cards | `text-[11px]`                           | `text-xs`                                   |
| `admin-panes.css`                                                     | `text-[10px]` uppercase                 | `text-xs` + caption role                    |
| `mail-workspace.css` attachments label                                | `0.6875rem`                             | `text-xs`                                   |
| `upload-progress.css`                                                 | `0.6875rem`                             | `text-xs`                                   |
| `tag.css`                                                             | `--tag-font-size: 0.8125rem`            | `text-sm`                                   |
| `path-breadcrumb.css`                                                 | `0.9375rem` / `1.0625rem` / `0.8125rem` | nearest `text-sm` / `text-base` / `text-xs` |
| `contacts-workspace.css`                                              | `0.9375rem` / `1.75rem`                 | nearest steps                               |
| `drive-browser.css`                                                   | `sm:text-[0.9375rem]`                   | `sm:text-base` or keep mid-step             |
| `list-sticky-header.css`                                              | `15px` emphasis                         | nearest `text-sm` / keep if optical         |
| `CalendarTimelineView.css`                                            | `text-[17px]`                           | nearest `text-lg`                           |
| `unified-search-results-dropdown.css`                                 | `0.92rem` / `0.76rem`                   | nearest steps                               |
| `tasks-main-view.css`                                                 | `0.75rem` / badge `0.625rem` / `0.5rem` | `text-xs`; badges may **keep**              |
| `file-preview-text-pane.css`                                          | `text-[0.625rem]`                       | keep dense chrome or `text-xs`              |
| `docs-collab` reply mark                                              | `text-[9px]`                            | keep circle metric or `text-xs`             |

## Weight note

Prefer `font-semibold` / `font-medium` / `font-normal` over literal `font-weight: 600|500|400` when a file is already being touched. Do not introduce `font-ui`.
