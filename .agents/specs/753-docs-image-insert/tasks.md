# Engineering tasks — Docs image insert

**Not** a copy of the GitHub issue `- [ ]` acceptance checklist. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Delivery: Epic [#753](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/753). Tasks [#754](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/754) / [#755](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/755) / [#756](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/756). Goal [#406](https://github.com/WeGotWorkspace/WeGotWorkspace/issues/406).

## Chunks

| id | owner / agent | skill | key paths | verify command | status |
|----|---------------|-------|-----------|----------------|--------|
| `gov-406-spec` | builder | plan-feature, issue-filing | `.agents/specs/753-docs-image-insert/` | `gh issue view 753`; parent #406; body-hash `99db6714`; worktree off origin/main | done |
| `api-doc-attachments` | builder | api | `FileNodeIndexService.php`, `FileNodeSetService.php`, `DriveService.php`, `FileNodeIndexPlugin.php`, `WebdavWriteGuardPlugin.php`, `FlysystemDirectory.php`, `DriveShareAuthorizer.php`, `FileNodeBlobResolver.php`, new `DocAttachmentsService` (name TBD) | `pnpm test:api-done-gate` | pending |
| `ui-drive-media-picker` | builder | apps-ui, workspace | `drive-move-to-dialog.tsx`, `drive-folder-picker.tsx`, `drive-browser.tsx`, `drive-browser.css`, `use-drive-grid-previews.ts`, `docs-home-modals.tsx` | `pnpm test:apps-done-gate` | done (ported into this worktree) |
| `ui-docs-image-insert` | builder | workspace | `text-editor-slash-menu.tsx`, format bar, `text-editor-extensions.ts`, Docs collab Image node view / markdown parse-serialize (pure lib vs orchestrator) | Vitest parse/serialize + RTL insert; `pnpm test:apps-done-gate` | done |
| `verify-753` | verifier | verify-issue | Epic #753 AC vs A+B+C | `gh issue view 753`; done-gates | pending |

## Notes

- Chunk `id` values must match `plan.md` chunk IDs and worktree-agent chunk names (`api-doc-attachments`, `ui-drive-media-picker` get their own worktrees; this branch is `feat/docs-image-insert`).
- Update **status** as chunks complete (`pending` → `done`).
- On scope change: update **Epic #753** first, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
- Do **not** implement A/B/C on the dirty `/Users/woutervroege/sabre-installer` checkout.
- Parallel A + B after Chunk 0; C after A + B; V last.
- `FileNodeIndexService::isIndexedDotSegment` on origin/main (Chunk 0 re-grep): `.Trash`, `.notes`, `.archive` under `.notes` only. Add `.attachments` beside `.Trash`.
