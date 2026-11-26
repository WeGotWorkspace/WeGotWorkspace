# Spike 6: cell UX in Sheets

**Question:** can we build a good UI/UX for working with cells in Sheets? That covers selecting cells and ranges, mouse and keyboard, the fill handle, formula highlighting and autocomplete, and row/column-aware copy/paste.

**Answer: yes.** A DOM grid on the YCSV Yjs model covers all seven items. Each has automated interaction tests that pass in Chromium. Five items are good, two are rough (touch, and clipboard outside Chromium). None of it needs a canvas grid library. The selection and overlay layer works from geometry only, so it does not depend on which rows are rendered. A 10,000-row sheet renders about 30 rows, and selecting, jumping to the end and the status sum all still work.

Branch `spike/sheets-ux`. Code is in `prototypes/ycsv/src/ycsv-ux/`, the story in `src/stories/CellUx.stories.tsx` and the tests in `e2e/` and `tests/ux.test.ts`. Screenshots are in `docs/spike-6-ux/`.

## How to run

```bash
cd prototypes/ycsv
pnpm install --ignore-workspace
pnpm storybook            # http://localhost:6007 → "Spike 6 / Cell UX"
pnpm test                 # vitest: 49 unit tests (22 new for this spike)
SB_PORT=6007 pnpm test:e2e   # Playwright: 51 interaction tests (Chromium desktop + Pixel 7 touch)
SB_PORT=6007 pnpm test:e2e:all  # also Firefox + WebKit projects (see clipboard notes)
SHOTS=1 SB_PORT=6007 pnpm exec playwright test e2e/screenshots.spec.ts --project=chromium
```

Playwright starts Storybook itself when nothing is listening on `SB_PORT`. The default port is 6017.

## Architecture in one paragraph

- **One scroll container.** Sticky column headers sit on top, and each row's header is sticky on the left. Frozen rows live in the same sticky block.
- **Rows are windowed.** Fixed row height, visible rows plus 4 extra on each side. All columns render; horizontal windowing would be an easy later step.
- **One overlay per layer** draws the selection borders, active cell, fill handle, formula-ref outlines, copy ants, fill preview, drop indicator and peer cursors. It works purely from column widths and row index × row height, never from DOM cells. That is why selection and the fill handle keep working on rows that are not rendered.
- **One `<input>` is both the focus holder and the editor.** In navigation mode it is invisible and sits over the active cell. Typing a character, a dead key or IME text goes straight into it and becomes the cell edit. Copy, cut and paste events fire on it in every browser. It carries `aria-activedescendant` pointing at the active gridcell, and at the autocomplete option while that list is open.
- **Pointer handling is one hit test.** It maps client x/y to zone (corner, column header, row header, cell) and row/column. It uses pointer capture, so it works with virtualization and touch.
- **Every edit is one Yjs transaction** with origin `"local"`. `Y.UndoManager` tracks only that origin, so undo is per user in a shared doc and one gesture (a paste, a fill, a delete column) is one undo step. The selection is stored on each undo stack item and restored on undo.

## Per item

