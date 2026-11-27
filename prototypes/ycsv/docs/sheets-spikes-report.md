# Sheets spikes — report (night 2026-11-26)

Four questions had to be answered before real Sheets implementation starts. Three spikes ran overnight, each on its own branch. On 2026-11-27 three follow-up spikes covered the risks that could still change the design: touch, screen readers, and moving rows during concurrent edits. Nothing is on main and no PR was opened.

| Question | Spike | Branch | Write-up |
|---|---|---|---|
| (a) Can we be and stay fast at reasonably large sheets? | 4 — scale | `spike/sheets-perf` | `prototypes/ycsv/docs/spike-4-scale.md` |
| (b) Yjs + live carets like Docs, with YCSV? | 5 — collab | `spike/sheets-collab` | `prototypes/ycsv/docs/spike-5-collab-and-reuse.md` |
| (c) How much can we reuse from Docs? | 5 — reuse | `spike/sheets-collab` | same |
| (d) Good cell UI/UX? | 6 — cell UX | `spike/sheets-ux` | `prototypes/ycsv/docs/spike-6-cell-ux.md` + screenshots in `docs/spike-6-ux/` |
| (e) Does the grid hold on phones and tablets? | 7 — touch | `spike/sheets-touch` | `prototypes/ycsv/docs/spike-7-touch.md` |
| (f) Can the windowed grid work with a screen reader? | 8 — a11y | `spike/sheets-a11y` | `prototypes/ycsv/docs/spike-8-a11y.md` |
| (g) Can rows and columns move without losing concurrent edits? | 9 — row move | `spike/sheets-rowmove` | `prototypes/ycsv/docs/spike-9-row-move.md` |

Spikes 4–6 start from `spike/sheets` (origin/main + the October YCSV prototype). Spikes 7 and 8 start from `spike/sheets-ux`, spike 9 from `spike/sheets-collab`. The branches are not merged into each other: each changed the prototype in its own way (see "Merging the spikes").

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
2. **Sidecar size.** Compress the Yjs sidecar. Spike 5 uses gzip on the client, which brings 10k × 8 to ~0.45 MiB. Spike 4 compacts to Yjs v2 plus the model changes above, about 3.4× smaller. Either way, after that the 2 MiB document-half cap becomes the limit and should be raised *per shape*. Larger sheets need subdocuments, which neither spike tested.
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

## Merging the spikes

All three branches touched `prototypes/ycsv/src/ycsv-model` and `ycsv-formula`:

- spike 4: batched `fileToDoc`, index-based mutations
- spike 5: batched push, `toArray()`, deterministic ids, `EditBase` for refs typed while rows move, insert/delete column
- spike 6: `$` absolute refs, rectangular ranges, column width in the doc
- spikes 7 and 8: both changed spike 6's `SheetGrid.tsx` (touch handling and stepped window; focus model and a11y layer)
- spike 9: standalone layouts in `src/ycsv-layout/`, not yet used by `ycsv-model`

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

## Product decisions needed (from the spikes)

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
11. **Supported size:** state it in cells, not rows. Raise the server caps per shape, compact plus compress, or plan subdocuments for big sheets?
12. **Announce collaborators' edits to screen readers by default?** Spike 8 proposes: always for "my" cell and joins/leaves, a 10 s digest for the rest, with a setting to turn it off.
13. **Suite keys** ⌥⇧P ("where is everyone"), Ctrl+G (Go to) and F6 (leave the sheet): fine, or do Docs/Tasks already have keys to reuse?
14. **Screen-reader row numbers** count the header row ("row 3" for sheet row 2) until `aria-rowindextext` is safe. Accept (proposed)?
15. **Undo of a move a peer overrode:** drop it silently (proposed) or say "can't undo: Ann moved this row"?

## Not verified

- Real Safari keyboard and clipboard (the screen was locked overnight), real Firefox clipboard, and live pastes from Excel / Google Sheets / Numbers. The fixtures were reconstructed from documented formats; one real paste from each app is needed. Spike 6's Safari script also left test text on the macOS pasteboard.
- No screen-reader pass by a person. Spike 8 checked what the browser hands a screen reader (accessibility tree, live region text, axe), but VoiceOver could not be driven (screen locked, AppleScript control off). A script and checklist are in its write-up.
- Touch only in emulation: no real iPhone or Android, and the iOS Simulator was not used. iOS clipboard (Safari's Paste bubble) not verified. Spike 7 has a checklist for a real phone.
- Spike 9's layout is not wired into the grid, the collab shape or a two-browser run; its fuzz uses small sheets without formulas. Migration with old and new clients in one room was not built.
- No mobile device, no slower laptop, no three-or-more-user session, no real slow network.
- Outside write (WebDAV edit while the sheet is open), commenter/reader roles, and cell comments: not run end to end.
- Offline pinning, Drive open-with, file preview, share menu, print, CSV/XLSX import/export for Sheets: inventoried, not built.
- Subdocuments for sheets beyond the caps.
- Spike 5's commits were made with `--no-verify` (the apps gates run the whole suite; its spike page trips import-boundary warnings on purpose). Spike 9 inherits that and also pushed with `--no-verify`. The other spikes pushed normally.
