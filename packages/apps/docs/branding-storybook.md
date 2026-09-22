# Designer branding in Storybook

Try app accents, cream/ink, and icon artwork without editing CSS. Winning values go back to engineers for `*-workspace.css` and `app-icons/*.svg`.

## Open the catalog

1. From the monorepo root: `pnpm dev:storybook` (or full `pnpm dev`).
2. Open [http://127.0.0.1:6006](http://127.0.0.1:6006).
3. In the sidebar, open **Themes** — this is the designer catalog (one story per app plus Home, Login, and Installer):

| Story                             | What you see                                                   |
| --------------------------------- | -------------------------------------------------------------- |
| `Themes/Mail` … `Themes/Settings` | Mock workspace chrome (sidebar, lockup, CTAs)                  |
| `Themes/Home`                     | Suite home grid + BrandLockup                                  |
| `Themes/Login`                    | Cream auth shell + BrandLockup — full state matrix (below)     |
| `Themes/Installer`                | Same cream shell — interactive full flow + step matrix (below) |

Stories are offline mock fixtures — no live API required.

Storybook sidebar groups: **`Foundations/`** (token docs), **`Themes/`** (designer chrome), **`UI/`** (primitives + patterns), **`Layout/`** (page frame), and **`Features/`** (product + Workspace). Prefer **Themes/** when reviewing accents, cream/ink, or icon artwork.

### What lives outside `Themes/`

| Group              | Examples                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Foundations        | `Foundations/Colors`, `Foundations/Typography`, `Foundations/Spacing` (pointers at CSS tokens; knobs stay in Themes) |
| UI/Primitives      | `UI/Primitives/Button`, `UI/Primitives/Input`, `UI/Primitives/Dialog`, …                                             |
| UI/Patterns        | `UI/Patterns/Detail View Header`, Action Bar, Chat, …                                                                |
| Layout             | `Layout/App Sidebar`, `Layout/Shell Header`, `Layout/Brand Lockup`, `Layout/Authentication Page`                     |
| Features/{App}     | `Features/Mail/Panes/…`, `Features/Meet/Components/…`, `Features/Admin/Panes/…`                                      |
| Features/Workspace | Mock shell `Features/Workspace`, live `Features/Workspace/Live`                                                      |

Product workspace **chrome Defaults** live under `Themes/{App}` (and Login/Installer matrices under `Themes/Login` / `Themes/Installer`). Do **not** duplicate those Defaults under Features.

Designer URL examples (Storybook id encoding may vary slightly):

- [Themes/Login](http://127.0.0.1:6006/?path=/story/themes-login--login)
- [Themes/Installer](http://127.0.0.1:6006/?path=/story/themes-installer--welcome)
- [Themes/Installer — Interactive flow](http://127.0.0.1:6006/?path=/story/themes-installer--interactive-flow)

### Login state matrix (`Themes/Login`)

| Story                      | State                                               |
| -------------------------- | --------------------------------------------------- |
| `Login`                    | Sign-in form, password recovery link on             |
| `Connect assistant`        | Same form with MCP `return=/oauth/authorize` copy   |
| `Recovery off`             | Sign-in without forgot-password link                |
| `Forgot / request success` | Forgot-password form → success message after submit |
| `Reset / form`             | Reset-password form with valid token                |
| `Reset / invalid token`    | Reset-password with empty / missing token           |

### Installer (`Themes/Installer`)

| Story                                      | State                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `Interactive flow`                         | Full mock walkthrough (`InstallerWorkspace`) — click through Welcome → Ready with cream/ink + BrandLockup knobs |
| `Welcome`                                  | First setup step + progress dots                                                                                |
| `Your database`                            | MySQL / MariaDB fields (default engine)                                                                         |
| `Your database (SQLite)`                   | SQLite engine selected                                                                                          |
| `Your account`                             | Admin account form (database step done)                                                                         |
| `Your account (database from environment)` | Account with database step omitted                                                                              |
| `Installing`                               | Account form + in-progress install list                                                                         |
| `Ready`                                    | Success + open workspace                                                                                        |
| `Server needs attention`                   | Blocking server checks + re-run                                                                                 |

## Which knobs to use

Two panels:

### Controls (SVG slot)

| Control      | Use when…                                                                 |
| ------------ | ------------------------------------------------------------------------- |
| `iconPreset` | Quick A/B: keep **current**, swap another app’s SVG, or choose **custom** |
| `svgMarkup`  | Paste exported SVG when `iconPreset` is **custom**                        |

Docs also has **`fullAccentSidebar`**: full `--workspace-accent` rail vs cream-mix wash.

### CSS props (colors)

| Category    | Tokens                                                                   | Purpose                                      |
| ----------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| Primitives  | `--color-we-got-soft`, `--color-we-got-dark`                             | We Got Soft and We Got Dark                  |
| App chrome  | `--workspace-accent`, optional `--app-sidebar-bg`, `--app-sidebar-color` | Primary / CTA / badge; sidebar; nav on-color |
| Icon layers | `--wai-bg`, `--wai-fg`                                                   | Switch-trigger SVG fills                     |

**Accent vs `--wai-*`:** accent drives workspace chrome (sidebar mix, buttons, badges). `--wai-*` only recolors the switch-trigger mark layers. Change accent for “the app feels different”; change `--wai-*` when the lockup icon itself needs a new palette.

**Defaults match production UI**, not the PWA/home-tile swatch. Calendar, Tasks, and Meet use a different `--workspace-accent` in `*-workspace.css` than `WORKSPACE_APP_ACCENT` (tile theme). Sidebar mixes and `--wai-*` come from the same workspace CSS / `workspace-color.css`. `iconPreset` defaults to **current** (that app’s real mark).

### WCAG AA ratios (resolved brand hex / Soft)

Text ≥4.5:1; UI icons ≥3:1. Measured on sRGB brand hexes after Soft cream remap.

| Pair                                                  | Ratio   | AA        |
| ----------------------------------------------------- | ------- | --------- |
| `--color-we-got-dark` on `--color-we-got-soft` (Soft) | 13.15:1 | text PASS |
| white on Docs `--workspace-accent` (blue)             | 6.37:1  | text PASS |
| Docs `--wai-fg` on `--wai-bg`                         | 6.37:1  | text PASS |
| Admin / Settings `--wai-fg` on `--wai-bg`             | 7.36:1  | text PASS |
| Calendar / Contacts `--wai-fg` on `--wai-bg`          | 4.07:1  | UI PASS   |
| Drive `--wai-fg` on `--wai-bg`                        | 3.63:1  | UI PASS   |
| Meet `--wai-fg` on `--wai-bg`                         | 4.13:1  | UI PASS   |
| Mail pink on red tile (tile darkened 10%→ink)         | ~3.0:1  | UI PASS   |
| Notes / Tasks red marks (marks mixed →ink)            | ~3.0:1  | UI PASS   |

Home uses Soft and Dark (and `--workspace-home-bg`); it has no per-app accent. The suite mark may use fixed fills or `var(--color-we-got-soft)` / `var(--color-we-got-dark)` rather than `--wai-*`.

Login and Installer use Soft and Dark only on `.login-screen` (no home navy, no app accent). `iconPreset` retargets the BrandLockup suite mark. Knobs apply to every story in those matrices.

## SVG layer contract

Custom switch-trigger artwork must use the same CSS variable fills as production icons so invert / sidebar contexts still work:

```svg
<svg viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <path fill="var(--wai-bg, #de4b0e)" d="…" />
  <!-- Foreground marks -->
  <path fill="var(--wai-fg, #ffbdc2)" d="…" />
</svg>
```

Knockouts that should stay the tile color use `--wai-bg`, not a third token.

| Token      | Role             |
| ---------- | ---------------- |
| `--wai-bg` | Icon background  |
| `--wai-fg` | Foreground marks |

Hard-coded `#hex` fills ignore the Icon layers cssprops. Prefer `fill="var(--wai-…, fallback)"` with a sensible fallback for non-Storybook use.

## Hand values back to engineers

Storybook does **not** write to the repo. When a combination looks right:

1. **Screenshot** the story (sidebar + lockup + a primary CTA is enough).
2. **Token table** — list final values, for example:

   | Token                | Value     |
   | -------------------- | --------- |
   | `--workspace-accent` | `#de4b0e` |
   | `--wai-bg`           | `#de4b0e` |
   | `--wai-fg`           | `#ffbdc2` |

3. If you changed the mark: attach the **SVG markup** (or the file) from `svgMarkup` / your export.
4. Send screenshot + table (+ SVG) to engineering. They update `packages/apps/src/{app}-core/src/*-workspace.css` and/or `packages/apps/public/app-icons/*.svg` (inline copies live under `workspace-app-icon-svgs`).

Production CSS remains the source of truth; Themes stories only override via a decorator and an optional icon context.
