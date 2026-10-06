# Designer branding in Storybook

Try app accents, cream/ink, and icon artwork without editing CSS. Winning values go back to engineers for `*-workspace.css` and `app-icons/*.svg`.

## Open the catalog

1. From the monorepo root: `pnpm dev:storybook`.
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
| `Connect Assistant`        | Same form with MCP `return=/oauth/authorize` copy   |
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

Docs also has **`fullAccentSidebar`**: full `--workspace-accent` rail vs the Soft rail.

### CSS props (colors)

| Category    | Tokens                                                                                                                                                                 | Purpose                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Primitives  | `--color-we-got-soft`, `--color-we-got-dark`                                                                                                                           | We Got Soft and We Got Dark                                                          |
| App chrome  | `--workspace-surface` / `-foreground`, `--workspace-accent` / `-foreground`, `--workspace-sidebar-surface` / `-foreground`, `--workspace-icon-surface` / `-foreground` | Four surface/foreground pairs. Products assign primitives; state washes derive once. |
| Icon layers | `--workspace-icon-surface`, `--workspace-icon-foreground`                                                                                                              | Same icon pair the switch-trigger SVG reads                                          |

**Pairs:** `--workspace-accent` is We Got Dark (checks, badges, outline glyphs, primary buttons). `--workspace-icon-surface` is the per-app tile hue only. `--workspace-surface` is `color-mix(in oklch, var(--color-we-got-soft) 40%, #fff)`. `--workspace-sidebar-surface` is `var(--color-we-got-soft)` — Soft, not an icon tint. Row hover and selected mix sidebar foreground into that fill (8 / 12 / 16%). A CSS custom property in the panel overrides a token only after you change it. Do not set a token to `var(--itself)` — the addon writes the value onto `body` and a self-reference makes the token invalid.

**Defaults match production chrome**, not the PWA/home-tile swatch. Every app’s `--workspace-accent` is Dark, which differs from per-app `WORKSPACE_APP_ACCENT` (tile theme). The panel lists the same tokens the workspace CSS sets; the canvas keeps that CSS until a control changes. `iconPreset` defaults to **current** (that app’s real mark).

### WCAG AA ratios (resolved brand hex / Soft)

Text ≥4.5:1; UI icons ≥3:1. Measured on sRGB brand hexes after Soft cream remap.

| Pair                                                             | Ratio   | AA        |
| ---------------------------------------------------------------- | ------- | --------- |
| `--color-we-got-dark` on `--color-we-got-soft` (Soft)            | 13.15:1 | text PASS |
| white on Docs `--workspace-accent` (blue)                        | 6.37:1  | text PASS |
| Docs `--workspace-icon-foreground` on `--workspace-icon-surface` | 6.37:1  | text PASS |
| Admin / Settings Dark on white                                   | 14.17:1 | text PASS |
| Calendar white on Prince                                         | 6.42:1  | text PASS |
| Docs white on blue                                               | 6.37:1  | text PASS |
| Mail white on Red                                                | 4.10:1  | UI PASS   |
| Meet Sand on white                                               | 2.69:1  | UI FAIL   |
| Drive Brat on white                                              | 1.92:1  | UI FAIL   |
| Contacts white on Sky                                            | 1.81:1  | UI FAIL   |
| Tasks white on Pink                                              | 1.58:1  | UI FAIL   |
| Notes white on Yellow                                            | 1.55:1  | UI FAIL   |

Home uses Soft and Dark (and `--workspace-home-bg`); it has no per-app accent. The suite mark may use fixed fills or `var(--color-we-got-soft)` / `var(--color-we-got-dark)` rather than `--workspace-icon-surface*`.

Login and Installer use Soft and Dark only on `.login-screen` (no home navy, no app accent). `iconPreset` retargets the BrandLockup suite mark. Knobs apply to every story in those matrices.

## SVG layer contract

Custom switch-trigger artwork must use the same CSS variable fills as production icons so invert / sidebar contexts still work:

```svg
<svg viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <path fill="var(--workspace-icon-surface, #de4b0e)" d="…" />
  <!-- Foreground marks -->
  <path fill="var(--workspace-icon-foreground, #ffbdc2)" d="…" />
</svg>
```

Knockouts that should stay the tile color use `--workspace-icon-surface`, not a third token.

| Token                         | Role             |
| ----------------------------- | ---------------- |
| `--workspace-icon-surface`    | Icon background  |
| `--workspace-icon-foreground` | Foreground marks |

Hard-coded `#hex` fills ignore the Icon layers cssprops. Prefer `fill="var(--workspace-icon-surface…, fallback)"` with a sensible fallback for non-Storybook use.

## Hand values back to engineers

Storybook does **not** write to the repo. When a combination looks right:

1. **Screenshot** the story (sidebar + lockup + a primary CTA is enough).
2. **Token table** — list final values, for example:

   | Token                         | Value     |
   | ----------------------------- | --------- |
   | `--workspace-accent`          | `#de4b0e` |
   | `--workspace-icon-surface`    | `#de4b0e` |
   | `--workspace-icon-foreground` | `#ffbdc2` |

3. If you changed the mark: attach the **SVG markup** (or the file) from `svgMarkup` / your export.
4. Send screenshot + table (+ SVG) to engineering. They update `packages/apps/src/{app}-core/src/*-workspace.css` and/or `packages/apps/public/app-icons/*.svg` (inline copies live under `workspace-app-icon-svgs`).

Production CSS remains the source of truth; Themes stories only override via a decorator and an optional icon context.
