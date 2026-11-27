# Sheets: live-collaborative spreadsheets on YCSV

Derived from [spec.md](./spec.md). Chunk layout for parallel or sequential implementation of Epic #2430.

## Goal

Ship a Sheets app on YCSV that reuses the Docs collab engine through a document-shape registry, keeps a typical edit within one frame at ~250k cells, and imports from and exports to the common spreadsheet apps. Order: collab lift + spec → `sheets-core` → grid → app shell and import/export. Touch and accessibility are part of the grid wave.

## Budget

Draws from the Docs collab engine (lifted to `src/lib/collab`, not copied) and the existing traffic budget (Epic #2284): Sheets adds no request loop of its own and rides the collab session's existing transport, push doorbell and save debounce. Displaces the hand-kept collab extension allowlists (client and API), which become one registry. Does not draw from incremental saves (#2446): Sheets v1 ships on today's whole-state save with per-shape caps.

## Non-goals

- Incremental collab saves and epoch compaction (#2446).
- Awareness over the HTTP mailbox fallback (#2447).
- Sheets beyond ~250k cells. Sheets above ~250k cells go through #2446 (incremental saves and epoch compaction, under WeGotWorkspace/Product#153): its per-request cap plus a soft per-document cap that triggers compaction replace the hard caps that bind v1. Subdocuments for still larger sheets are untested and not planned.
- Charts, pivot tables, conditional formatting, macros, per-row height, wrapped text, ODS / Numbers export.

## What exists

- The client collab allowlist is a hand-kept set of 13 text extensions, `csv` included, all routed to Docs. `path: packages/apps/src/lib/files/docs-collab-text-files.ts:4`
- The API collab allowlist maps only `md` and `markdown`, and share rules, thread access and attachments ask it. `path: packages/api/app/Services/Drive/CollabDocFormats.php:10`, `path: packages/api/app/Services/Drive/DriveShareRules.php:114`
- Save caps are fixed for every shape: 2 MiB text, 5 MiB Yjs, answered with `413 yjs_too_large`. `path: packages/api/app/Services/Collab/DocCollabDocumentService.php:30`, `path: packages/api/app/Services/Collab/DocCollabDocumentService.php:136`, `path: packages/api/tests/Feature/Collab/CollabDocumentEndpointsTest.php:408`
- The engine still branches on `textFields ? … : markdown` in the save body and pending upload, the seam spike 5 replaced with a registered shape. `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-save-body.ts:48`, `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-pending-upload.ts:74`
- Part of the engine already sits in `src/lib/collab` (content codec, persistence, text-fields shape keys). `path: packages/apps/src/lib/collab/collab-content-codec.ts:10`, `path: packages/apps/src/lib/collab/docs-collab-text-fields-shape.ts:10`
- The HTTP mailbox fallback sends only `yjs` and `yjs-sv` messages (awareness gap, #2447). `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-http-sync.ts:44`
- A list windowing helper exists to reuse for rows and columns. `path: packages/apps/src/workspace-list/src/workspace-list-window.ts:9`
- No Sheets code and no YCSV spec are on main before this PR: `.csv` is collab-editable only as a Docs text file today (`path: packages/apps/src/lib/files/docs-collab-text-files.ts:5`). The original spec is on `feat/spreadsheet-core` and the amended copy on `spike/sheets-interop` ([spec.md](./spec.md#sources)).
- Spike results (report, integration slice, spike 10, spike 11) are listed in [spec.md](./spec.md#sources); measured numbers are cited per chunk below from those write-ups.

## Considered

Considered: the existing Docs collab engine (`text-editor-core/docs-collab`) — chosen and lifted to `src/lib/collab` with a shape registry, because spike 5 ran a `ycsv` shape on it unchanged apart from about eight shape branches; a separate Sheets sync stack was rejected as a second copy of transport, offline and save logic. Considered: a canvas grid library — rejected for spike 6's DOM grid with one overlay, which spikes 7 and 8 showed holds touch and screen readers, and spike 4 showed holds 60 fps with windowing. Considered: today's row layout (`Y.Array` of rows) — rejected for spike 9's order + data layout, which lost 0 edits in 1,000 4-peer fuzz runs against 24% lost. Considered: the worker owning the `Y.Doc` — rejected for a worker replica, because the collab session needs `RTCPeerConnection` on the main thread and every keystroke would gain an async hop. Considered: npm `xlsx` — rejected (0.18.5, known CVEs) for SheetJS CE from its CDN tarball; SheetJS and other writers rejected for export in favour of exceljs (135/135 cells after recalculation). Considered: waiting for incremental saves (#2446) — rejected by decision 11; gzip + per-shape caps cover ~250k cells. Considered: the YCSV spec inside `packages/apps/docs/` (where the original lived) — rejected for `docs/architecture/ycsv-spec.md`, because the API, import/export and outside tools read it too. Considered for touch (decision 5): variant A (no range handles) — rejected, a block cannot be selected by finger; variant C, Calendar's 160 ms hold-to-drag — rejected, unsafe on a grid (spike 7, `prototypes/ycsv/docs/spike-7-touch.md` section "Variant C"); chosen variant B, range handles like Calendar's touch resize handles. Hold-drag on headers (250 ms) is left out of v1, optional after a real-phone test.

## Affected packages

- packages/apps
- packages/api
- docs

## Dependencies

1. Wave 1, parallel: chunk A (collab lift), chunk B (file registry + caps), chunk C (YCSV v1.1 spec doc).
2. Chunk D (file parser/serializer) after C. Chunk F (formula) after C, parallel with D.
3. Chunk E (model) after D.
4. Chunk G (engine) after E and F. Chunk H (collab shape) after A and E. G and H run in parallel.
5. Chunk I (grid core) after E, F and G (it can start on `InThreadValues` once G's `ValueSource` interface lands).
6. After I, parallel: chunk J (grid ops), chunk K (presence + a11y, also needs H), chunk L (touch, variant B).
7. Chunk M (app shell) after B, H and I.
8. Chunk N (import) and chunk O (export) after D, E and F; parallel with each other and with the grid wave.
9. Chunk V (cross-chunk verify) last.

## Open decisions

None — every choice for this work is made. Decision 5 (touch: variant B) and spec conflict K2 (duplicate column ref = header text, `'omzet 2'3`) were decided on 2026-11-27.

## Invariants

- Docs, Notes and Tasks collab behave exactly as before the lift. A wrong change breaks live editing or saving in apps that already work. Proof: `path: packages/apps/src/text-editor-core/docs-collab/collab-app-conformance.test.ts`, `path: packages/apps/src/text-editor-core/docs-collab/collab-transport-conformance.test.ts`, `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-save-body.test.ts` (chunk A boundary).
- Text extensions other than `csv` keep opening in Docs, and the client and API lists cannot drift. A wrong change sends `.json` or `.md` to Sheets or refuses a Docs save. Proof: `path: packages/apps/src/lib/files/docs-collab-text-files.test.ts` "matches the shared extension allowlist", `path: packages/api/tests/Unit/Drive/CollabDocFormatsTest.php` (chunk B boundary).
- Docs save caps stay at 2 MiB text / 5 MiB Yjs; only the `ycsv` shape gets raised caps and a gzip sidecar. A wrong change lets any document grow past the PHP memory budget. Proof: `path: packages/api/tests/Feature/Collab/CollabDocumentEndpointsTest.php` (`yjs_too_large` case, chunk B adds the `ycsv` case).
- Parse → serialise of a decided corpus case returns the same bytes; empty rows keep their number. A wrong change loses trailing rows or splits a quoted `---`. Proof: `path: packages/apps/src/sheets-core/src/file/conformance.test.ts` (added in chunk D).
- Concurrent moves and sorts lose no edits and create no duplicates. A wrong change brings back the 24% loss of the old layout. Proof: `path: packages/apps/src/sheets-core/src/model/order.fuzz.test.ts` (added in chunk E).
- Renaming a sheet or a column never rewrites a formula. A wrong change breaks every formula that names it. Proof: `path: packages/apps/src/sheets-core/src/model/refs.test.ts` (added in chunk E).
- Undo never silently removes a peer's work. A wrong change deletes a row a colleague typed in. Proof: `path: packages/apps/src/sheets-core/src/collab/undo.test.ts` (added in chunk H).
- A typical edit at 25k × 10 paints within one frame and the main thread stays under one frame for the worst case with the worker. A wrong change freezes large sheets. Proof: `cmd: pnpm --dir packages/apps run measure:sheets` (harness moved in chunk G).
- The grid stays accessible: 0 axe-core violations in the documented states. Proof: `path: packages/apps/e2e/sheets-a11y.spec.ts` (added in chunk I, extended in K).
- Sheets adds no network poll. A wrong change breaks the shared-hosting budget. Proof: `path: tools/network-polls-ratchet.test.mjs`.
- No new source file over 800 lines; no app-to-app import. Proof: `cmd: pnpm run check:file-size` and `cmd: pnpm run check:import-boundaries`.
- After each chunk, main still works without the next one (no chunk wires Sheets into Drive before chunk M). Proof: `cmd: pnpm --dir packages/apps exec vitest run` and `cmd: composer --working-dir packages/api done-gate` per PR.

## Chunks

### Chunk A: Collab engine lift + document-shape registry

- **id:** `chunk-a-collab-lift`
- **Issue:** #2431
- **Skill:** workspace
- **Inputs:** shape branches in the engine — `path: packages/apps/src/text-editor-core/docs-collab/docs-collab-save-body.ts:48`; text-fields shape keys already in lib — `path: packages/apps/src/lib/collab/docs-collab-text-fields-shape.ts:10`; spike 5 shape seam (`prototypes/ycsv/docs/spike-5-collab-and-reuse.md` on `spike/sheets-collab`).
- **Done when:** #2431 AC hold: the shape-agnostic modules live in `src/lib/collab`; seed / read / recognise / save content type come from a registered shape; text fields and the TipTap/markdown codec are registered shapes; a dummy shape saves through the queue in a test; Docs/Notes/Tasks suites green; [verify-issue](../../skills/verify-issue/SKILL.md) on #2431.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/lib/collab src/text-editor-core/docs-collab`, `pnpm run check:import-boundaries`, `pnpm run check:file-size`.
- **Parallel with:** `chunk-b-file-registry`, `chunk-c-ycsv-spec`.

### Chunk B: One collab file registry + per-shape caps

- **id:** `chunk-b-file-registry`
- **Issue:** #2445
- **Skill:** api
- **Inputs:** client allowlist — `path: packages/apps/src/lib/files/docs-collab-text-files.ts:4`; API allowlist — `path: packages/api/app/Services/Drive/CollabDocFormats.php:10`; caps — `path: packages/api/app/Services/Collab/DocCollabDocumentService.php:30`.
- **Done when:** #2445 AC hold: one checked-in registry (extension → shape → app) read by client and API, CI check against drift; `.csv` / `.ycsv` → `ycsv` shape; per-shape caps with gzip sidecar for `ycsv`; CSV dialect kept on write; API feature tests and API done gate green. Shape ids agreed with chunk A: `markdown`, `text-fields`, `ycsv`.
- **Verify with:** `composer --working-dir packages/api done-gate`, `pnpm --dir packages/apps exec vitest run src/lib/files`.
- **Parallel with:** `chunk-a-collab-lift`, `chunk-c-ycsv-spec`.

### Chunk C: YCSV v1.1 spec doc

- **id:** `chunk-c-ycsv-spec`
- **Issue:** #2432
- **Skill:** document
- **Inputs:** `docs/architecture/ycsv-spec.md` (source of truth; started from `prototypes/ycsv/upstream/ycsv-spec-v1-clean.md` on `spike/sheets-interop`, commit 6529b3757, which may lag behind); Appendix B decisions and conflicts K1–K22 in the amended copy on the same branch; conformance corpus (70 cases) in `prototypes/ycsv/docs/spike-11-conformance-results.md` on `spike/sheets-interop`.
- **Done when:** #2432 AC hold: `docs/architecture/ycsv-spec.md` names Epic #2430 and links this folder (done in the spec PR, K2 included in §4.4); corpus fixtures under `packages/apps/src/sheets-core/src/file/fixtures/`; every decided case has an expected result.
- **Verify with:** `pnpm run check:agent-docs`.
- **Parallel with:** `chunk-a-collab-lift`, `chunk-b-file-registry`.

### Chunk D: Shared YCSV / CSV parser and serializer

- **id:** `chunk-d-file`
- **Issue:** #2433
- **Skill:** workspace
- **Inputs:** spike 11 helpers `interop/csv/detect-header.ts`, `resolve-columns.ts`, `header-refs.ts` on `spike/sheets-interop`; known parser bugs (trailing empty rows, quoted `---`) in the report's "Bugs and findings worth keeping".
- **Done when:** #2433 AC hold; every decided corpus case passes; byte-for-byte multi-sheet round trip; Vitest on every export; [security](../../skills/security/SKILL.md) checklist for a caller-input parser.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/sheets-core/src/file`.
- **Parallel with:** `chunk-f-formula`.

### Chunk E: Workbook model

- **id:** `chunk-e-model`
- **Issue:** #2434
- **Skill:** workspace
- **Inputs:** integration slice `src/sheets-core/model/` and its Yjs layout (`prototypes/ycsv/docs/integration-slice.md` on `spike/sheets-integration`); spike 9 fuzz; quadratic seed fix (spike 4/5).
- **Done when:** #2434 AC hold; spike 9 fuzz in CI at a reduced run count with 0 lost / 0 duplicated edits; column ids in formulas; `SheetHandle` test hook.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/sheets-core/src/model`.
- **Parallel with:** `chunk-f-formula` (once D's types are on main).

### Chunk F: Formula language

- **id:** `chunk-f-formula`
- **Issue:** #2435
- **Skill:** workspace
- **Inputs:** spike 11 formula corpus (80 of 112 match LibreOffice today) and `interop/notation/notation.ts` on `spike/sheets-interop`; integration slice `src/ycsv-formula/*` with cross-sheet refs.
- **Done when:** #2435 AC hold; corpus results match LibreOffice for every function in the v1 set, with deliberate differences listed in the PR.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/sheets-core/src/formula`.
- **Parallel with:** `chunk-d-file`, `chunk-e-model`.

### Chunk G: Incremental engine in a worker

- **id:** `chunk-g-engine`
- **Issue:** #2436
- **Skill:** workspace
- **Inputs:** spike 4 engine and `measure` harness on `spike/sheets-perf`; integration slice `src/sheets-core/engine/` (`WorkbookEngine`, `InThreadValues`, `WorkerValues`).
- **Done when:** #2436 AC hold; `measure:sheets` script in `packages/apps` reports 25k × 10 typical edit ≤ 1 frame; a 5,000-row chain evaluates without recursion.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/sheets-core/src/engine`, `pnpm --dir packages/apps run measure:sheets`.
- **Parallel with:** `chunk-h-collab-shape`.

### Chunk H: Collab shape, presence payload, guarded undo

- **id:** `chunk-h-collab-shape`
- **Issue:** #2437
- **Skill:** workspace
- **Inputs:** shape registry from chunk A; spike 5 `ycsv` shape and two-browser e2e (`packages/apps/e2e/sheets-spike-collab.spec.ts` on `spike/sheets-integration`); spike 9 `guardedUndo`.
- **Done when:** #2437 AC hold; two-browser Playwright e2e against the local API green four runs in a row.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/sheets-core/src/collab`, `pnpm --dir packages/apps exec playwright test e2e/sheets-collab.spec.ts`.
- **Parallel with:** `chunk-g-engine`.

### Chunk I: Grid core

- **id:** `chunk-i-grid-core`
- **Issue:** #2438
- **Skill:** apps-ui
- **Inputs:** integration slice `SheetGrid.tsx` (2,946 lines, to split) and `WorkbookView.tsx`; spike 8 focus and windowing rules; spike 7 stepped window; `path: packages/apps/src/workspace-list/src/workspace-list-window.ts:9`.
- **Done when:** #2438 AC hold; split into the hooks named in [spec.md](./spec.md#module-boundaries-packagesappssrcsheets-coresrc), no file over 800 lines; mock-tier stories; axe 0 violations; suite UI norm in light and dark.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/sheets-core/src/grid`, `pnpm --dir packages/apps exec playwright test e2e/sheets-a11y.spec.ts`, Storybook smoke.
- **Parallel with:** `chunk-n-import`, `chunk-o-export`.

### Chunk J: Grid fill, clipboard, row and column operations

- **id:** `chunk-j-grid-ops`
- **Issue:** #2439
- **Skill:** apps-ui
- **Inputs:** spike 6 fill, clipboard and row/column ops (`prototypes/ycsv/docs/spike-6-cell-ux.md` on `spike/sheets-ux`); model ops from chunk E.
- **Done when:** #2439 AC hold; interaction tests in Chromium, WebKit and Firefox; one real paste fixture from Excel, Google Sheets and Numbers.
- **Verify with:** `pnpm --dir packages/apps exec playwright test e2e/sheets-grid-ops.spec.ts`.
- **Parallel with:** `chunk-k-grid-presence-a11y`, `chunk-l-grid-touch`.

### Chunk K: Grid presence and screen-reader announcements

- **id:** `chunk-k-grid-presence-a11y`
- **Issue:** #2440
- **Skill:** apps-ui
- **Inputs:** spike 8 speech functions, announcer and remote digest (`prototypes/ycsv/docs/spike-8-a11y.md` on `spike/sheets-a11y`); presence payload from chunk H.
- **Done when:** #2440 AC hold; digest and speech functions in `src/lib`; a person ran the spike 8 VoiceOver checklist and the result is in the PR; [accessibility](../../skills/accessibility/SKILL.md) skill checklist.
- **Verify with:** `pnpm --dir packages/apps exec playwright test e2e/sheets-a11y.spec.ts`.
- **Parallel with:** `chunk-j-grid-ops`, `chunk-l-grid-touch`.

### Chunk L: Grid touch

- **id:** `chunk-l-grid-touch`
- **Issue:** #2441
- **Skill:** apps-ui
- **Inputs:** spike 7 touch model and 56 emulated touch tests (`prototypes/ycsv/docs/spike-7-touch.md` on `spike/sheets-touch`); decision 5 = variant B (#2441); variant C hold-drag code on `spike/sheets-touch` stays out of v1.
- **Done when:** #2441 AC hold: range handles with the start knob clipped to the cell side, header-menu moves, fill via callout/menu, long-press 500 ms; any gesture helper put in `src/lib` takes a hold time per surface; one real iPhone and Android pass with the spike 7 checklist.
- **Verify with:** `pnpm --dir packages/apps exec playwright test e2e/sheets-touch.spec.ts`.
- **Parallel with:** `chunk-j-grid-ops`, `chunk-k-grid-presence-a11y`.

### Chunk M: App shell and Drive

- **id:** `chunk-m-app-shell`
- **Issue:** #2442
- **Skill:** workspace
- **Inputs:** registry from chunk B; shape from chunk H; grid from chunk I; `packages/apps/docs/workspace-shells.md`.
- **Done when:** #2442 AC hold; e2e from Drive "New → Sheet" to an edited, reopened sheet; `.csv` → `.ycsv` prompt; size warning; outside-write dialog; reader/commenter read-only.
- **Verify with:** `pnpm --dir packages/apps exec playwright test e2e/sheets-app.spec.ts`, apps done gate.
- **Parallel with:** `chunk-n-import`, `chunk-o-export`.

### Chunk N: Import with an import report

- **id:** `chunk-n-import`
- **Issue:** #2443
- **Skill:** workspace
- **Inputs:** spike 11 importer and fixture workbooks on `spike/sheets-interop`; existing import queue (`.agents/specs/2388-import-queue/`).
- **Done when:** #2443 AC hold; SheetJS CE pinned from the CDN tarball; every loss in the report; [security](../../skills/security/SKILL.md) checklist for uploaded files.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/sheets-core/src/interop`.
- **Parallel with:** `chunk-o-export`, `chunk-i-grid-core`.

### Chunk O: Export to XLSX and CSV

- **id:** `chunk-o-export`
- **Issue:** #2444
- **Skill:** workspace
- **Inputs:** spike 11 exceljs export (135/135 after LibreOffice recalculation) on `spike/sheets-interop`.
- **Done when:** #2444 AC hold; round-trip script against LibreOffice headless documented or in CI; CSV injection escaping tested.
- **Verify with:** `pnpm --dir packages/apps exec vitest run src/sheets-core/src/interop`.
- **Parallel with:** `chunk-n-import`, `chunk-i-grid-core`.

### Chunk V: Cross-chunk verify

- **id:** `chunk-v-verify`
- **Skill:** testing
- **Inputs:** every merged chunk; Epic #2430 Done when.
- **Done when:** read-only verifier subagent with the prompt from [developer/multitask-verifier.md](../../skills/developer/multitask-verifier.md) reports `PASS` or `PASS_WITH_NITS`; the parent ran [done-checklist](../../skills/developer/done-checklist.md) and [verify-issue](../../skills/verify-issue/SKILL.md) on #2430.
- **Verify with:** the verifier report and the done-checklist commands.
- **Parallel with:** none.

## Test plan

- [ ] API: per-shape caps and `.csv` / `.ycsv` collab saves → failing feature test → implement → `composer done-gate` (chunk B).
- [ ] Pure modules (`file`, `model`, `formula`, `engine`, `collab`): Vitest on exports, conformance corpus, spike 9 fuzz at a reduced run count.
- [ ] UI: mock-tier Storybook for the grid states → Vitest/RTL for hooks → Playwright for interaction, a11y (axe), touch (emulated iPhone, iPad, Android in Chromium + WebKit).
- [ ] Collab: two-browser e2e on the local API, including a real network partition (stop the TURN; DevTools offline does not cut WebRTC).
- [ ] Performance: `measure:sheets` at 10k × 10, 25k × 10 and 10k × 30.
- [ ] By a person: VoiceOver checklist (spike 8), real iPhone and Android checklist (spike 7), one real paste from Excel, Google Sheets and Numbers.

## Doc updates (only if user wants)

- `docs/architecture/ycsv-spec.md` (added with this plan, the source of truth for the format; chunk C adds the corpus).
- `packages/apps/docs/workspace-shells.md`: the Sheets shell (chunk M).
- `.agents/skills/workspace/collab-hooks.md`: the shape registry and its new home in `src/lib/collab` (chunk A).
