# Engineering tasks — One shared list component (#1641 step d)

**Not** a copy of the GitHub issue checklist. One row per chunk; one PR per chunk.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-shared-list-notes` | builder | workspace | `packages/apps/src/workspace-list/src/`, `packages/apps/src/notes-core/src/notes-list-panel.tsx`, `notes-list-row.tsx`, `packages/apps/scripts/measure-list-frames.mjs`, `packages/apps/e2e/notes-list-windowed.spec.ts` | `pnpm --dir packages/apps exec vitest run src/workspace-list src/notes-core` |
| `chunk-b-contacts` | builder | workspace | `packages/apps/src/contacts-core/src/contacts-list-panel.tsx`, `contacts-list-row.tsx`, `contacts-list-rows.ts` (delete `contacts-list-window.ts`) | `pnpm --dir packages/apps exec vitest run src/contacts-core` |
| `chunk-c-tasks` | builder | workspace | `packages/apps/src/tasks-core/src/tasks-list-panel.tsx`, `tasks-list-row.tsx`, `packages/apps/e2e/helpers/tasks-matrix.ts` | `pnpm --dir packages/apps exec vitest run src/tasks-core` |
| `chunk-d-drive` | builder | workspace | `packages/apps/src/drive-core/src/drive-browser.tsx`, `use-drive-tiles-in-view.ts` | `pnpm --dir packages/apps exec vitest run src/drive-core` |
| `chunk-e-docs-home` | builder | workspace | `packages/apps/src/docs-core/src/docs-home-pane.tsx` | `pnpm --dir packages/apps exec vitest run src/docs-core` |
| `chunk-f-chat` | builder | workspace | `packages/apps/src/chat-ui/src/chat-message-list.tsx`, `chat-message.tsx` | `pnpm --dir packages/apps exec vitest run src/chat-ui` |

## Notes

- Every chunk adds its scenarios to `packages/apps/scripts/measure-list-frames.mjs` and reports before/after numbers in its PR.
- Every chunk is list behaviour (scroll, focus, animation): own browser e2e plus screenshots, and the PR is marked for Wouter's eyes.
