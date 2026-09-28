# Engineering tasks — vitest-ci plays on risk paths

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `chunk-a-share-play` | builder | storybook | `packages/apps/src/share-ui/stories/share-dialog.stories.tsx`, `share-dialog.fixtures.ts` | `STORYBOOK_VITEST_SMOKE=1 STORYBOOK_A11Y_GATE=1 pnpm test:storybook:ci` | done |
| `chunk-b-trash-plays` | builder | storybook | `packages/apps/src/drive-core/stories/`, `packages/apps/src/docs-core/stories/docs-home.stories.tsx` | same smoke command | done |
