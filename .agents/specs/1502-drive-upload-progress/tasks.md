# Engineering tasks — Drive upload progress

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks which chunk implements which technical piece.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id                     | owner / agent | skill     | key paths                                                                                                                                                                   | verify command                                                                                            |
| ---------------------- | ------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `chunk-a-store`        | builder       | testing   | `packages/apps/src/lib/offline/drive/upload/drive-upload-store.ts`, `drive-upload-queue-watch.ts`, `drive-upload-subscription.ts`                                           | `pnpm --dir packages/apps exec vitest run --project unit src/lib/offline/drive/upload`                    |
| `chunk-b-ring`         | builder       | workspace | `packages/apps/src/ui/progress.tsx`, `packages/apps/src/drive-core/src/drive-upload-row-state.ts`, `drive-upload-ring.tsx`, `drive-browser.tsx`                             | `pnpm --dir packages/apps exec vitest run --project jsdom src/drive-core/src/drive-browser.test.tsx`      |
| `chunk-c-uploads-view` | builder       | workspace | `packages/apps/src/drive-core/src/drive-uploads-pane.tsx`, `files-browser-sidebar.ts`, `use-drive-sidebar-model.tsx`, `drive-visible-items.ts`                              | `pnpm --dir packages/apps exec vitest run --project jsdom src/drive-core/src/drive-uploads-pane.test.tsx` |
| `chunk-d-copy-stories` | builder       | workspace | `packages/apps/src/drive-core/src/use-drive-upload-batch-toasts.ts`, `drive-upload-announcer.tsx`, `packages/apps/src/drive-core/stories/drive-upload-progress.stories.tsx` | `pnpm --dir packages/apps test:storybook:ci`                                                              |

## Notes

- Chunk `id` values match `plan.md`.
- On scope change: update #1502 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
