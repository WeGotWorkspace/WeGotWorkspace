# Engineering tasks — Import a Word file as a new Doc

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-entry-point` | builder | workspace, apps-ui | `docs-core/src/docs-home-sidebar.tsx`, `docs-core/src/docs-home-modals.tsx`, `docs-core/src/docs-home-workspace.tsx`, `docs-core/src/use-docs-home-create-dialog.ts`, `docs-core/src/docx-import/use-import-word-file.tsx`, `docs-core/stories/docx-import-report.stories.tsx` | `pnpm --dir packages/apps exec vitest run src/docs-core`; own browser e2e |

## Notes

- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
