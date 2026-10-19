# Engineering tasks — Dark theme (beta)

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-dark-theme` | builder | apps-ui | `packages/apps/src/styles.css`, `packages/apps/src/lib/theme-preference.ts`, `packages/apps/src/settings-core/src/settings-appearance-pane.tsx`, `packages/apps/index.html` | `pnpm --dir packages/apps exec vitest run src/lib/theme-preference.test.ts src/settings-core` |