| # | Item | Built | Tested how | Verdict |
|---|------|-------|------------|---------|
| 1 | Selection | Active cell + multiple ranges; Shift+arrows; ⌘/Ctrl+arrows to the data edge; Shift+⌘/Ctrl+arrows; click, Shift+click, drag, ⌘/Ctrl+click; row and column headers (click, Shift, ⌘, drag); corner; ⌘/Ctrl+A; Shift+Space; Home/End/PageUp/PageDown; name box; status bar Sum/Average/Count | `e2e/1-selection.spec.ts` (6), unit tests | **Good** |
| 2 | Editing | Type-to-replace (dead keys and IME land in the cell); Enter and F2 edit; F2 toggles Enter/Edit mode; Escape cancels; Enter/Tab commit and move, and walk inside a selected range; Delete clears every range; undo/redo with selection; formula bar; double-click | `e2e/2-editing.spec.ts` (8) | **Good** |
| 3 | Fill handle | Drag down/up/right/left; series for numbers (linear trend), ISO dates (day and month steps), text+number with padding, weekdays/months/quarters (EN + NL); one number copies, Alt/Option-drag counts up; formulas shift; `$` refs stay; double-click fills down to the neighbour column; ⌘/Ctrl+D and +R | `e2e/3-fill.spec.ts` (6), unit tests | **Good** |
| 4 | Formula editing | Token colours match coloured outlines on the grid; click, drag, Shift+click and arrows insert refs (Excel's "point mode"); a pick in the edited row inserts the bare column name; autocomplete for functions, columns and defined names; signature help with the current argument; error states with explanations; unknown names underlined while typing | `e2e/4-formula.spec.ts` (8), unit tests | **Good** |
| 5 | Clipboard | Copy and cut write TSV + an HTML table, with the raw cells inside the HTML; paste reads our payload, Excel HTML (`x:num`), Google Sheets HTML (R1C1 formulas become our refs), Numbers HTML, and TSV; formulas shift on paste; cut moves; tiling; values-only (Shift+⌘/Ctrl+V); paste grows the sheet; whole rows/columns: ⌘V overwrites, the menu inserts; paste from another doc pastes values; menu Copy/Paste through the async Clipboard API | `e2e/5-clipboard.spec.ts` (12) with real ⌘C/⌘V in Chromium plus synthetic events for other apps' formats | **Good in Chromium; rough elsewhere** (see below) |
| 6 | Rows / columns | Resize by drag (all selected columns together); auto-fit on double-click; width stored in the doc and the file; insert/delete rows and columns; move rows/columns by dragging the selected headers; freeze rows; context menu (mouse, Shift+F10, ContextMenu key); ⌘/Ctrl+Alt+= / − | `e2e/6-rowcol.spec.ts` (7) | **Good** |
| 7 | Touch | Tap selects without popping the keyboard (`inputmode="none"` in navigation); double-tap edits; long-press opens the menu; swipe scrolls without selecting; bigger rows (36 px) and fill handle on coarse pointers; the fill handle drags with a finger | `e2e/7-touch.spec.ts` (4) on Pixel 7 emulation with CDP touch events | **Rough** (the minimum works; no range handles) |

The same suite (minus touch) also ran on Playwright **Firefox and WebKit**. All selection, editing, fill, formula and row/column tests pass on both. Only clipboard tests fail, for reasons that are test-harness limits, not grid bugs (see the clipboard section).

### What I found along the way

- **Moving the end row of a range shrinks the range.** Ranges are stored as `col@rowA:col@rowB`, so moving `rowB` above `rowA` changes what the range covers. `SUM(aantal1:aantal4)` became `SUM(aantal2:aantal1)` = 9 after dragging row 4 to the top. Excel and Sheets do the same (references follow the moved cell). It is tested and documented, not changed.
- **Double-tap on a phone selected the word in the editor.** The browser's compat `mousedown`/`dblclick` after the second tap landed on the editor that the tap had just opened. Fixed by cancelling the compat events after a double-tap.
- **Computed floats leaked into untyped columns** (`25.942800000000002`). The grid now shows at most 12 significant digits for numbers in untyped columns, like Excel's "General".
- **The first formula-ref colour was brand blue**, which looked like the selection. The ref palette now starts at violet.

## Keyboard map (proposed)

One map; ⌘ on Mac is Ctrl on Windows/Linux. Everything below is built and tested unless it says otherwise.

| Action | Mac | Windows | Notes |
|---|---|---|---|
| Move | ←↑→↓ | ←↑→↓ | |
| Extend selection | ⇧ + arrows | Shift + arrows | |
| Jump to data edge | ⌘ + arrows | Ctrl + arrows | Excel semantics |
| Extend to data edge | ⇧⌘ + arrows | Ctrl+Shift + arrows | |
| Row start / end | Home / End (fn+←/→) | Home / End | |
| Sheet start / last cell | ⌘Home / ⌘End | Ctrl+Home / Ctrl+End | |
| Page | PageUp / PageDown | PageUp / PageDown | Shift extends |
| Next / previous cell | Tab / ⇧Tab | Tab / Shift+Tab | Walks inside a selected range |
| **Edit cell** | **Enter** or **F2** | **Enter** or **F2** | Suite: Enter opens, F2 renames. In a grid both mean "edit this cell", caret at the end |
| Commit + down / up | Enter / ⇧Enter | Enter / Shift+Enter | |
| Commit + right / left | Tab / ⇧Tab | Tab / Shift+Tab | |
| Cancel edit | Esc | Esc | First Esc closes autocomplete |
| Toggle point/caret mode while editing | F2 | F2 | Excel's Enter/Edit mode |
| Clear cells | ⌫ or Delete | Delete or Backspace | All ranges |
| Select all | ⌘A | Ctrl+A | |
| Select rows / columns | ⇧Space / ⌃Space | Shift+Space / Ctrl+Space | ⌃Space clashes with the macOS input-source switch when that is on |
| Copy / Cut / Paste | ⌘C / ⌘X / ⌘V | Ctrl+C / X / V | |
| Paste values only | ⇧⌘V | Ctrl+Shift+V | Falls back to the async Clipboard API when the browser sends no paste event |
| Undo / Redo | ⌘Z / ⇧⌘Z | Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z | Per user (Y.UndoManager) |
| Fill down / right | ⌘D / ⌘R | Ctrl+D / Ctrl+R | ⌘R normally reloads the page; the grid takes it while focused, like Google Sheets |
| Insert / delete rows (or columns when whole columns are selected) | ⌘⌥= / ⌘⌥− | Ctrl+Alt+= / Ctrl+Alt+− | Google Sheets chord; Excel's Ctrl+± would hit browser zoom |
| Context menu | ⇧F10 or the Menu key | Shift+F10 or the Menu key | |
| Autocomplete | ↑↓ choose, Tab/Enter accept, Esc close | same | |
| Insert a ref while editing a formula | arrows / ⇧ arrows (Enter mode), click, drag, ⇧click | same | |
| Fill handle with increment | ⌥ + drag | Alt + drag | Excel uses Ctrl-drag |

**Decision on F2 against the suite keymap.** The suite says Enter opens and F2 renames. A cell has no separate name, so "rename" and "edit" are the same thing: changing the text in place. Both keys therefore start editing with the caret at the end. This matches Google Sheets (Enter edits) and Excel on Windows (F2 edits). Enter does **not** move down without editing, unlike Excel's default. Pressing Enter twice moves down, and typing over a cell plus Enter is the fast data-entry path. Inside the editor, F2 toggles between Excel's Enter mode (arrows leave the cell or point at cells) and Edit mode (arrows move the caret). The status bar shows which mode is on.

## Decisions taken tonight (reversible)

1. **DOM grid, not a canvas library.** June used Glide Data Grid (canvas). The DOM approach got ARIA gridcells, CSS tokens for light/dark and CSS-only theming, and overlays (refs, peers, ants) as plain divs, with no 1,100-line wrapper. Performance at scale is spike (a)'s question; this grid only needs `rawAt(r, c)` and `valueAt(r, c)`, so the incremental engine from `spike/sheets-perf` can slot in behind `useSheet`.
2. **Relative vs absolute refs in id form.** `prijs@r_x` points at a row by id. Copy and fill move it by position, like Excel's A1. `$` marks pin it: file form `$prijs$3`, id form `$prijs@$r_x`. A bare column name (`prijs`) means "this row", so it never needs a row shift. That makes `=aantal*prijs` the natural formula to fill down. Column names *do* shift on fill right / paste right, like A1 refs; `$prijs` pins the column. This needed a small model change: the tokenizer accepts `$`, and `toIdForm` / `toFileForm` keep the marks.
3. **Rectangular ranges** (`aantal1:prijs3`) are now supported by the engine (parser, eval, dependency graph), because range picking with the mouse naturally makes them.
4. **A click while editing a formula** inserts a ref only where an operand is expected: after `=`, an operator, `(` or `,`, or right after a ref that pointing inserted. Anywhere else the click commits the edit and selects the cell. This is Excel's rule. A pick in the edited row inserts the bare column name.
5. **Clipboard payload inside text/html** (`<table data-ycsv='…'>`), not a custom MIME type. Safari and Firefox drop custom types on the system clipboard; Google Sheets uses the same trick. The payload carries id-form cells, plain values, origin, doc id, a cut flag and whole-row/column flags.
6. **Plain paste overwrites, even for whole rows.** Inserting copied rows/columns is a menu action ("Insert copied rows above"), as in Excel. Paste past the edge grows the sheet.
7. **Paste from another document pastes values.** Row ids from another doc mean nothing here.
8. **Cut keeps formulas as they were** and clears the source when you paste (one undo step). References elsewhere that point at the cut cells are *not* rewritten (Excel does rewrite them). See open questions.
9. **External numbers.** We use the hidden raw number when the source gives one (Excel `x:num`, Sheets `data-sheets-value`). Otherwise text like `€ 1.234,50` is parsed with the target column's locale (or the browser's). `3,5` is a decimal everywhere; `1,234` depends on the locale; `50%` stays text.
10. **Column width and frozen rows are shared document state.** Width is on the column map and written to the file as `width:`; frozen rows are `meta.frozen_rows`. This matches Google Sheets; Excel makes freeze per window.
11. **Undo is per user and per gesture** (Y.UndoManager, origin `"local"`, `captureTimeout: 0`), with the selection restored.

