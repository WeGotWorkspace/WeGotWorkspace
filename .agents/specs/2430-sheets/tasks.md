# Engineering tasks — Sheets

**Not** a copy of the GitHub issue `- [ ]` acceptance checklists. This file tracks **which agent/chunk implements which technical piece** for multitask and worktree handoffs.

Source spec: [spec.md](./spec.md)  
Source plan: [plan.md](./plan.md)

Do not record chunk completion here. The GitHub issue and the test or file that proves the claim are the record.

`sheets-core` below means `packages/apps/src/sheets-core/src/`.

## Chunks

| id | issue | owner / agent | skill | key paths | verify command |
|----|-------|---------------|-------|-----------|----------------|
| `chunk-a-collab-lift` | #2431 | builder | workspace | `packages/apps/src/lib/collab/`, `packages/apps/src/text-editor-core/docs-collab/` | `pnpm --dir packages/apps exec vitest run src/lib/collab src/text-editor-core/docs-collab` |
| `chunk-b-file-registry` | #2445 | builder | api | registry source at repo root, `packages/apps/src/lib/files/docs-collab-text-files.ts`, `packages/api/app/Services/Drive/CollabDocFormats.php`, `packages/api/app/Services/Collab/DocCollabDocumentService.php` | `composer --working-dir packages/api done-gate` |
| `chunk-c-ycsv-spec` | #2432 | builder | document | `docs/architecture/ycsv-spec.md`, `sheets-core/file/fixtures/` | `pnpm run check:agent-docs` |
| `chunk-d-file` | #2433 | builder | workspace | `sheets-core/file/` | `pnpm --dir packages/apps exec vitest run src/sheets-core/src/file` |
| `chunk-e-model` | #2434 | builder | workspace | `sheets-core/model/` | `pnpm --dir packages/apps exec vitest run src/sheets-core/src/model` |
| `chunk-f-formula` | #2435 | builder | workspace | `sheets-core/formula/` | `pnpm --dir packages/apps exec vitest run src/sheets-core/src/formula` |
| `chunk-g-engine` | #2436 | builder | workspace | `sheets-core/engine/`, `packages/apps/scripts/` (measure harness) | `pnpm --dir packages/apps run measure:sheets` |
| `chunk-h-collab-shape` | #2437 | builder | workspace | `sheets-core/collab/`, `packages/apps/e2e/sheets-collab.spec.ts` | `pnpm --dir packages/apps exec playwright test e2e/sheets-collab.spec.ts` |
| `chunk-i-grid-core` | #2438 | builder | apps-ui | `sheets-core/grid/` (window, focus, selection, editor, formula bar, tabs) | `pnpm --dir packages/apps exec playwright test e2e/sheets-a11y.spec.ts` |
| `chunk-j-grid-ops` | #2439 | builder | apps-ui | `sheets-core/grid/` (fill, clipboard, context menu), `packages/apps/e2e/sheets-grid-ops.spec.ts` | `pnpm --dir packages/apps exec playwright test e2e/sheets-grid-ops.spec.ts` |
| `chunk-k-grid-presence-a11y` | #2440 | builder | apps-ui | `sheets-core/grid/usePeers*`, `useAnnouncer*`, `useRemoteDigest*`; shared digest in `packages/apps/src/lib/` | `pnpm --dir packages/apps exec playwright test e2e/sheets-a11y.spec.ts` |
| `chunk-l-grid-touch` | #2441 | builder | apps-ui | `sheets-core/grid/useTouch*`, `packages/apps/e2e/sheets-touch.spec.ts` | `pnpm --dir packages/apps exec playwright test e2e/sheets-touch.spec.ts` |
| `chunk-m-app-shell` | #2442 | builder | workspace | Sheets `*App` / `*Workspace`, Drive routing and "New → Sheet", `packages/apps/e2e/sheets-app.spec.ts` | `pnpm test:apps-done-gate` |
| `chunk-n-import` | #2443 | builder | workspace | `sheets-core/interop/import/`, import dialog wiring | `pnpm --dir packages/apps exec vitest run src/sheets-core/src/interop` |
| `chunk-o-export` | #2444 | builder | workspace | `sheets-core/interop/export/`, download menus | `pnpm --dir packages/apps exec vitest run src/sheets-core/src/interop` |
| `chunk-v-verify` | — | verifier | testing | read-only | [multitask-verifier](../../skills/developer/multitask-verifier.md) report + [done-checklist](../../skills/developer/done-checklist.md) |

## Notes

- Chunk `id` values match `plan.md` chunk IDs and multitask handoff names.
- Waves: A + B + C → D + F → E → G + H → I → J + K + L → M; N + O run alongside the grid wave once D, E and F are on main.
- Chunks A and B agree on shape ids first: `markdown`, `text-fields`, `ycsv`.
- Chunks I, J, K and L all touch `sheets-core/grid/`: I lands first and fixes the hook seams; J, K and L each own their own hooks and do not edit another chunk's hook files.
- `chunk-l-grid-touch` does not build the selection gesture until decision 5 is taken (see plan Open decisions).
- On scope change: update the **issue first**, then re-sync spec/plan/tasks and the `Source:` body-hash in spec.md.
