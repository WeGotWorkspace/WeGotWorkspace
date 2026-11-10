# Suite UI norm from the Docs spike

## Goal

Move the Docs spike look into shared tokens and primitives, so every app, Home, Login and Installer get it from one source in light and dark. Docs keeps only document-specific rules. Source: #1945.

## Budget

This draws from the Product#84 dark-mode track (suite design language). It displaces per-app chrome tokens: the sidebar border colour, user-footer colours, and Installer's private washes.

## Non-goals

- Meet's navy workspace and call chrome.
- Docs domain styling: pages, suggestion and comment cards, format-bar size and placement, presence avatars, footer stats and the status dot.
- New themes or a theme setting.

## What exists

- **Light scheme is brand cream.**
  - Surface is Soft mixed toward white. `path: packages/apps/src/styles.css:244`
  - The rail is Soft. `path: packages/apps/src/styles.css:245`
- **Dark scheme already carries the spike's blue-black, globally.** `path: packages/apps/src/styles.css:286`
- **Docs re-declares the Tier 2 pair in light mode, Docs-only.** `path: packages/apps/src/docs-core/src/docs-workspace.css:461`
- **One wash ladder derives hover and active from the local pair.**
  - The ladder itself. `path: packages/apps/src/workspace-shell/src/workspace-derive.css:68`
  - Installer duplicates it with its own values. `path: packages/apps/src/installer-core/src/installer.css:19`
- **Sidebar rows come from two primitives.**
  - `menu-item` already reads `--sidebar-item-selected-*`. `path: packages/apps/src/menu-item/src/menu-item.css:94`
  - `collection-sidebar-row` reads `--collection-sidebar-row-selected-*` only. `path: packages/apps/src/collection-sidebar/src/collection-sidebar-row.css:35`
- **Pressed outline toggles use `.icon-button--active`**, with accent ink and an 8% wash. `path: packages/apps/src/button/src/button.css:197`
- **The account footer is shared shell CSS.** `path: packages/apps/src/workspace-shell/src/workspace-app-layout.css:80`
- **The PWA theme colours pin cream and `#1c1c1c`.** `path: packages/apps/src/lib/theme-preference.ts:15`
  - The guard test ties the light colour to `--color-we-got-soft`. `path: packages/apps/src/lib/pwa-document-shell.test.ts:37`
  - The dark assertion already fails on the spike. `path: packages/apps/src/lib/pwa-document-shell.test.ts:38`
- **Chat restyles the shared format bar without blur.** `path: packages/apps/src/chat-ui/src/chat-composer.css:23`

## Considered

- **Keep a Docs-scoped palette, as in the spike.** Rejected: the product lead wants one norm, and scoped pairs drift.
- **Give every pressed toggle the selection look.** Tried, then rejected by the product lead on 2026-11-05: action buttons read as glowing. It became the opt-in `pressedStyle="selection"`.
- **Push the Docs selection gradient into `--button-outline-active-background`.** Rejected: that token is painted with `background-color` by dropdown menus and segmented controls, and a gradient there is invalid. A separate `--workspace-selected-*` trio is read only by consumers that paint with `background`.
- **Per-theme recipes in `workspace-derive.css`.** Rejected in favour of scheme parameters (`--scheme-selection*`, `--scheme-frost-*`, `--scheme-panel-*`). The dark swap stays in Tier 1.5 and Tier 3 keeps one recipe.
- **Put the frost pill on every format bar.** Rejected: Chat renders the bar inline (`chat-composer.css:23`). The floating pill stays Docs placement and uses the shared frost tokens.

## Affected packages

- packages/apps

## Dependencies

1. Chunk A, scheme. Chunk B, tokens: both edit `styles.css`, so they run in one sequence.
2. Chunk C, primitives: needs B's tokens.
3. Chunk D, cleanup: needs C, so removing Docs and per-app rules shows no gap.
4. Chunk V, verify.

## Open decisions

None. Light scope, dark selection colour and the Meet exclusion were decided on 2026-11-05; sky selection and hover in light mode on 2026-11-09 (see spec).

## Invariants

- **PWA chrome colours match the rail in both themes.** A wrong change makes the iOS status bar band or the first paint flash cream or near-black.
  - Proof: `path: packages/apps/src/lib/pwa-document-shell.test.ts` (assertions on `WORKSPACE_PWA_THEME_COLORS`)
  - Proof: `path: packages/apps/src/lib/workspace-pwa-manifests.test.ts`