## Clipboard: browsers and other apps

- **Chromium:** real ⌘C / ⌘X / ⌘V through Playwright's editing commands, read back with `navigator.clipboard.read()`. Our payload survives the async API's HTML sanitizing. Headless Chromium keeps its own clipboard, not the macOS pasteboard, so "paste from Excel" was tested with recorded formats dispatched as paste events (`e2e/fixtures/clipboard.ts`). **These fixtures were reconstructed from the documented formats, not captured live tonight.** Excel and Google Sheets need a sign-in, and capturing Numbers would need UI scripting on a locked Mac.
- **Firefox (Playwright):** all non-clipboard tests pass. The 8 clipboard failures come from Firefox ignoring `clipboardData` on *synthetic* `ClipboardEvent`s and from no async-read permission in the harness. Real ⌘C/⌘V in Firefox fire on the focused input, so the code path is the same, but it is **not verified**. Menu Paste needs Firefox 125+ (`clipboard.read`, which shows its own Paste button).
- **WebKit (Playwright):** synthetic paste events work, so every external-format test passes. The 4 failures come from `clipboard.read()` without a user gesture (`NotAllowedError`), which is how the tests read back what ⌘C wrote.
- **Real Safari 26.6 (safaridriver):** a session opened and pointer selection plus focus on the grid input worked. WebDriver keystrokes did not reach the page, so typing, ⌘C and ⌘V were **not verified**: the Mac's screen was locked overnight (`CGSSessionScreenIsLocked`). Known Safari limits: menu Paste shows Safari's own "Paste" callout, and ⇧⌘V's async fallback will show it too. My Safari script also put test text on the macOS pasteboard (`Ext1 1.234,5 …`).
- **Formulas from Google Sheets** arrive in R1C1 (`=R[0]C[-1]*2`) and are mapped to our refs relative to the paste target. Excel's HTML has no formulas (only values), which matches what Excel → Sheets does today.

