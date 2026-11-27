# Sheets spikes — report (2026-11-26 / 27)

Four questions had to be answered before real Sheets implementation starts. Three spikes ran overnight, each on its own branch. On 2026-11-27 follow-up spikes covered the risks that could still change the design: touch, screen readers, moving rows during concurrent edits, Yjs state growth, and interop with Excel / Google Sheets / LibreOffice / Numbers. An integration slice then ran all pieces together. The YCSV spec decisions taken along the way are in "Spec decisions". Nothing is on main and no PR was opened.

| Question | Spike | Branch | Write-up |
|---|---|---|---|
| (a) Can we be and stay fast at reasonably large sheets? | 4 — scale | `spike/sheets-perf` | `prototypes/ycsv/docs/spike-4-scale.md` |
| (b) Yjs + live carets like Docs, with YCSV? | 5 — collab | `spike/sheets-collab` | `prototypes/ycsv/docs/spike-5-collab-and-reuse.md` |
| (c) How much can we reuse from Docs? | 5 — reuse | `spike/sheets-collab` | same |
| (d) Good cell UI/UX? | 6 — cell UX | `spike/sheets-ux` | `prototypes/ycsv/docs/spike-6-cell-ux.md` + screenshots in `docs/spike-6-ux/` |
| (e) Does the grid hold on phones and tablets? | 7 — touch | `spike/sheets-touch` | `prototypes/ycsv/docs/spike-7-touch.md` |
| (f) Can the windowed grid work with a screen reader? | 8 — a11y | `spike/sheets-a11y` | `prototypes/ycsv/docs/spike-8-a11y.md` |
| (g) Can rows and columns move without losing concurrent edits? | 9 — row move | `spike/sheets-rowmove` | `prototypes/ycsv/docs/spike-9-row-move.md` |
| (h) Will the Yjs state grow too large, and can we compact it safely (Sheets and Docs)? | 10 — growth | `spike/yjs-growth` | `prototypes/ycsv/docs/spike-10-yjs-growth.md` |
| (i) Does the YCSV spec hold up, and can we import/export Excel, Google Sheets, LibreOffice and Numbers? | 11 — interop | `spike/sheets-interop` | `prototypes/ycsv/docs/spike-11-interop.md`; spec copy in `prototypes/ycsv/upstream/ycsv-spec-v1.md` |
| (j) Do all pieces work together? | integration slice | `spike/sheets-integration` | `prototypes/ycsv/docs/integration-slice.md` |

Spikes 4–6 start from `spike/sheets` (origin/main + the October YCSV prototype). Spikes 7 and 8 start from `spike/sheets-ux`, spike 9 from `spike/sheets-collab`, spike 10 from `spike/sheets-rowmove`, and spike 11 and the integration slice from `spike/sheets`. The branches are not merged into each other: each changed the prototype in its own way (see "Merging the spikes").

## Short answers

- **(a) Yes, with two architecture choices from day one:** a windowed grid (rows and columns) and an incremental formula engine. With both, a normal edit paints within one frame (16.7 ms) at every measured size up to 100k rows × 30 columns, scrolling holds 60 fps, and insert/delete row stays under 100 ms to about 1M cells. Windowing alone is not enough: full recompute costs 0.2–1 s per edit at 10k–50k rows. **The first wall is the server, not the browser:** the 5 MiB Yjs cap stops a sheet at about 110k cells (≈ 11k rows × 10 cols, ≈ 3,900 rows × 30 cols) with today's model.
- **(b) Yes.** A YCSV Y.Doc runs on the real Docs collab session (mesh, HTTP sync, IndexedDB, save queue) behind one new seam: a registered *document shape*. A two-browser e2e against a real local API + app passed four times in a row. It covered cell edits, live presence (active cell, range, "editing"), a row insert landing while a formula is typed, per-user undo, canonical YCSV saved on the server, offline merge after a real network partition, and a cold reopen from the server.
- **(c) Almost the whole collab engine.** Transport, join/leave, tickets, HTTP fallback, save queue, offline persistence, tab sync, presence avatars and the outside-write dialog have no editor code in them. What ties them to Docs is about eight `textFields ? … : markdown` branches. Tasks already proved a second shape, so Sheets would be the third. Docs-only: the TipTap surface, ProseMirror comment anchoring, print, DOCX import.
- **(d) Yes.** A DOM grid on the YCSV Yjs model (no canvas library) covers selection, keyboard, fill handle, formula colours + autocomplete + signature help, clipboard with Excel/Sheets/Numbers formats, and row/column operations. It has 51 interaction tests and 49 unit tests, all green in Chromium. Five of seven areas are good. Touch is rough but usable, and clipboard is verified only in Chromium.