- **Portaled menus keep the workspace wash tokens.** A wrong change turns dropdown hover and selected rows transparent. Proof: `path: packages/apps/src/ui/portal-theme-vars.test.tsx`.
- **The Suggest toggle still flips mode and reports `aria-pressed`.** Proof: `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-suggest-controls.test.tsx`.
- **Format bar sizes keep working.** Proof: `path: packages/apps/src/text-editor-core/src/text-editor-format-bar.test.tsx` ("sizes every control from the size prop").
- **After each chunk the app builds and typechecks.** Proof: `cmd: pnpm --dir packages/apps run typecheck`.

## Chunks

### Chunk A: scheme
- **Skill:** apps-ui
- **Inputs:**
  - The light scheme is cream. `path: packages/apps/src/styles.css:244`
  - The PWA colours are cream and `#1c1c1c`. `path: packages/apps/src/lib/theme-preference.ts:15`
- **Done when:**
  - Light `--scheme-*` is neutral: surface `#ffffff`, rail `#f6f7f9`, ink `#16181d`, on-ink white, letter white. Dark keeps the spike values.
  - The PWA constants, theme boot, `index.html` and manifests use `#f6f7f9` / `#10161b`.
  - The PWA tests assert against the scheme rail, not brand Soft.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib`
- **Parallel with:** none

### Chunk B: shared tokens
- **Skill:** apps-ui
- **Inputs:**
  - Docs selection and frost tokens. `path: packages/apps/src/docs-core/src/docs-workspace.css:461`
  - The derive ladder. `path: packages/apps/src/workspace-shell/src/workspace-derive.css:68`
- **Done when:**
  - Scheme parameters exist for selection hue, strengths and edge; frost fill, blur and shadow; and panel edge and shadow.
  - `workspace-derive.css` publishes `--workspace-selected-background|shadow|color`.
  - `:root` publishes `--frost-background|blur|shadow` and `--sidebar-item-radius`.
- **Verify with:** typecheck, plus Storybook `Themes/Docs` light/dark unchanged from the spike
- **Parallel with:** none

### Chunk C: primitives and shell
- **Skill:** apps-ui
- **Inputs:**
  - `menu-item` selected. `path: packages/apps/src/menu-item/src/menu-item.css:94`
  - `collection-sidebar-row` selected. `path: packages/apps/src/collection-sidebar/src/collection-sidebar-row.css:35`
  - Pressed outline. `path: packages/apps/src/button/src/button.css:197`
  - Account footer. `path: packages/apps/src/workspace-shell/src/workspace-app-layout.css:80`
- **Done when:**
  - Both row primitives paint the selected wash without a hairline. Rows use `--sidebar-item-radius` and are 40px high (`--app-sidebar-item-height`).
  - `pressedStyle="selection"` on Button and IconButton paints the full trio. The default pressed look is unchanged.
  - `app-sidebar` draws the desktop panel edge (rounded end, scheme shadow and hairline).
  - The account footer is the frost card.
  - Main header and chrome footer buttons are borderless with a hover wash.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/button src/menu-item src/collection-sidebar src/app-sidebar src/workspace-shell`
- **Parallel with:** none

### Chunk D: remove duplicates
- **Skill:** apps-ui
- **Inputs:**
  - The Docs-scoped palette and chrome. `path: packages/apps/src/docs-core/src/docs-workspace.css:461`
  - Installer washes. `path: packages/apps/src/installer-core/src/installer.css:19`
- **Done when:**
  - `docs-workspace.css` has no scheme, selection, sidebar, account-card or chrome-button rules, and its frost users read the shared tokens.
  - Per-app `--app-sidebar-border-color` and `--workspace-user-footer-*` copies are gone where they equal the shared default.
  - Installer's wash ladder is gone.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/docs-core src/text-editor-core src/installer-core`, and `rg -n "docs-frost|sidebar-item-selected" packages/apps/src/docs-core` shows only domain uses
- **Parallel with:** none

### Chunk V: cross-app verify
- **Skill:** testing
- **Inputs:** the dev app on the local test API, and Storybook `Themes/*`
- **Done when:**
  - Every app has light and dark screenshots of the sidebar with a selected row, header buttons and the account card.
  - Home, Login and Installer have light screenshots.
  - The apps done gate passes.
- **Verify with:** `pnpm test:apps-done-gate`
- **Parallel with:** none

## Test plan

- [ ] Vitest: PWA colour guards, portal theme vars, suggest controls, format bar.
- [ ] Storybook `Themes/*` light and dark per app (toolbar theme switch).
- [ ] Dev app on the local API: Docs, Drive, Notes, Tasks, Calendar, Contacts, Meet, Settings, Admin, Home, and Login (light).