## ARIA and virtualization

`role="grid"` with `aria-rowcount`/`aria-colcount` covering all rows, `aria-multiselectable`, `role="row"` with `aria-rowindex`, `columnheader` and `rowheader`, and `gridcell` with `aria-colindex` and `aria-selected`. Focus stays on one input, which points at the active cell with `aria-activedescendant`. Moving the active cell scrolls it into view, so the referenced cell is always rendered. When the user scrolls the active cell away with the wheel, `aria-activedescendant` is dropped until they move again.

What is realistic with virtualization: screen readers get the active cell, its row/column index and the counts. They cannot browse off-screen cells in their own browse mode (Google Sheets has the same limit and adds a "screen reader mode"). Announcements for copy/paste/mode changes go through a polite live region. **Not done:** a VoiceOver/NVDA pass by a person.

## Reuse from June (`origin/feat/spreadsheet-core`)

| June piece | Verdict |
|---|---|
| `formula-ref-pick.ts` (open-operand regex, range ref text, insert at caret) | **Idea reused**, rewritten for id form and bare same-row names |
| `formula-suggest.tsx` (context analysis: functions, columns, defs, `sheet!col`) | **Idea reused**; its `sheet!col` and mapping-key suggestions are worth porting once YCSV has multiple sheets |
| `formula-highlight.tsx` (tokenize + colour) | Idea reused; ours links colours to grid outlines |
| `spreadsheet-column-widths.ts` (measure text for auto-size) | Same approach (canvas `measureText`); either works |
| `spreadsheet-selection-info.ts` (status sums) | Same idea, small |
| `spreadsheet-history.ts` (50 whole-source snapshots) | **Do not reuse.** It undoes other people's edits in a shared doc; Y.UndoManager replaces it |
| `use-spreadsheet-keyboard-shortcuts.ts` (window listener that sniffs DOM classes to decide who owns a key) | **Fragile; do not reuse.** One focused input that owns all grid keys is simpler and testable |
| `spreadsheet-grid.tsx` on Glide Data Grid (1,173 lines) | **Do not reuse** for the reasons in decision 1. Glide's built-in fill handle and selection are nice, but overlays, ARIA and theming fight the library |
| Formatting bar, insert controls, schema panel | Out of scope tonight; not judged |