## Follow-up spikes (2026-11-27)

- **(e) Touch: yes, the spike 6 design carries it.** One focused input, one geometry overlay and windowed rows in a native scroll container all hold under a finger; no canvas, custom scroller or JS momentum. The rule is simple: a finger on a cell or header always pans, and only a drag that starts on a handle changes the selection. Two changes inside the grid, not in the architecture:
  - At phone-like CPU speed (4× throttle) momentum scrolling at 10k rows dropped to 29–30 fps. A row window that moves in steps plus memoised rows brings it to 57–59 fps (about 50 fps at 6×).
  - On phones the formula bar becomes the editor, docked above the on-screen keyboard. Tablets edit in the cell.

  Pinch zooms the grid (0.6×–1.8×, per person and device), not the page. 56 touch tests pass in emulated iPhone, iPad and Android (Chromium + WebKit). **Recommendation for decision 5: variant B**, range handles on top of tap / double-tap / long-press, because without them you cannot select a block of cells by finger.
- **(f) Screen reader: yes, with one change to spike 6's focus model.** The active gridcell takes DOM focus (roving focus, as a plain-text editing host), instead of one input pointing at it with `aria-activedescendant`. Windowing then needs four rules: one column list for every row, the active row and column always rendered, `aria-rowindex`/`aria-colindex` everywhere, and focus re-asserted after every render. Cells are read as shown (`€ 3,27`), errors as words. Collaborators' edits go to a throttled polite live region; peer carets are not announced. axe-core finds 0 violations in 7 states, also in Firefox and WebKit. **No screen reader was actually heard**; a VoiceOver script and a checklist for a person are in the write-up.
- **(g) Row and column move: yes, with a different Yjs layout.** Keep the order apart from the data: `rowOrder: Y.Array<rowId>` plus `rowData: Y.Map<rowId, …>`, and the same for columns. A move or sort only rewrites the order, so cells are never copied or deleted. In 1,000 randomized 4-peer fuzz runs it lost 0 edits and showed 0 duplicates; today's layout lost 24% of edits. A sort at 50k rows costs 0.2–0.3 s instead of 21–23 s, the sidecar is the same size, and the YCSV text format does not change. Migration is free now, because no sidecars exist yet. Sort rewrites ranges by position in the same transaction; an undo of a move that a peer has since overridden is dropped (`guardedUndo`). Built as standalone modules with tests, not yet wired into the grid or the collab e2e.

