# Engineering tasks — Tasks notice bar

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id                      | owner / agent | skill   | key paths                                                                                                                                                  | verify command                                                                                                                                             |
| ----------------------- | ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chunk-a-notice-bar`    | builder       | apps-ui | `packages/apps/src/notice-bar/`, `packages/apps/src/workspace-shell/src/workspace-app-layout.tsx`, `packages/apps/src/tasks-core/src/tasks-workspace*.ts*` | `pnpm --dir packages/apps exec vitest run src/notice-bar` and `vitest run --project storybook src/notice-bar`                                              |
| `chunk-b-rescue-notice` | builder       | apps-ui | `packages/apps/src/rescue-ui/`, `packages/apps/src/tasks-core/src/tasks-app.tsx`, `packages/apps/src/tasks-core/src/tasks-labels.ts`                       | `vitest run src/tasks-core/src/tasks-rescue-dialog.test.tsx` and `playwright test -c playwright.matrix.config.mjs tasks-sync-matrix -g "rescued\|sharing"` |
| `chunk-c-sync-notice`   | builder       | apps-ui | `packages/apps/src/tasks-core/src/use-tasks-sync-notice.tsx`, `packages/apps/src/lib/offline/use-failed-outbox-count.ts`, `use-*-failed-sync.ts`           | `vitest run src/tasks-core/src/use-tasks-sync-notice.test.tsx src/notes-core src/contacts-core`                                                            |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and multitask handoff names.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Notes, Contacts, Docs, Drive and Calendar move to the bar in #1895.
