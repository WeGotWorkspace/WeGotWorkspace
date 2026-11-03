# Engineering tasks — Rescue notice bar

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id                   | owner / agent | skill     | key paths                                                                                                                                                  | verify command                                                                                                                |
| -------------------- | ------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `chunk-a-options`    | builder       | storybook | `packages/apps/src/notice-bar/`, `packages/apps/src/workspace-shell/src/workspace-app-layout.tsx`, `packages/apps/src/tasks-core/src/tasks-workspace*.ts*` | `pnpm --dir packages/apps exec vitest run --project storybook src/notice-bar/stories/notice-bar.stories.tsx`                  |
| `chunk-b-wire-tasks` | builder       | apps-ui   | `packages/apps/src/tasks-core/src/tasks-app.tsx`, `packages/apps/src/rescue-ui/`, `packages/apps/src/tasks-core/src/tasks-labels.ts`                       | `pnpm --dir packages/apps test` and `playwright test -c playwright.matrix.config.mjs tasks-sync-matrix -g "rescued\|sharing"` |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- `chunk-b-wire-tasks` starts only after both Open decisions in `plan.md` are made.
