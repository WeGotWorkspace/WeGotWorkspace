Source: ad-hoc

# Dark theme (beta)

Ad-hoc beta bonus. No GitHub Task yet.

## Goal

Users can pick Auto (System), Light, or Dark in Settings → Appearance. Dark repaints every workspace on a neutral near-black surface with Soft ink. The choice is a device setting in `localStorage` (`wgw.theme`), not an account setting. `data-theme` on `<html>` is resolved before first paint, so there is no light flash.

## Non-goals

- Account-synced preference (no API or OpenAPI change)
- Dark variants of app icon tiles, chart palettes, or Docs highlight / track-change washes
- PWA `theme-color` meta per theme

## Affected packages

- packages/apps

## Technical constraints

- One swap point: `--theme-surface`, `--theme-sidebar-surface`, `--theme-ink`, `--theme-on-ink`, `--theme-letter` on `:root`, overridden by `:root[data-theme="dark"]`. Tier 2 workspace pairs read these. `workspace-derive.css` recomputes washes, so no per-component dark rules.
- Product sheets that pinned `--workspace-accent: var(--color-we-got-dark)` read `--theme-ink` instead.
- The inline script in `index.html` and `src/lib/theme-preference.ts` share the storage key and resolution rules.

## Edge cases

- Private mode rejects `localStorage`: falls back to Auto, and the in-tab event still updates the UI.
- OS scheme changes while on Auto: a `matchMedia` listener re-applies `data-theme`.
- Other tabs: the `storage` event keeps them in step.
- Meet's light-pair restores inside its dark shell follow the theme tokens.
