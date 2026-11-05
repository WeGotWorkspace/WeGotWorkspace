Source: #1945 (body-hash: 59ad6866)
Goal: WeGotWorkspace/Product#84

# Suite UI norm from the Docs spike

## Goal

The Docs UI spike (branch `spike/docs-ui-polish`) restyled Docs with rules scoped to `.docs-workspace`. This work moves that look into the shared token tiers and primitives, so every app, plus Home, Login and Installer, reads it from one place in light and dark. Afterwards `docs-workspace.css` keeps only document-specific styling.

Decided with the product lead on 2026-11-05:

- **Light scheme:** neutral for the whole suite. Surface `#ffffff`, rail `#f6f7f9`, ink `#16181d`. Brand cream stays in the logo and the app icons only.
- **Dark scheme:** the spike's cool blue-black (`#0e1216` surface, `#10161b` rail, `#eef1f5` ink).
- **Selection:** one recipe for sidebar rows and pressed outline toggles. Light is a quiet ink wash; dark is a sky wash fading right with a sky hairline.

## Non-goals

- Meet's own navy workspace and call chrome (stage, call bar, tiles).
- Docs domain styling: page sheets and pagination ends, suggestion and comment cards, format-bar size and floating placement, header presence avatars, footer stats and the status dot.
- New themes, per-app palettes, or a theme setting.

## Affected packages

- packages/apps (CSS tokens, primitives, shell, PWA colour constants, stories and tests)
- packages/apps/public (theme boot script, web manifests) and packages/apps/index.html

## Technical constraints

- **Tier 1.5 `--scheme-*` stays the only thing `[data-theme="dark"]` swaps** (`styles.css`). Theme-dependent shape parameters, such as selection strengths and frost shadows, are scheme tokens too, so Tier 3 keeps a single recipe.
- **Mix with `oklch(from #hex l c h)`, never bare hex.** Chrome turns a bare hex mixed in oklch into `hue: none` with leftover chroma.
- **Selection recipes live in `workspace-derive.css`.** They resolve against the local surface, so the hosts in its `:where` list recompute them.
- **Primitives read tokens with fallbacks.** Product sheets do not re-declare them (apps-ui skill).
- **Selected backgrounds may be gradients.** Consumers paint them with `background`, not `background-color`.
- **PWA colours stay in lockstep.** `WORKSPACE_PWA_THEME_COLORS`, `public/assets/theme-boot.js`, the `index.html` first-paint style and meta, and `public/manifests/*.webmanifest` match the rail colours. Their tests guard this.

## Edge cases

- **Portaled menus and dialogs:** they read `:root` values. Selection and frost tokens must resolve there, not only inside a workspace host.
- **Chat composer:** it renders `TextEditorFormatBar` with its own static style (`chat-composer.css`). The frost pill stays Docs-only, so chat is unaffected.
- **Sidebar rows come from two primitives:** `menu-item` (Docs, Drive, Admin, Settings) and `collection-sidebar-row` (Notes, Tasks, Contacts, Calendar, Meet). Both must take the same radius and selection.
- **Login, Home and Installer:** they paint `--workspace-sidebar-surface`, so they follow the rail colour automatically. Installer's private wash ladder goes.
