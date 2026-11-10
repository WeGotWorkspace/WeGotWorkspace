# Engineering tasks — Save a Word file as a Markdown Doc

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-converter` | builder | workspace, testing | `packages/apps/src/docs-core/src/docx-import/` (scan, converter, report, flow, fixtures), `tools/license-policy.json`, `tools/check-licenses.mjs` | `pnpm --dir packages/apps exec vitest run src/docs-core/src/docx-import`; `node tools/check-licenses.mjs` |
| `chunk-b-entry-points` | builder | workspace, apps-ui | `drive-core/src/drive-workspace.tsx`, `docs-core/src/docs-home-*.ts(x)`, `docs-core/src/use-docs-home-list.ts`, `docs-core/src/docs-app.tsx`, `docs-core/src/docx-import/*.tsx` | jsdom tests; own browser e2e |

## Notes

- Regenerate fixtures with `node src/docs-core/src/docx-import/__tests__/fixtures/build-docx-fixtures.mjs` from `packages/apps`.
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