## Suite components

The spike uses its own small popover and menu (`ContextMenu.tsx`), because `prototypes/` sits outside the pnpm workspace. In the app, the context menu should be the suite `dropdown-menu` (Radix-based) opened at a point, and autocomplete/signature help should use `popover.tsx`. The suite toast should replace the inline toast. Selection colours follow the suite tokens: brand blue `#0045ff`, 12% fill in light and 18% in dark. The rest is light neutral greys.

## Model and repo changes on this branch

- `ycsv-formula`: `$` in identifiers; rectangular ranges (`col2` on range nodes; eval and the dependency graph walk columns in sheet order).
- `ycsv-model/refs.ts`: `$` marks round-trip file ↔ id form. `doc.ts` writes a grid-set `width` to the column def.
- `ycsv-grid/useSheet.ts`: exposes `width`.
- `src/react.d.ts` (a hand-written React type shim) was replaced by `@types/react` / `@types/react-dom`. Also added `@playwright/test` 1.65.0, matching the repo.
- The first push failed in the repo pre-push hook (the apps typecheck needed `node_modules` in this worktree). I ran `pnpm install` and pushed normally. **No `--no-verify` was used.**

## Open questions for the product lead

1. **Enter = edit (suite rule) vs Enter = move down (Excel habit).** I chose the suite rule plus Google Sheets behaviour. Do we want a setting for Excel muscle memory, or not?
2. **Column names shift on fill right / paste right**, like A1, so `=aantal*2` filled right becomes `=prijs*2`. With named columns, would you rather names stay put (like Excel table refs on copy) and only `prijs3`-style refs move?
3. **Cut + paste does not rewrite references from other cells** to the moved cells. Excel does. In id form we could do it: moving content to other row ids means rewriting refs. Do we want it for v1?
4. **Freeze rows: per document (shared) or per person?** It is shared now (Sheets), stored in the file.
5. **Touch:** is "tap, double-tap to edit, long-press menu, finger fill handle" enough for v1, or do we want range handles (drag the corners of a selection) as in the Sheets app?
6. **Row height** is fixed (28 px, 36 px on touch). Do we need per-row height or wrapped text in v1? Both cost virtualization simplicity.
7. **Multi-range copy** is refused with a message ("one range at a time"). Excel allows it when the ranges line up. Worth it?

## Not done or not verified

- Real Safari keyboard and clipboard (locked screen), real Firefox clipboard, and real Excel/Sheets/Numbers captures. The formats are reconstructed; please paste once from each app on a real Mac.
- No screen-reader pass by a person.
- Horizontal virtualization (all columns render).
- Multi-sheet refs (`sheet!col`) and sheet-name autocomplete: YCSV is one sheet per file today.
- Row resize, wrap text, merged cells, formatting, sorting/filters: out of scope.
- Fill handle dragged inward to clear (Excel), and autoscroll during drag that keeps going while the pointer is still (it scrolls on pointer moves only).
- Concurrent edits during a row/column move can be lost: Yjs has no array move, so a move is delete + insert of a copy with the same id. Spike (b) should look at this.
