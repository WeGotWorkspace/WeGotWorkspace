# Engineering tasks — Default collection settings

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece**.

Source spec: [spec.md](./spec.md)
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `file-spec` | builder | plan-feature | `.agents/specs/983-default-collections/` | `gh issue view 983` |
| `default-prefs` | builder | apps-ui | `packages/apps/src/lib/default-collection-prefs.ts`, `packages/apps/src/lib/app-picker-collections.ts` | `pnpm --dir packages/apps exec vitest run src/lib/default-collection-prefs.test.ts` |
| `collection-panes` | builder | workspace, storybook | `settings-default-collection-pane.tsx`, `register-builtin-settings.tsx`, `settings-types.ts` | `pnpm --dir packages/apps exec vitest run src/settings-core/src/settings-registry.test.ts src/settings-core/src/settings-default-collection-pane.test.tsx` |
| `create-wiring` | builder | workspace | `use-tasks-shell.tsx`, `contacts-edit-utils.ts`, `notes-create-target.ts` | `pnpm --dir packages/apps exec vitest run src/tasks-core/src/tasks-task-utils.test.ts src/contacts-core/src/contacts-edit-utils.test.ts src/notes-core/src/notes-create-target.test.ts` |

## Notes

- Chunk `id` values must match `plan.md`.
- On scope change: update Task #983 first, then re-sync spec/plan/tasks and the `Source:` body-hash.
