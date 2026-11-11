# Engineering tasks — Guide Google Docs users in through a Word export

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-guidance-fixture` | builder | workspace, testing | `docs-core/src/docs-labels.ts`, `docs-core/src/docx-import/docx-import-labels.ts`, `docs-core/src/docx-import/use-import-word-file.tsx`, `docs-core/src/docx-import/docx-to-markdown.ts`, `docs-core/src/docx-import/__tests__/fixtures/` | `pnpm --dir packages/apps exec vitest run src/docs-core` |

## Notes

- Product decision 2026-11-10: no hint under the *Import docx file(s)* menu item and no Google steps in the empty state; the `.gdoc` dialog is the only place that explains the Google route. The synthetic `google-export.docx` counts as the Google export test.
- Regenerate fixtures with `node src/docs-core/src/docx-import/__tests__/fixtures/build-docx-fixtures.mjs` from `packages/apps`.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
