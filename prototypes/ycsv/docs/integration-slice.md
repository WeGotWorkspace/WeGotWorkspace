# Sheets integration slice

Branch `spike/sheets-integration`, 2026-11-27. Prototype only; nothing here goes to main.

**Question.** The spikes answered their questions one at a time, each on its own branch. Do the pieces still work when they run together in one prototype? Where do their designs clash before the real build starts?

**Answer.** Yes. The combined stack holds: every spike suite that still applies passes, spike 9's fuzz runs green on the real workbook model, and two browsers edit one multi-sheet workbook over the real Docs collab session. Running the spikes together surfaced 20 conflicts. Most are small. Four would have been user-visible bugs:

- on phones, double-tap no longer edited (spikes 7 and 8);
- an open cell editor wrote into the wrong row after a peer's insert, because the grid is positional;
- the spike 4 engine marked whole DFS stacks as `#CYCLE`;
- after an undo that switched tabs, keyboard focus was lost, so the next Cmd+Z did nothing.

**Measurements.** See [Measurements vs spike 4](#measurements-vs-spike-4).

## What was combined

| From | What | Where now |
|---|---|---|
| Spike 9 (row move) | Order arrays + data maps for rows and columns; the read rule (first occurrence with data wins); `cleanup`/repair; `guardedUndo`; sort range rewrite | `src/sheets-core/model/order.ts`, `ops.ts`, `collab/undo.ts`, extended to **many sheets per doc** |
| Spike 4 (scale) | Incremental engine (point edges + range owners, column-major values, iterative DFS, native aggregates); worker host; `pnpm measure` harness | `src/sheets-core/engine/` (`WorkbookEngine`, `InThreadValues`, `WorkerValues`); `src/scale/integrated.ts` |
| Spike 6 (cell UX) | The DOM grid: selection, editing, fill, formula editing, clipboard, row/column ops; id-form drafts | `src/ycsv-ux/SheetGrid.tsx` |
| Spike 8 (a11y) | Roving focus on the active gridcell, column window shared by every row, active row/column always rendered, ARIA indices, announcer, remote digest | `SheetGrid.tsx` (merged) |
| Spike 7 (touch) | Variant B (range handles), stepped row window, memoised rows, docked formula bar on phones, pinch zoom | `SheetGrid.tsx` (merged) |
| Spike 5 (collab) | Deterministic seed, the `ycsv` document shape on the real Docs collab session, presence on stable ids, per-user undo | `src/sheets-core/collab/`; `packages/apps/src/sheets-spike/`; `packages/apps/e2e/sheets-spike-collab.spec.ts` |
| New | Multi-sheet root, sheet ids in formulas, cross-sheet refs and ranges in parser/eval/engine, `WorkbookView` (tabs + one grid), `useSheetData` | `src/sheets-core/model/workbook.ts`, `refs.ts`, `file.ts`, `view.ts`; `src/ycsv-formula/*`; `src/ycsv-ux/WorkbookView.tsx` |

### The Yjs layout

```
sheets:     Y.Map<sheetId, Y.Map{
              ref, name?,
              rowOrder: Y.Array<rowId>,  rowData: Y.Map<rowId, Y.Map<colId, idFormText>>,
              colOrder: Y.Array<colId>,  colData: Y.Map<colId, Y.Map{ref, name, type, rest, width}>,
              meta:     Y.Map{frozen_rows, defs, charts, cells, …} }>
sheetOrder: Y.Array<sheetId>
book:       Y.Map{ycsv_version, defs, …other top-level keys}
```

- The spike 9 read rule applies to all three orders: `sheetOrder`, `rowOrder` and `colOrder`. `repairWorkbook` writes the rule back for all of them.
- Empty cells are omitted (spike 4).
- Seeded column ids are `c` + base36 index (spike 4, short). New columns get `c` + 3 random characters. Seeded row ids are hashed (spike 5, deterministic seed version `"2"`).
- Formulas store sheet **ids**: `s_xxxxxxxx!ref@r_xxx`. The file stores sheet **refs**: `producten!totaal3`, or `'Quoted name'!col1`. Ranges use spec form `p!a1:p!a9`.
- Renaming a sheet therefore never touches a formula. Deleting a sheet turns its refs into `#REF!`.
- A single-sheet file round-trips to the single-sheet form. A multi-sheet file round-trips to `sheets:` plus one body per sheet, byte for byte.

### Engine: worker replica, not a worker-owned doc

The worker keeps a **replica** `Y.Doc`. The main thread sends it `init` (the full state) and then every update. The worker answers with deltas of formula values. Literals render straight from the main-thread doc, so they never wait for the worker.

Why a replica rather than moving the doc into the worker:

- The Docs collab session lives on the main thread, and it cannot move. It needs `RTCPeerConnection`, which workers don't have. Its IndexedDB persistence, awareness and save queue hang off the same session object.
- `Y.UndoManager` and awareness must sit next to that doc. Selection and undo meta are UI state.
- Owning the doc in the worker would add an async hop to every keystroke's write. Today a write is a synchronous Yjs transaction, and only formula values arrive later.

The cost is two copies of the doc: worker heap roughly equal to the main doc, plus the engine. `performance.memory` doesn't see the worker, so the heap column below undercounts worker mode.

Both hosts implement one `ValueSource` interface (`InThreadValues`, `WorkerValues`). `WorkbookView engine="main" | "worker"` picks one, and the measurements compare them.

## Conflicts and how they were resolved

Each item names the spikes involved. Items marked **bug** would have shipped broken without this slice.

1. **Grid merge, spikes 7 and 8 (11 textual conflicts, 6 silent ones).**
   - Spike 7 memoised rows (`GridRow`, compared by props). Spike 8 renders one shared column list for every row plus the active column.
   - Resolution: the memoised row takes the column window as `visCols` plus a `visKey` string and compares the key, not the array. Every row stays on the same column set, as spike 8 requires, and memoisation (spike 7) still holds.
   - Silent clashes, which only the type check found:
     - two `live` refs (touch's renamed `geom`);
     - two `moveSelected`;
     - `setAnnounce`, removed by spike 8 and still used by spike 7 (now `say`);
     - `activeDetails` used before its declaration;
     - the peer type missing `editing`;
     - fixed `ROWHEAD_W` (spike 8) vs zoomable `rowHeadW` (spike 7; zoom wins).
   - The CSS sections were unioned.
2. **Bug — phone double-tap did not edit (spikes 7 and 8).**
   - Spike 8 starts an edit from the formula bar only on a pointer focus, so tabbing through the toolbar doesn't open the editor. Spike 7's phone double-tap focuses the bar from code.
   - Result: the cell was selected, but no edit started.
   - Fix: the double-tap path marks its focus as a pointer focus (`barPointer`). Found by spike 6's own touch test.
3. **Duplicate header-menu items (spikes 7 and 8).** Both added "Move row up/down" and "Move column left/right". Touch keeps spike 7's items at the top of the menu (no shortcut text). Desktop keeps spike 8's, with the shortcuts.
4. **Presence payload (spikes 5 and 6).**
   - Spike 6 sent `{cursor, ranges:[{r1,r2,c1,c2}]}`. Spike 5 sent `sheet: {active, range, editing}`.
   - Unified as `sheet: {sheetId, active, ranges: [{anchor, head}], editing}`: spike 5's field name, spike 6's multiple ranges, plus the sheet id so peers on another tab are hidden. The tab strip shows their dots instead.
5. **Undo scope (spikes 5, 6 and 9).**
   - Spike 6 had one `UndoManager` per grid. Spike 5 had one per doc.
   - Now one per person per **workbook** (`captureTimeout: 0`, origin `local`).
   - Each stack item remembers its tab and selection (`meta.sheet`, `meta.sel`). Undoing a step that belongs to another tab switches to that tab, as Google Sheets does.
   - Spike 9's `guardedUndo` now treats every `Y.Array` parent as an order: rows, columns and sheets.
6. **Bug — an open editor after a peer's insert (spikes 5 and 6).**
   - Spike 5 added `EditBase`: refs typed in the editor resolve against the row order shown when typing began. Spike 6 converts the draft to id form, so the *refs* already followed the rows.
   - But the edit's own target was a row **index**, so Enter wrote into whatever row now sat at that position.
   - Fix: the open editor follows its cell by row and column id across remote inserts, deletes and moves. If the cell is deleted, the edit is dropped and announced. `EditBase` itself is gone.
   - Covered by two new Playwright tests and a step in the two-browser e2e.
   - The rest of the selection is still positional (see [Not integrated](#not-integrated-yet)).
7. **Sort range rewrite across sheets (spike 9 + multi-sheet).** Spike 9 rewrote ranges positionally inside the sorted sheet. With cross-sheet ranges, a sort also rewrites ranges on *other* sheets that point into the sorted one (`rewriteRangesForSort(value, ownSheet, sortedSheet, …)`). Covered by a unit test.
8. **Engine model (spikes 4 and 9).** Spike 4's engine read the old `rows: Y.Array<Y.Map>` layout. It was ported to order arrays and many sheets:
   - keys are `sheetId!ref@rowId`;
   - `observeDeep` on the `sheets` root, with each event classified by `event.path`;
   - range owners keyed `sheet!col`.
   - A column or sheet structure change triggers a full rebuild. Width, name and type changes are ignored.
9. **Rectangular ranges (spikes 6 and 4).** Spike 6 added `col2` (`SUM(a1:c3)`), which spike 4's engine didn't know. The engine now registers one range owner per covered column.
10. **Bug — `#CYCLE` over-marking (spike 4).**
    - Spike 4's iterative DFS (and `evaluateAll`) marked the whole DFS stack as `#CYCLE` when it met a back edge. Cells that only *depend on* a cycle became `#CYCLE` instead of propagating the error, and the result depended on evaluation order.
    - The integration fuzz found it: an incremental update and a fresh build disagreed.
    - `WorkbookEngine` now marks only the frames from the back-edge target up. The old `evaluateAll` in `ycsv-formula` still has the old behaviour.
11. **Cross-sheet refs without a row (spike 2 vs the new parser).** The tokenizer now accepts `sheet!ident`. Spec §11.1/A.8 says a cross-sheet ref always names a row, so `producten!totaal` is `#SYNTAX`, as spike 2 decided. A first version had made it `#REF`.
12. **`#REF!` vs the sheet prefix.** Spike 6 writes `#REF!` into formulas when a column is deleted. The new `sheet!` split read `#REF!` as "sheet `#REF`, empty ref", and three spike 6/8 tests failed. Now `#REF!` stays an error literal.
13. **Column width in the file (spike 6 vs the new file writer).** The new `sheetToFile` dropped the grid's column width. Spike 6's rule is back: the column map's `width` wins over the file's.
14. **Empty cells: omitted vs pre-filled (spikes 4 and 6).** Spike 6 wrote `""` for every cell on seed and insert. Spike 4 omits them. Omitted won: writing `""` deletes the key, and inserted rows and columns get no cells.
15. **Worker replica vs owned doc (spikes 4 and 5).** See [Engine](#engine-worker-replica-not-a-worker-owned-doc).
16. **Story test hooks (spikes 6 and 8).** The old specs edited `window.__sheetB.getArray("rows")` directly. The workbook layout has no such array, so the specs now call helpers on a `SheetHandle`: `setCell`, `insertRows`, `widths`, `frozen` and similar.
17. **React and Yjs copies (spike 5 + the grid).** `packages/apps` imports the prototype grid, and the prototype has its own `node_modules`. The sheets-spike Vite config now also dedupes `react` and `react-dom`, besides Yjs. Two Reacts break hooks.
18. **Bug — focus lost after an undo that switches tabs (spikes 5 and 8).** `WorkbookView` keys the grid by sheet, so a tab switch remounts it. Spike 8 only refocuses a grid that already had focus, so after Cmd+Z moved to another tab, focus fell to `<body>` and the next Cmd+Z went nowhere. The two-browser e2e found it. Now a switch caused by an undo or redo step mounts the new grid with focus.
19. **Serialize got slower with the multi-sheet file form (spike 4 vs the new `refs.ts`).** Converting every formula through the sheet-aware path made serialize 6× slower at 10k × 30. Two fixes: formulas without `!` take the single-sheet fast path, and each sheet's "must quote" check is cached. Now +15% (93 vs 81 ms), see below.
20. **Measuring the worker (spike 4 harness).** Spike 4's harness waited for two frames after an edit. With the integrated `WorkerValues`, values can arrive later than that, so the first worker runs read the 50 ms fallback, not the real time. The harness now awaits `values.settled()` and then one frame, and reports the worker's own time separately. The runs in `results/integration/` and `results/integration-30/` used the old timing for the worker rows; use `results/integration-worker*/` for those. `results/integration-main2*/` are the main-thread runs after fix 19.

## Verification

### Unit and fuzz (`pnpm exec vitest run`, `FUZZ_RUNS=500`)

All 189 tests pass (16 files); the 8 skipped are the opt-in benchmark. Spike 5's `collab-semantics` suite was removed: its cases now run on the workbook model in `integration-collab`. New:

- `tests/integration-model.test.ts` (7):
  - multi-sheet and single-sheet files round-trip byte for byte;
  - formulas store sheet ids, and a rename keeps them;
  - cross-sheet evaluation, incremental = fresh build;
  - a sort rewrites ranges in other sheets;
  - deleting a sheet gives `#REF!`;
  - a random-op fuzz where incremental = fresh engine and repair finds 0.
- `tests/integration-collab.test.ts` (22): spike 5's semantics re-run on the workbook model.
  - deterministic seed;
  - undo: per-user, per-workbook scope, and `guardedUndo`;
  - conflicts, including move + concurrent edit, and concurrent inserts on two sheets with a cross-sheet formula;
  - presence with sheet id;
  - canonical save at 1k / 10k / 50k rows.
- `tests/rowmove-workbook-layout.ts`: spike 9's `SheetLayout` interface over the real `sheets-core` ops, with a second sheet in the root. The fuzz and the 23 semantics cases now run on it.

Spike 9 fuzz, 500 runs × 3 peers (`+undo`: 250 runs). Lost edits, duplicates, resurrected or vanished rows, lost renames:

| layout | runs | diverged | lost edits | duplicates | resurrected | vanished |
|---|---|---|---|---|---|---|
| baseline (old layout) | 500 | 0 | 2,865 of 11,915 | 8,293 rows | 1,518 | 0 |
| order-array (spike 9) | 500 | 0 | 0 | 0 | 0 | 0 |
| **workbook (this slice)** | 500 | 0 | 0 of 11,916 | 0 | 0 | 0 |
| **workbook + repair + guard** | 500 | 0 | 0 of 11,855 | 0 | 0 | 0 |
| **workbook + undo** | 250 | 0 | — | 0 | — | — |

The workbook model's raw anomaly counts before repair are the same as spike 9's order array: 3,977 duplicates and 1,855 orphan entries. The ops are the same algorithm, now behind the multi-sheet root.

Save at size on the workbook model (`integration-collab`, Node, one run):

| rows (×6 cols) | seed | serialize | file | Yjs sidecar |
|---|---|---|---|---|
| 1,000 | 20 ms | 8 ms | 89 KiB | 281 KiB |
| 10,000 | 135 ms | 37 ms | 927 KiB | 2.8 MiB |
| 50,000 | 634 ms | 275 ms | 4.7 MiB | 14.0 MiB |

### Playwright (prototype, Storybook)

Run against Storybook on the final code. Every spike suite that still applies runs on the integrated grid (`WorkbookView` + `SheetGrid` on the workbook model).

| Run | Projects | Passed | Failed | Skipped |
|---|---|---|---|---|
| `pnpm test:e2e` (spikes 6, 7, 8, row/col, workbook) | chromium + touch (Pixel 7) | 76 | 0 | 12 |
| `FOCUS_MODEL=cell` (spike 8's other focus model) | chromium | 72 | 0 | 12 |
| `pnpm test:touch` (spike 7 variant B) | android-phone, android-tablet, iphone, ipad | 52 | 0 | 36 |
| axe + a11y specs | firefox, webkit | 26 | 0 | 8 |

Skipped tests are opt-in (screenshots with `SHOTS=1`, touch perf with `PERF=1`) or need Chromium's CDP (touch input, pinch, accessibility tree) on WebKit and Firefox. Touch perf ran separately with `PERF=1` (see measurements).

New: `e2e/9-workbook.spec.ts` (8 tests). It covers tabs, cross-sheet refs and ranges, undo that switches tab, `#REF!` after a sheet delete, and spike 5's `EditBase` cases on the two-user story: a peer inserts a row while I type a formula (Enter writes my row, refs follow), and a peer deletes the row I am editing (the edit is dropped).

### Two-browser collab e2e (real Docs collab session)

`packages/apps/e2e/sheets-spike-collab.spec.ts`: two Chromium contexts (Ann and Bob), the API from this worktree, a local coturn relay with `WGW_SPIKE_FORCE_RELAY=1`. One test, eight steps. It passes with `engine=main` (13.5 s) and `engine=worker` (13.7 s).

1. **Edits.** Both type; formulas re-evaluate on both sides.
2. **Presence.** Bob sees Ann's caret at its anchor, her range `2-2:3-3`, and her editing state after F2.
3. **Insert while editing.** Bob inserts a row above while Ann is typing `=aantal3*prijs3+1`. Ann's Enter lands in her own row (conflict 6). Bob then deletes an empty row; Ann's formula keeps pointing at the right row.
4. **Move + concurrent edit.** Ann moves Brood to the end while Bob writes its price by row id. Both end with one Brood row holding Bob's 3.5.
5. **Sheet tabs.** Ann adds a sheet, Bob sees it and Ann's dot on it. Bob's `=sheet2!a1*2` follows Ann's edits on sheet 2 (10, then 12).
6. **Per-user undo across tabs.** Ann undoes six steps: two on sheet 2, the new sheet, then on sheet 1 her row move, her formula and her first edit. The grid switches tab with focus. Bob's edits stay; his cross-sheet formula becomes `#REF!` once the sheet is gone.
7. **Server save.** The stored file has no `@r_` row ids and no `s_` sheet ids; the Yjs sidecar is written.
8. **Cold reopen.** A fresh context opens the file and shows the same cells.

## Measurements vs spike 4

`node scripts/measure.mjs` (spike 4's harness), Chromium headless, on AC power on a 24 GB Mac with other sessions running (load 3–7). One run per size, so read differences under ~10% as noise. `win-incr` is spike 4's best variant, re-run now on the same machine. `int-main` and `int-worker` are the integrated stack (`WorkbookView`'s model + `SheetGrid` + `WorkbookEngine`) with the engine in this thread or in the worker replica. Spike 4's own report (idle machine) had 197 / 1042 / 655 ms open → paint for the three sizes.

**Open → first paint and main-thread heap**

| size | win-incr | int-main | int-worker |
|---|---|---|---|
| 10k × 10 | 211 ms, 66 MB | 213 ms, 58 MB | 315 ms, 35 MB* |
| 50k × 10 | 1,275 ms, 289 MB | 1,138 ms, 252 MB | 1,603 ms, 134 MB* |
| 10k × 30 | 717 ms, 188 MB | 789 ms, 185 MB | 1,038 ms, 88 MB* |

\* Main thread only. The worker holds a replica doc plus the engine, so the total is higher than `int-main`.

**Edits** (typical / worst paint after an edit; for the worker, main-thread sync time and when values arrive)

| size | win-incr | int-main | int-worker |
|---|---|---|---|
| 10k × 10 | 16.6 / 16.6 ms | 16.7 / 33.4 ms | 16.7 ms; values in 13.8 ms |
| 50k × 10 | 77.8 / 92 ms | 83.9 / 94.6 ms | 112 / 144 ms paint; 0.1 ms sync |
| 10k × 30 | 16.7 / 22 ms (sync 12.0) | 17.8 / 36.8 ms (sync 16.8) | 20.8 / 33.6 ms (sync 0.0) |

**Other operations**

| | win-incr | int-main / int-worker |
|---|---|---|
| Insert row, 50k | 25.6 ms | 35.8 / 33.3 ms |
| Paste 1,000 cells, 50k | 63.7 ms (281 worst) | 16.4 / 16.7 ms |
| Serialize, 10k × 10 | 25.5 ms | 25.3 ms |
| Serialize, 50k × 10 | 139.1 ms | 139.4 ms |
| Serialize, 10k × 30 | 80.7 ms | 93.4 ms |
| Yjs size, 10k × 10 / 50k × 10 / 10k × 30 | 4.6 / 23.0 / 13.3 MB | 3.2 / 16.3 / 10.4 MB |
| File → doc, 10k × 10 / 50k × 10 | 360 ms / 17.5 s | 58–66 ms / 0.26–0.29 s |
| Scroll | 60 fps, 0 long tasks | 60 fps, 0 long tasks |

Touch (spike 7's `touch-perf`, Pixel 7 emulation, `results/integration-touch-perf.json`): 60 fps at 4× CPU throttle (spike 7: 57–59); at 6×, 53–56 fps fling and 48 fps pinch (spike 7: about 50).

**Regressions to flag**

- **Edit worst-case sync time:** +8% at 50k × 10 and +40% at 10k × 30 (16.8 vs 12.0 ms) on the main thread. The cost is the order-array view cache and the multi-sheet engine keys. Still within one frame at 10k × 30; the worker removes it (0.0 ms).
- **Insert and delete row at 50k:** +20–40% paint. The cost is in render: the stepped window remounts more rows after a structure change. The engine is not the cause.
- **Worker open → paint:** +40–50% over the main thread. The worker gets the full state and builds its own replica before the first values arrive. Literals paint first, so the grid is usable sooner than this number says, but formula cells show their last value late.
- **Serialize at 10k × 30:** +15% after fix 19 (it was 6× before).

**Improvements:** the order-array layout is 25–30% smaller in Yjs; file → doc is 6–65× faster (no per-row `Y.Map`); big pastes no longer have a slow tail; main-thread heap is 2–13% lower.

**Which engine host?** `int-main` matches spike 4 within noise for sizes up to 10k rows. The worker wins on main-thread sync time and heap at 50k, and loses on first paint and on time-to-values. Suggested default: in-thread below about 20k formula cells, worker above. Both hosts sit behind `ValueSource`, so this is a runtime choice.

Raw results: `results/integration-main2*` (main thread, after fix 19) and `results/integration-worker*` (worker, fixed timing).

## Not integrated yet

- **Interop (spike 11).** `parseBook` is a shim: a multi-sheet file is cut into single-sheet files and parsed with the old parser. The interop spike's parser, the spec proposals (P1 row numbering, P4 grammar, P5 leading `'`, P22 `---` inside quotes) and the nl-NL notation converter are not wired in. **P1 matters most:** the prototype counts the first data row as 1 (spec §7.1), while spreadsheet-core uses grid numbering. Every ref shown in the formula bar depends on that choice.
- **Selection is positional.** Spike 6's selection is index-based. A peer's insert above my selection shifts what I have selected, though no longer an open edit (conflict 6). Peers' carets are id-based and follow. The real build should store the selection as ids, like presence.
- **Column rename breaks formulas.** Formulas store `ref@rowId` (spike 6 id form), so renaming a column ref leaves formulas naming the old ref. Nothing in the grid renames a ref today. The fuzz renames, and `renameColumn` only sets the ref. Options: store `colId@rowId` in formulas, or rewrite on rename. Rewriting conflicts with concurrent formula edits, so storing `colId` is the better choice.
- **Fill and paste don't shift cross-sheet refs.** `=p!a1` filled down stays `=p!a1`, where Excel would shift it.
- **The sheet tab UI is minimal.** Add, switch, and peer dots only. No rename, reorder or delete from the UI (the ops exist and are tested), and no keyboard model for the tab strip.
- **Outside-write re-read, commenter/reader roles, offline home and Drive open-with** are unchanged from spike 5: not exercised.
- **The engine rebuilds** on any column or sheet structure change. Fine at the measured sizes, but a 50k-row column insert costs a full build.
- **The worker gets the whole state** at init, plus a copy of every update. A large sheet holds two docs in memory.
- **Sidecar size.** Unchanged: 2.8 MiB at 10k × 6, so the 5 MiB cap still binds around 15–18k rows of this shape. Gzip (spike 5) and Yjs v2 (spike 4) are not applied here.
- **`SheetGrid.tsx` is now 2,946 lines.** It has to be split before it is real code (see below).

## Suggested module boundaries for `sheets-core`

The slice already has most of these seams. The split below keeps Yjs out of the grid and React out of the model.

```
sheets-core/
  model/        Yjs layout + pure ops. No React, no DOM.
    workbook.ts   root names, sheet parts, repair (read rule for every order)
    order.ts      resolveOrder, keeperIndex, moveIn, cleanup (spike 9)
    ops.ts        every gesture as one transaction, origin "local"; positions → ids inside
    view.ts       SheetView / Workbook: cached resolved order, invalidated on structure only
    refs.ts       id form ⇄ file form, sheet ids ⇄ sheet refs
    file.ts       YCSV text ⇄ doc (calls the interop parser/serializer, not its own)
  formula/      tokenizer, parser, AST, eval, functions. Pure; knows SheetScope, not Yjs.
  engine/       WorkbookEngine (incremental), ValueSource, InThreadValues, WorkerValues, worker.ts
  collab/       document shape (seed, read, recognise), presence payload, undo manager + guard
  grid/         React. Reads a SheetView + ValueSource, calls ops. No Yjs imports except types.
    useSheetData       external-store subscription (book + values)
    useGridWindow      stepped row window + shared column window + always-rendered active row/col
    useGridFocus       roving focus, refocus after render, AT activation
    useCellEditor      edit state by cell id, id-form draft, autocomplete, pointing
    useSelection       ranges by id (not by index — see above)
    useTouch           variant B handles, long-press, double-tap, pinch zoom
    useAnnouncer, useRemoteDigest   spike 8
    usePeers           presence in/out (sheet id filter)
    GridRow, Overlay, ContextMenu, FormulaBar, WorkbookView (tabs)
```

Rules that the slice suggests:

1. **Ops take ids or positions, and resolve positions to ids inside the transaction.** A gesture never writes by index into Yjs.
2. **One `UndoManager` per person per workbook, created by the workbook, not by a grid.** Stack items carry the tab and the selection.
3. **The engine is behind `ValueSource`.** The grid never knows whether values come from a worker.
4. **Presence is ids only** (`sheetId`, `rowId`, `colId`). Positions are derived per render.
5. **Test hooks are a typed `SheetHandle`**, so specs never reach into Yjs roots. The layout changed under these specs twice in one week.

## How to run

```bash
cd prototypes/ycsv && pnpm install --ignore-workspace
pnpm exec vitest run                      # unit + fuzz (FUZZ_RUNS=500 for the numbers above)
SB_PORT=6037 pnpm exec playwright test --project=chromium --project=touch
FOCUS_MODEL=cell SB_PORT=6037 pnpm exec playwright test --project=chromium
SB_PORT=6037 pnpm test:touch              # phones and tablets, Chromium + WebKit
node scripts/measure.mjs --sizes 10000,50000 --cols 10 --variants win-incr,int-main,int-worker --no-layouts --no-worker
```

Stories: `Spike 6/Cell UX/Workbook` (worker), `Workbook Main Thread` and `Workbook Two Users`. Every older story now runs on the workbook model too.

Two-browser collab e2e (from `packages/apps`, API and app from this worktree, a TURN relay on :3479):

```bash
WGW_APPS_E2E_BASE_URL=http://127.0.0.1:5480 WGW_E2E_API_URL=http://127.0.0.1:9480 WGW_APPS_E2E_NO_SERVER=1 WGW_SPIKE_FORCE_RELAY=1 pnpm exec playwright test --config playwright.sheets-spike.config.mjs
```

Add `SPIKE_ENGINE=worker` for the worker engine. The app is `vite --config vite.sheets-spike.config.ts`; open `/sheets-spike.html?file=users/admin/x.ycsv&user=Ann`.
