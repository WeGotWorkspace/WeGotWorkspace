Source: #2430 (body-hash: 4304aaa8)
Goal: WeGotWorkspace/Product#164

# Sheets: live-collaborative spreadsheets on YCSV

Technical translation of Epic #2430. The design comes from eleven spikes and an integration slice (2026-11-26 / 27) and the decisions Wouter took on 2026-11-27. The build takes the ideas, not the spike branches: those are prototype code.

## Goal

A Sheets app in the suite that edits YCSV and CSV files live with others on the shared collab engine. One workbook holds several sheets. Formulas are evaluated incrementally in a Web Worker, and the windowed DOM grid holds a typical edit within one frame at ~250k cells. The grid works with a keyboard, a screen reader and touch. Files import from XLSX, ODS, CSV and Numbers with an import report, and export to XLSX and CSV.

## Sources

| What | Where |
|------|-------|
| Combined report: short answers, recommended architecture, spec and product decisions | `prototypes/ycsv/docs/sheets-spikes-report.md` on `spike/sheets` |
| Module boundaries, Yjs layout, worker replica, open integration gaps | `prototypes/ycsv/docs/integration-slice.md` on `spike/sheets-integration` |
| Yjs growth, epoch compaction (separate project #2446) | `prototypes/ycsv/docs/spike-10-yjs-growth.md` on `spike/yjs-growth` |
| Interop, conformance corpus, amended spec (Appendix B) | `prototypes/ycsv/docs/spike-11-interop.md`, `prototypes/ycsv/upstream/ycsv-spec-v1.md` on `spike/sheets-interop` |
| Original YCSV v1 spec | `packages/apps/docs/ycsv-spec-v1.md` on `feat/spreadsheet-core` (#179) |
| Committed YCSV spec (v1 with the 2026-11-27 decisions; `ycsv_version` stays 1) | [`docs/architecture/ycsv-spec.md`](../../../docs/architecture/ycsv-spec.md), from `prototypes/ycsv/upstream/ycsv-spec-v1-clean.md` on `spike/sheets-interop`; task #2432 |

## Non-goals

- Incremental collab saves and epoch compaction: suite project #2446. Sheets v1 ships on today's whole-state save with per-shape caps (decision 11).
- Awareness over the HTTP mailbox fallback: bug #2447 (also on Docs today).
- Subdocuments for sheets beyond ~250k cells.
- Charts, pivot tables, conditional formatting, macros, per-row height, wrapped text, ODS / Numbers export.
- An "overwritten by" marker for concurrent same-cell edits (decision 9).

## Affected packages

- `packages/apps`: `src/lib/collab` (engine lift, shape registry), new `src/sheets-core/` (file, model, formula, engine, collab, grid), Sheets app shell, Drive routing, import dialog
- `packages/api`: collab file registry, per-shape save caps, `.csv` / `.ycsv` collab saves
- `docs/architecture/ycsv-spec.md`: the YCSV spec
- repo root: one collab file registry source shared by client and API

## Module boundaries (`packages/apps/src/sheets-core/src/`)

```
file/      YCSV v1.1 + CSV text ⇄ typed workbook value. Pure. Shared by the model and import/export.
model/     Yjs layout + pure ops. No React, no DOM.
  workbook.ts  root names, sheet parts, repair (read rule for every order)
  order.ts     resolveOrder, keeperIndex, moveIn, cleanup
  ops.ts       every gesture as one transaction, origin "local"; positions → ids inside
  view.ts      SheetView / Workbook: cached resolved order, invalidated on structure only
  refs.ts      id form ⇄ file form, sheet ids ⇄ sheet refs
  file.ts      YCSV text ⇄ doc, only through file/
formula/   tokenizer, parser, AST, eval, functions, locale notation. Pure; knows SheetScope, not Yjs.
engine/    WorkbookEngine (incremental), ValueSource, InThreadValues, WorkerValues, worker.ts
collab/    ycsv document shape (seed, read, recognise), presence payload, undo manager + guard
grid/      React. Reads a SheetView + ValueSource, calls ops. No Yjs imports except types.
  useSheetData, useGridWindow, useGridFocus, useCellEditor, useSelection, useTouch,
  useAnnouncer, useRemoteDigest, usePeers; GridRow, Overlay, ContextMenu, FormulaBar, WorkbookView
interop/   import (SheetJS CE) and export (exceljs), lazy-loaded, in a worker; import report
```

Rules (integration slice):

1. Ops take ids or positions and resolve positions to ids inside the transaction. A gesture never writes by index into Yjs.
2. One `UndoManager` per person per workbook, created by the workbook, not by a grid. Stack items carry the sheet tab and the selection.
3. The engine is behind `ValueSource`. The grid never knows whether values come from a worker.
4. Presence and selection are ids only (`sheetId`, `rowId`, `colId`). Positions are derived per render.
5. Test hooks are a typed `SheetHandle`, so specs never reach into Yjs roots.

## Yjs layout

```
sheets:     Y.Map<sheetId, Y.Map{
              ref, name?,
              rowOrder: Y.Array<rowId>,  rowData: Y.Map<rowId, Y.Map<colId, idFormText>>,
              colOrder: Y.Array<colId>,  colData: Y.Map<colId, Y.Map{ref, name, type, rest, width}>,
              meta:     Y.Map{frozen_rows, defs, cells, …} }>
sheetOrder: Y.Array<sheetId>
book:       Y.Map{ycsv_version, defs, …}
```

- Read rule on `sheetOrder`, `rowOrder`, `colOrder`: the first occurrence with data wins; `repair()` on save writes the rule back.
- Short column ids (`c` + base36, ≤ 4 chars), empty cells omitted, deterministic seed (hashed row ids, seed version).
- Formulas store sheet ids and column ids in id form; the file stores refs. Renaming a sheet or a column ref never touches a formula; deleting a sheet turns its refs into `#REF!`.

## Technical constraints

- **Format:** YCSV as committed in `docs/architecture/ycsv-spec.md` (`ycsv_version: 1`; a `.csv` holds no formulas, `=` is text there, §2.4). Row 1 = first data row, header = row 0 and unnumbered in the grid; grid number = formula number. Empty rows keep their number; no blank-line skipping. `header: true|false` explicit, detected for plain CSV. `---` splits sheets only outside quoted fields. A `.csv` stays CSV until a YCSV-only feature is used (then the editor asks). Writers emit block-style YAML.
- **Collab:** the shared engine moves to `src/lib/collab` with a document-shape registry before Sheets plugs in. One collab file registry replaces `DOCS_COLLAB_TEXT_EXTENSIONS` (client) and `CollabDocFormats` (API).
- **Size:** ~250k cells: gzip the Yjs sidecar and raise the text cap for the `ycsv` shape; Docs caps stay. Warn from ~150k cells.
- **Performance:** row + column windowing reusing `workspace-list-window.ts`; the window moves in steps; memoised rows; incremental engine in a worker on a replica `Y.Doc`; save serialisation off the main thread. A typical edit paints within one frame (16.7 ms) at 25k × 10.
- **Accessibility:** roving focus on the active gridcell; the editor input exists only while editing; one column list for every row; active row and column always rendered; `aria-rowindex` / `aria-colindex` everywhere; one polite live region; decisions 12–14.
- **Touch:** native panning; only a drag that starts on a handle changes the selection; formula bar docked above the keyboard on phones; grid-only pinch zoom. Selection gesture per decision 5 (pending).
- **Interop:** SheetJS CE 0.20.3 from the SheetJS CDN tarball (npm `xlsx` 0.18.5 has known CVEs); exceljs for XLSX export; parsers handle caller-supplied files (load the `security` skill).
- **File size:** no new source file over 800 lines; the spike grid (2,946 lines) is split into hooks before it lands.

## Decisions that shape behaviour

Product decisions 1–18 and the spec decisions are listed in #2430. Behaviour-shaping ones per module:

| Module | Decisions |
|--------|-----------|
| file | P2/P27, P22, P29, P30, P31, P32, P33, P34, P5, P6; 10 (duplicate headers) |
| model | 4 (frozen rows in the file), 6 (fixed row height, format room for per-row height), 10 |
| formula | P4, 2 (ref shifting), 16 (locale notation) |
| collab | 8, 9, 15 |
| grid | 1, 3, 7, 12, 13, 14; 5 (pending) |
| interop | lossy import accepted, silent loss not (B.7 import report) |

## Edge cases

- A peer inserts a row while I type a ref in the open editor: the ref keeps pointing at the intended row (id-form draft, `EditBase`).
- A peer sorts while I type a range: reversed ranges are normalised (`SUM(ka6:ka1)` → `SUM(ka1:ka6)`).
- Undo of a row insert that a peer typed in, or of a move a peer overrode: skipped with "Can't undo: <name> …".
- Two peers add a column with the same name at the same time: the second by column id gets the header ` 2` (decision 10); its ref form follows conflict K2 once Wouter confirms it (see plan Open decisions).
- Two peers edit the same cell: one value wins silently.
- A `.csv` with a `---` line inside a quoted cell: one sheet, the line is data.
- A `.csv` whose first row may or may not be a header: detection D1–D7, result recorded, user toggle.
- A `.numbers` file: values only, with a hint to export from Numbers as Excel.
- An imported formula whose result differs from the source app's cached value: listed in the import report and the cell flagged.
- A save above the per-shape cap: a clear message, never a silent drop.
- An outside write (WebDAV) while the sheet is open: the shared outside-write dialog.
- A deleted sheet: refs to it become `#REF!`. A circular reference: `#CIRC!` on the cells of the cycle only.
