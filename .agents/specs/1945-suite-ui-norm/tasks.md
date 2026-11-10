# Engineering tasks — Suite UI norm from the Docs spike

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-scheme` | builder | apps-ui | `packages/apps/src/styles.css`, `src/lib/theme-preference.ts`, `public/assets/theme-boot.js`, `index.html`, `public/manifests/*.webmanifest` | `pnpm --dir packages/apps exec vitest run src/lib` |
| `chunk-b-tokens` | builder | apps-ui | `src/styles.css`, `src/workspace-shell/src/workspace-derive.css` | `pnpm --dir packages/apps run typecheck` + Storybook Themes light/dark |
| `chunk-c-primitives` | builder | apps-ui | `src/menu-item/src/menu-item.css`, `src/collection-sidebar/src/collection-sidebar-row.css`, `src/button/src/button.css`, `src/app-sidebar/src/app-sidebar.css`, `src/workspace-shell/src/workspace-app-layout.css`, `src/workspace-shell/src/workspace-chrome-footer.css` | `pnpm --dir packages/apps exec vitest run src/button src/menu-item src/collection-sidebar src/app-sidebar src/workspace-shell` |
| `chunk-d-cleanup` | builder | apps-ui | `src/docs-core/src/docs-workspace.css`, `src/*-core/src/*-workspace.css`, `src/workspace-shell/src/workspace-split-app.css`, `src/installer-core/src/installer.css` | `pnpm --dir packages/apps exec vitest run src/docs-core src/text-editor-core src/installer-core` |
| `chunk-v-verify` | parent | testing | every app in the dev app and Storybook `Themes/*` | screenshots light + dark per app; `pnpm test:apps-done-gate` |