- **(h) Yjs growth: manageable, but the save model must change first.** State grows linearly with edits and never shrinks on its own. A Docs document edited 60 times a workday reaches ~2 MiB (v1, ~8× its text) after a year of workdays and the 5 MiB cap after about two and a half years; a document four times as busy hits it within the first year. For Sheets the live state dominates (history adds 1.5–1.8×): a sheet of ~10k rows passes 5 MiB on its own, so no compaction keeps big sheets under today's cap. **The bigger problem is that every save sends the whole state** (~2.2 MiB per save for a year-old doc, every 2–3 s while typing) for a change of ~160 bytes. Yjs cannot compact itself safely for offline peers (tombstones are what late updates attach to). **Epoch compaction works:** rebuild the doc from its content under a new epoch id, keep the old epoch's final state on the server, and let old-epoch peers rebase their unsynced edits by Yjs identity. 1,000 seeded 4-peer runs per shape (~4,200 compactions, ~4,850 rebases with real offline edits): 0 lost or duplicated edits, for Sheets and Docs. Rebuilding shrinks a year-old Docs sidecar 2.7× (v1) to 10× (v2 + gzip). A content-diff rebase for Docs lost or duplicated text in 909 of 1,000 runs, so it must replay by identity.
- **(i) Interop: yes for import and export; the spec and parsers need work.**
  - **Conformance:** the spec decides 40 of 70 corpus cases. The prototype parser passes 19, `spreadsheet-core` 12 (25 with its row-numbering bug fixed). The parsers agree on only 16 of 70. Both lose trailing empty rows and cells containing a `---` line.
  - **Import:** SheetJS CE (0.20.3 from the SheetJS CDN; npm `xlsx` is stuck at 0.18.5 with CVEs) for XLSX, ODS and CSV, plus ~100 lines of raw-XML reading for frozen panes, validation and bold. 37 of 37 formulas from a realistic workbook round-trip A1 → YCSV → A1 as identical text.
  - **Export:** exceljs is the only XLSX writer that kept everything: 135 of 135 checked cells identical after LibreOffice recalculated, and styles, validation, freeze, merges, notes, names and hidden sheets survived. Export XLSX + CSV in v1; leave ODS export out (SheetJS's ODS writer corrupts cross-sheet refs).
  - **Formulas:** a v1 set of ~100 functions. 80 of 112 test formulas match LibreOffice today; most misses are in our engine (2-D ranges, errors, precedence, `%`), and formulajs lacks XLOOKUP/XMATCH.
  - **Apple Numbers:** `.numbers` is read by SheetJS CE as values only (formulas frozen at their last result; the importer says so and suggests exporting from Numbers as Excel). Numbers' own XLSX export needs fixes for 1904 dates, times and float noise (done). Our XLSX opens in Numbers with 131 of 135 cells matching.
  - **Lossy import is accepted (Wouter); silent loss is not.** Every loss goes into an import report, including every formula whose result differs from the source app's.
  - **Notation:** spike 11 recommends the canonical form in the file and the locale form in the editor (`=ROUND(3,27;1)` in nl-NL), as Excel, LibreOffice and Numbers do. Open decision, see below.
- **(j) Integration: the pieces hold together.** Every spike suite that still applies passes on the combined code, spike 9's fuzz runs on the real workbook model, and two browsers edit one multi-sheet workbook over the real Docs collab session. Performance matches spike 4 within noise (10k × 10 opens in ~210 ms; a normal edit paints in one frame). Combining surfaced 20 conflicts. Four would have been user-visible bugs, all fixed: double-tap no longer edited on phones (spikes 7 + 8); an open cell editor wrote into the wrong row after a peer's insert; the engine marked whole DFS stacks as `#CYCLE`; and focus was lost after an undo that switched tabs. Multi-sheet works: formulas store sheet **ids**, so renaming a sheet never touches a formula. Still not integrated: spike 11's parser and spec proposals, id-based selection, column-ref rename (store `colId` in formulas), sidecar compression, and a split of `SheetGrid.tsx` (now 2,946 lines). The write-up proposes module boundaries for `sheets-core`.

## Spec decisions (Wouter, 2026-11-27)

Recorded in the spec copy on `spike/sheets-interop` (`prototypes/ycsv/upstream/ycsv-spec-v1.md`, Appendix B). The original spec lives on `feat/spreadsheet-core` and is untouched; main is untouched.

- **Multiple sheets per file** were already in the spec: frontmatter on top, then one `---`-separated CSV body per sheet.
- **Row numbering (P1 rejected):** the first data row is row 1, the header row is row 0 (§7.1 stands). `spreadsheet-core`'s header-as-row-1 counting is a bug against the spec. Import/export shift A1 rows by the header offset. The row number shown in the grid must equal the number used in formulas, so the header row is unnumbered in the grid.
- **Explicit header flag (P2/P27 accepted):** `header: true|false` in the frontmatter. The parser guesses when reading a plain CSV (rules D1–D7), records the result, and the user can toggle "first row is header".
- **Header stays in the CSV body (P31 accepted):** a plain CSV with a header row is a complete sheet; `columns` in the frontmatter is an optional enrichment. Matching rule between header and `columns` (C1–C5) is a proposal.
- **A `.csv` stays CSV (P32 accepted)** while only values change. When a YCSV-only feature is used (formula, formatting, second sheet), the editor asks to make it a `.ycsv`. Build consequence: `.csv` needs collab (a sidecar) and must be on the collab-editable list.
- **Empty rows keep their number (P30 accepted):** an empty line, a whitespace-only line or `,,` is an empty row. The final newline and trailing empty rows are not rows. Parsers must not skip blank lines. Row number = body line number minus the header offset.
- **Proposals still open:** P33 (column refs derived from the header text alone, for files without frontmatter), P34 (frontmatter optional in `.ycsv`), P29 (frontmatter addresses use the same row numbers as formulas), P4 (Excel formula grammar), P5 (leading `'` = literal text), P6 (percent stored as a fraction), P22 (split sheets only on a `---` outside quoted fields), and the rest of the 34 in Appendix B.

## Idle-machine rerun of the scale numbers

The orchestrating session reran `pnpm measure` (spike 4 harness) at 09:15–09:56 on 2026-11-27, with the three spike sessions idle. Load average was 2.6–3.4 at the start and 2.2–2.7 at the end, against 5–22 during the night. The Mac was **on battery power**. Results: `results/scale-2026-11-27T08-15-56.{json,md}` on `spike/sheets-perf`.

The conclusions hold, and most numbers are 10–30% better than the contended night run. `win-incr` = windowed grid + incremental engine (proposed). `win-full` = windowed grid + full recompute. Times in ms, median / p95. 16.7 ms is one frame, the floor.

| rows × cols | open→paint | heap | edit typical | edit worst (every row dirty) | insert row | paste 1,000 | full recompute per edit (`win-full`) |
|---|---|---|---|---|---|---|---|
| 10k × 10 | 197 | 65 MB | 16.6 / 17.4 | 16.6 / 33.3 | 16.6 | 16.6 / 23 | 116 |
| 50k × 10 | 1,042 | 288 MB | 16.6 / 17.6 | 76 / 102 | 36 | 64 / 220 | 807 |
| 100k × 10 | 2,495 | 551 MB | 16.6 / 17.6 | 183 / 269 | 54 | 172 / 1,168 | 1,912 |
| 10k × 30 | 655 | 188 MB | 16.6 / 18.5 | 16.6 / 54 | 16.7 | 17.6 / 22 | 465 |
| 25k × 30 | 1,824 | 462 MB | 16.7 / 18.4 | 50 / 84 | 16.7 | 30 / 69 | 1,405 |
| 50k × 30 | 4,052 | 914 MB | 16.6 / 18.2 | 116 / 158 | 50 | 69 / 156 | 3,321 |
| 100k × 30 | 9,240 | 1.8 GB | 16.6 / 18.3 | 263 / 311 | 96 | 144 / 652 | — |

Scrolling held 60 fps with zero long tasks in every windowed configuration. The worker moves the worst-case edit at 50k × 30 to 10.7 ms of main-thread time (142 ms until the values arrive).

The Yjs v1 state is unchanged: 4.6 MB at 10k × 10 and 13.3 MB at 10k × 30, so the 5 MiB server cap still binds first (≈ 110k cells). In the browser, load time (1 s) and heap (300 MB) break first, near 500k cells (≈ 50k × 10, ≈ 15k × 30).

Not measured: an idle machine on mains power, a slower laptop, a phone.

## Recommended architecture (combined)

1. **Model.** Keep one `Y.Map` per row with cells keyed by column id, but hold the order apart: `rowOrder: Y.Array<rowId>` + `rowData: Y.Map<rowId, …>`, and the same for columns (spike 9). Read rule: the first occurrence with data wins; a lazy `repair()` on save removes leftovers. Before the format is fixed:
   - short column ids (≤ 4 chars)
   - empty cells omitted
   - same-row refs stored bare (`=aantal*prijs`; spike 6 already uses this, and it also lets one formula be shared per column)
   - index-based mutations
   - a deterministic seed (built in spike 5)
2. **Sidecar size and save model.** Compress the Yjs sidecar. Spike 5 uses gzip on the client, which brings 10k × 8 to ~0.45 MiB. Spike 4 compacts to Yjs v2 plus the model changes above, about 3.4× smaller. More important (spike 10, also for Docs): **save incrementally.** Append Yjs v2 updates to a log that the server stores opaquely. The client that opens a document alone folds the log into a new base, or compacts into a new epoch past a threshold. Old-epoch peers rebase by Yjs identity. The hard 5 MiB / 2 MiB caps then become a small per-request cap plus a soft per-document cap that triggers compaction. Very large sheets still need subdocuments, which no spike tested.
3. **Engine.** Incremental from v1, in a Web Worker:
   - a dependency graph with point edges plus per-column range owners
   - iterative evaluation, column-major values, and native aggregate loops
   - the worker turns the worst-case edit at 50k × 30 from 164 ms to 10.5 ms on the main thread

   Also move the save's `serialize(docToFile())` off the main thread.
4. **Grid.** Spike 6's DOM grid with one geometry-based overlay layer, plus row+column windowing (reuse `workspace-list-window.ts`; no library). Spike 6 windows rows only today. On top of that:
   - **Focus:** roving focus on the active gridcell; the editor input exists only while editing (spike 8).
   - **Windowing rules for screen readers:** one column list for every row, active row and column always rendered (spike 8). Spike 4's per-row column windows must follow that rule.
   - **Render cost:** the window moves in steps and rows are memoised (spike 7).
   - **Touch:** native panning, handles as the only selection drag, formula bar docked above the keyboard on phones, grid-only pinch zoom (spike 7).
   - **Split the component** into hooks (`useGridFocus`, `useAnnouncer`, `useRemoteDigest`, `useWindow`); the spike grid grew to 2,230 lines.
5. **Collab.** Move the shape-agnostic engine from `text-editor-core/docs-collab` to `src/lib/collab`. Make text-fields and the TipTap codec registered shapes, and add `ycsv`. Replace the two hand-kept extension allowlists (client + PHP) with one collab file registry. Sheets publishes `sheet: { active, range, editing }` in awareness, on row/column ids, rendered as a coloured cell border, a name label and a range tint.
6. **Undo.** `Y.UndoManager` scoped to the local origin, with one step per gesture and the selection restored (built in spikes 5 and 6). An undo of a move that a peer has moved or deleted since is dropped (spike 9).
7. **Accessibility layer.** Pure speech functions, one polite live-region announcer, and a remote digest fed by Yjs and awareness (spike 8). Docs and Tasks could reuse the digest.
8. **Multi-sheet root.** `sheets: Y.Map<sheetId, …>` + `sheetOrder: Y.Array<sheetId>` + `book: Y.Map`, the spike 9 read rule on every order, formulas storing sheet ids (integration slice).
9. **Interop.** SheetJS CE for import (XLSX, ODS, CSV, values-only `.numbers`), exceljs for XLSX export, CSV export; an import report for every loss (spike 11). One parser/serializer shared by import and the model (`file.ts` calls it).
10. **Module boundaries.** `sheets-core/` with `model/` (Yjs, no React), `formula/` (pure), `engine/` (behind `ValueSource`, worker or not), `collab/` (shape, presence, undo), and `grid/` (React hooks, no Yjs). Ops resolve positions to ids inside the transaction; presence and selection are ids only (integration slice).

## Merging the spikes

All three branches touched `prototypes/ycsv/src/ycsv-model` and `ycsv-formula`:

- spike 4: batched `fileToDoc`, index-based mutations
- spike 5: batched push, `toArray()`, deterministic ids, `EditBase` for refs typed while rows move, insert/delete column
- spike 6: `$` absolute refs, rectangular ranges, column width in the doc
- spikes 7 and 8: both changed spike 6's `SheetGrid.tsx` (touch handling and stepped window; focus model and a11y layer)
- spike 9: standalone layouts in `src/ycsv-layout/`, not yet used by `ycsv-model`
- spike 10: standalone growth simulations and epoch compaction in `src/yjs-growth/`
- spike 11: interop code in `interop/` and the spec + `spreadsheet-core` snapshot in `upstream/`; no changes to the model or grid
- integration slice: ports spikes 4–9 into `src/sheets-core/` and the combined `SheetGrid.tsx`; it is the best starting point for the real build, minus spikes 10 and 11

Spikes 4 and 5 both fixed the same quadratic `fileToDoc`. This is prototype code, so the real build should take the ideas into `sheets-core` rather than merge these branches.

## Bugs and findings worth keeping

- `fileToDoc` pushed rows one by one: quadratic in Yjs (50k rows: 214 s → 3–5 s).
- `evaluateAll` recursion overflows the stack from ~5,000 rows in a bottom-up chain. The AST cache thrashes from ~3,400 rows with absolute refs.
- A ref typed in an open cell editor was resolved against the row order at commit time, so a peer's insert made it point at the wrong row. Fixed by `EditBase`.
- Yjs's 500 ms undo capture merged separate edits. Fixed with one step per commit.
- DevTools "offline" does not cut an open WebRTC channel. Real partition tests need the TURN to be stopped.
- **Also affects Docs today:** when WebRTC fails and no TURN is configured, the HTTP mailbox fallback carries Yjs updates but **not awareness**, so users sync text but see no live carets. Worth its own issue.
- Moving rows/columns is delete + insert in Yjs (no array move), so a concurrent edit in a moved row can be lost, and a sort loses every concurrent edit. **Solved by spike 9's order layout.**
- Lifting the finger after a long-press landed as a click on the menu item under it (Chromium ran "Cut" by itself). Fixed in spike 7.
- Spike 6's editor had invalid ARIA (axe critical), four light-mode contrast failures and peer labels at 3.4:1. Fixed in spike 8.
- A range typed while a peer sorts is not rewritten and can come out reversed (`SUM(ka6:ka1)`). The engine should normalise reversed ranges.
- **Also affects Docs today:** every collab save sends the whole text + whole Yjs state in one request (spike 10). The 5 MiB / 2 MiB caps date from the first version of the endpoint (May 2026) without a stated reason; they protect PHP memory and shared-hosting limits, not storage.
- `spreadsheet-core` counts the header as row 1, against spec §7.1 (spike 11). Both parsers drop trailing empty rows and split on a `---` line inside a quoted cell.
- npm `xlsx` is stuck at 0.18.5 with known CVEs; SheetJS CE must come from the SheetJS CDN tarball (spike 11).
- Renaming a column ref leaves formulas naming the old ref, because formulas store `ref@rowId`. Store `colId` in formulas instead (integration slice).

## Product decisions (Wouter, 2026-11-27)

Taken one by one on 2026-11-27. The original questions follow below the table.

| # | Question | Decision |
|---|---|---|
| 1 | Enter on a selected cell | Edits (suite keymap). No Excel setting. |
| 2 | Fill / paste right | Column names shift like A1 (`=jan*1.21` → `=feb*1.21`); `$` locks. |
| 3 | Cut + paste | References from other cells follow the moved cells. |
| 4 | Frozen rows | Shared, stored in the file. |
| 5 | Touch v1 | **B**: range handles on top of tap / double-tap / long-press, matching Calendar's touch resize handles; rows and columns move through the header menu. Variant C (hold-to-drag, `spike/sheets-touch`) was tried: Calendar's 160 ms hold turns a scroll after a short rest into a selection; 250 ms is safe for normal scrolling. Hold-drag on headers only (250 ms, like moving a Calendar event) stays an optional later addition after a real-phone test. |
| 6 | Row height | Fixed in v1; keep room in the format for an optional per-row height later; no wrap. |
| 7 | Multi-range copy | Refused with a clear message (like Google Sheets). |
| 8 | Undo of a row insert others typed in | Blocked: the step is skipped with a message ("Can't undo: Anna typed in this row"). Undo never silently removes someone else's work. |
| 9 | Same cell edited concurrently | One value wins silently (no toast, no marker) in v1. |
| 10 | Concurrent columns with the same name | The second (by column id) gets a number: `omzet 2` / ref `omzet_2`. Same rule on import with duplicate headers. |
| 11 | Supported size | ~250k cells in v1: gzip the sidecar and raise the text cap for sheets; warn from ~150k. Incremental saves + epoch compaction are a separate suite project (Docs + Sheets); Sheets v1 does not wait for it. |
| 12 | Announce collaborators' edits to screen readers | On by default: my cell and joins/leaves at once, the rest as a 10 s digest, carets on request only, a setting to turn it off. Candidate for suite-wide. |
| 13 | Keys ⌥⇧P, Ctrl+G, F6 | Accepted, suite-wide (suite keymap). |
| 14 | Screen-reader row numbers | Accept the off-by-one from the header row; row header and cell name read the right number; add `aria-rowindextext` where supported. |
| 15 | Undo of a move a peer overrode | Skipped, with the same message as decision 8. |
| 16 | Formula notation | Input and display follow the browser locale (`=ROUND(3,27;1)` in nl-NL); the file stays canonical; function names stay English. |
| 17 | Spec proposals | P33, P34, P4, P5, P6, P22 accepted; P29 accepted as "frontmatter addresses use exactly the formula refs (names + rows, header = row 0), no letters, no `header:` key"; the rest of Appendix B accepted in bulk unless it conflicts with a decision. Writers emit block-style YAML; a quoted ref used as a YAML key is double-quoted. A clean spec goes to main later. |
| 18 | Compaction trigger | Only on open or close, by the browser that is alone in the document, past a size threshold. Nobody loses undo history mid-work. |

Spec decisions taken earlier the same day are in "Spec decisions" above.

### Original questions

1. **Enter = edit** (suite rule, Google Sheets) vs Enter = move down (Excel habit). Spike 6 chose edit, with F2 also editing. Do we want a setting for Excel muscle memory?
2. **Column names shift on fill right / paste right** like A1 (`=aantal*2` → `=prijs*2`), or stay put like Excel table refs?
3. **Cut + paste:** rewrite references from other cells to the moved cells (Excel does)?
4. **Freeze rows:** shared in the file (now) or per person?
5. **Touch v1:** tap / double-tap / long-press / finger fill handle, or also range handles? Spike 7 recommends range handles (variant B), with Fill in the callout and Move up/down/left/right in header menus instead of header dragging.
6. **Row height:** fixed (now), or per-row / wrapped text in v1? Both cost windowing simplicity.
7. **Multi-range copy:** refused now; support aligned ranges like Excel?
8. **Undoing a row insert that others typed in** removes their edits too. Block it, or accept it?
9. **Same cell edited concurrently** loses one value silently (LWW). Show an "overwritten by X" toast?
10. **Two people add a column with the same name** at the same time: which deterministic de-dupe rule?
11. **Supported size:** state it in cells, not rows. Spike 10 recommends incremental saves plus epoch compaction (for Docs too) instead of raising the hard caps; subdocuments only for very big sheets.
12. **Announce collaborators' edits to screen readers by default?** Spike 8 proposes: always for "my" cell and joins/leaves, a 10 s digest for the rest, with a setting to turn it off.
13. **Suite keys** ⌥⇧P ("where is everyone"), Ctrl+G (Go to) and F6 (leave the sheet): fine, or do Docs/Tasks already have keys to reuse?
14. **Screen-reader row numbers** count the header row ("row 3" for sheet row 2) until `aria-rowindextext` is safe. Accept (proposed)?
15. **Undo of a move a peer overrode:** drop it silently (proposed) or say "can't undo: Ann moved this row"?
16. **Formula notation in the editor:** the file stays canonical (`.` decimal, `,` separator) and display follows the browser locale via `Intl` (Wouter). Spike 11 recommends that formula *input and display* also follow the locale (`=ROUND(3,27;1)` in nl-NL), as Excel, LibreOffice and Numbers do. Accept, or keep canonical input everywhere?
17. **The remaining spec proposals** (P33, P34, P29, P4, P5, P6, P22 and the rest of Appendix B): accept, then bring one clean spec (without spike notes) to its real home, e.g. a docs PR to main, as the basis for the build.
18. **Compaction trigger and undo:** epoch compaction clears per-user undo history; who triggers it (the client alone in a document, past a size threshold) and whether users should notice (spike 10).

## Not verified

- Real Safari keyboard and clipboard (the screen was locked overnight), real Firefox clipboard, and live pastes from Excel / Google Sheets / Numbers. The fixtures were reconstructed from documented formats; one real paste from each app is needed. Spike 6's Safari script also left test text on the macOS pasteboard.
- No screen-reader pass by a person. Spike 8 checked what the browser hands a screen reader (accessibility tree, live region text, axe), but VoiceOver could not be driven (screen locked, AppleScript control off). A script and checklist are in its write-up.
- Touch only in emulation: no real iPhone or Android, and the iOS Simulator was not used. iOS clipboard (Safari's Paste bubble) not verified. Spike 7 has a checklist for a real phone.
- Spike 9's layout is not wired into the grid, the collab shape or a two-browser run; its fuzz uses small sheets without formulas. Migration with old and new clients in one room was not built.
- No mobile device, no slower laptop, no three-or-more-user session, no real slow network.
- Outside write (WebDAV edit while the sheet is open), commenter/reader roles, and cell comments: not run end to end.
- Offline pinning, Drive open-with, file preview, share menu, print, CSV/XLSX import/export for Sheets: inventoried, not built.
- Subdocuments for sheets beyond the caps.
- Spike 10's growth figures come from seeded simulations, not real usage logs; incremental saves and epoch compaction are not wired into the real collab session or the API.
- Spike 11 ran in Node with LibreOffice headless as the reference; opening our own export in Numbers was not tested; neither parser was changed to follow the accepted decisions yet.
- The integration slice ran on a busy Mac (load 3–7, one run per size); spike 11's parser and spec decisions are not wired in.
- Spike 5's commits were made with `--no-verify` (the apps gates run the whole suite; its spike page trips import-boundary warnings on purpose). Spikes 9 and 10 inherit that and also pushed with `--no-verify` (with Wouter's OK). The other spikes pushed normally.
