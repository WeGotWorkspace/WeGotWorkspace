# Designer branding in Storybook

Try app accents, cream/ink, and icon artwork without editing CSS. Winning values go back to engineers for `*-workspace.css` and `app-icons/*.svg`.

## Open the catalog

1. From the monorepo root: `pnpm dev:storybook` (or full `pnpm dev`).
2. Open [http://127.0.0.1:6006](http://127.0.0.1:6006).
3. In the sidebar, open **Branding** — one story per app plus Home, Login, and Installer:

| Story                                 | What you see                                                   |
| ------------------------------------- | -------------------------------------------------------------- |
| `Branding/Mail` … `Branding/Settings` | Mock workspace chrome (sidebar, lockup, CTAs)                  |
| `Branding/Home`                       | Suite home grid + BrandLockup                                  |
| `Branding/Login`                      | Cream auth shell + BrandLockup — full state matrix (below)     |
| `Branding/Installer`                  | Same cream shell — interactive full flow + step matrix (below) |

Stories are offline mock fixtures — no live API required.

Designer URL examples (Storybook id encoding may vary slightly):

- [Branding/Login](http://127.0.0.1:6006/?path=/story/branding-login--login)
- [Branding/Installer](http://127.0.0.1:6006/?path=/story/branding-installer--welcome)
- [Branding/Installer — Interactive flow](http://127.0.0.1:6006/?path=/story/branding-installer--interactive-flow)

### Login state matrix (`Branding/Login`)

| Story                      | State                                               |
| -------------------------- | --------------------------------------------------- |
| `Login`                    | Sign-in form, password recovery link on             |
| `Connect assistant`        | Same form with MCP `return=/oauth/authorize` copy   |
| `Recovery off`             | Sign-in without forgot-password link                |
| `Forgot / request success` | Forgot-password form → success message after submit |
| `Reset / form`             | Reset-password form with valid token                |
| `Reset / invalid token`    | Reset-password with empty / missing token           |

### Installer (`Branding/Installer`)

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

Docs also has **`fullAccentSidebar`**: full `--docs-accent` rail vs cream-mix wash.

### CSS props (colors)

| Category    | Tokens                                                                       | Purpose                                      |
| ----------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| Suite       | `--color-cream`, `--color-ink`                                               | Paper and primary ink                        |
| App chrome  | `--{app}-accent`, optional `--{app}-sidebar`, `--app-sidebar-color`          | Primary / CTA / badge; sidebar; nav on-color |
| Icon layers | `--wai-bg`, `--wai-fg`, `--wai-detail`, `--wai-detail-muted`, `--wai-cutout` | Switch-trigger SVG fills                     |

**Accent vs `--wai-*`:** accent drives workspace chrome (sidebar mix, buttons, badges). `--wai-*` only recolors the switch-trigger mark layers. Change accent for “the app feels different”; change `--wai-*` when the lockup icon itself needs a new palette.

**Defaults match production UI**, not the PWA/home-tile swatch. Calendar, Tasks, and Meet use a different `--{app}-accent` in `*-workspace.css` than `WORKSPACE_APP_ACCENT` (tile theme). Sidebar mixes and `--wai-*` come from the same workspace CSS. `iconPreset` defaults to **current** (that app’s real mark).

Home uses cream/ink (and `--workspace-home-bg`); it has no per-app accent. The suite mark may use fixed fills or `var(--color-cream|ink, …)` rather than `--wai-*`.

Login and Installer use cream/ink only on `.login-screen` (no home navy, no app accent). `iconPreset` retargets the BrandLockup suite mark. Knobs apply to every story in those matrices.

## SVG layer contract

Custom switch-trigger artwork must use the same CSS variable fills as production icons so invert / sidebar contexts still work:

```svg
<svg viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <path fill="var(--wai-bg, #de4b0e)" d="…" />
  <!-- Foreground marks -->
  <path fill="var(--wai-fg, #ffbdc2)" d="…" />
  <!-- Optional detail / muted / cutout -->
  <path fill="var(--wai-detail, #ffbdc2)" d="…" />
  <path fill="var(--wai-detail-muted, #ffbdc2)" d="…" />
  <path fill="var(--wai-cutout, #de4b0e)" d="…" />
</svg>
```

| Token                | Role                                |
| -------------------- | ----------------------------------- |
| `--wai-bg`           | Icon background                     |
| `--wai-fg`           | Foreground marks                    |
| `--wai-detail`       | Secondary strokes/fills             |
| `--wai-detail-muted` | Quieter detail                      |
| `--wai-cutout`       | Knockout that reveals sidebar color |

Hard-coded `#hex` fills ignore the Icon layers cssprops. Prefer `fill="var(--wai-…, fallback)"` with a sensible fallback for non-Storybook use.

## Hand values back to engineers

Storybook does **not** write to the repo. When a combination looks right:

1. **Screenshot** the story (sidebar + lockup + a primary CTA is enough).
2. **Token table** — list final values, for example:

   | Token           | Value     |
   | --------------- | --------- |
   | `--mail-accent` | `#de4b0e` |
   | `--wai-bg`      | `#de4b0e` |
   | `--wai-fg`      | `#ffbdc2` |

3. If you changed the mark: attach the **SVG markup** (or the file) from `svgMarkup` / your export.
4. Send screenshot + table (+ SVG) to engineering. They update `packages/apps/src/{app}-core/src/*-workspace.css` and/or `packages/apps/public/app-icons/*.svg` (inline copies live under `workspace-app-icon-svgs`).

Production CSS remains the source of truth; Branding stories only override via a decorator and an optional icon context.
