# Engineering tasks — Docs pages and page break

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

## Chunks

| id | owner / agent | skill | key paths | verify command |
|----|---------------|-------|-----------|----------------|
| `chunk-a-page-format` | builder | apps-ui | `packages/apps/src/lib/page-format.ts`, `packages/apps/src/lib/docs-page-setup.ts` | `pnpm --dir packages/apps exec vitest run src/lib/page-format.test.ts src/lib/docs-page-setup.test.ts` |
| `chunk-b-page-break` | builder | apps-ui | `packages/apps/src/text-editor-core/src/text-editor-page-break.ts`, `text-editor-slash-commands.ts` | `pnpm --dir packages/apps exec vitest run src/text-editor-core/src/text-editor-page-break.test.ts` |
| `chunk-c-pagination` | builder | apps-ui | `packages/apps/src/text-editor-core/src/text-editor-pagination.ts`, `text-editor-page-break-fill.ts`, `text-editor-page-rows.ts`, `text-editor.css` | `pnpm --dir packages/apps exec vitest run src/text-editor-core/src/text-editor-pagination.test.ts src/text-editor-core/src/text-editor-page-break-fill.test.ts` |
| `chunk-d-header-menu` | builder | apps-ui | `packages/apps/src/docs-core/src/docs-page-setup-menu.tsx`, `docs-collab-workspace.tsx` | browser check |
