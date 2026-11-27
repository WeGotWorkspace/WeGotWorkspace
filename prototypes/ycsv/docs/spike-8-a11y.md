# Spike 8: screen reader accessibility of the Sheets grid

**Question:** can a DOM grid that windows both rows and columns give a good experience with VoiceOver (macOS and iOS) and NVDA? Does that change the grid architecture?

**Answer: yes, with one change to spike 6's focus model and four rules for windowing.**

- **Focus model.** The active gridcell itself takes DOM focus, so the grid uses roving focus. It no longer relies on one `<input>` pointing at the cell with `aria-activedescendant`. To keep what made the single input attractive, the focused cell is an empty plain-text editing host (`contenteditable="plaintext-only"`). IME, dead keys, dictation, typing and clipboard events still land on it. The first character is then handed to the real editor. Spike 6's input remains, but only as the editor.
- **Windowing rules.**
  1. Every rendered row, the header row included, renders the same column set in the same DOM order.
  2. The active row and the active column are always rendered.
  3. Every cell and header carries `aria-colindex`, and every row carries `aria-rowindex`.
  4. A layout effect puts focus back on the active cell after every render.
- **Announcements.** Things that moving focus does not express go to a polite live region. That covers range size, edit cancel, clear, fill, paste and moves. Collaborators' edits arrive as a throttled digest. Peer carets are never announced; they can be asked for with a shortcut.

Everything below runs in the prototype and has automated tests. **No screen reader was heard.** The Mac's screen was locked, VoiceOver's AppleScript control is off, and enabling it needs `sudo`. The tests check what the browser hands a screen reader: Chromium's computed accessibility tree (the source for NVDA, JAWS and VoiceOver in Chrome), the live region text, axe-core, and DOM invariants. A ready-made VoiceOver script and a short checklist for a person are at the end.

Branch `spike/sheets-a11y`, cut from `spike/sheets-ux`. Nothing went to main.

## How to run

```bash
cd prototypes/ycsv
pnpm install --ignore-workspace
pnpm storybook                       # http://localhost:6007 → "Spike 6 / Cell UX" → "A 11 Y Cell", "A 11 Y Wide", "A 11 Y Two Users"
pnpm test                            # vitest: 55 unit tests (6 new: speech strings, digest throttle, label contrast)
SB_PORT=6007 pnpm exec playwright test e2e/a11y --project=chromium            # 17 spike 8 tests
FOCUS_MODEL=cell SB_PORT=6007 pnpm test:e2e                                    # spike 6's 51 interaction tests on the new focus model
RECORD=1 SB_PORT=6007 pnpm exec playwright test e2e/a11y --project=chromium --workers=1   # rewrites docs/spike-8-a11y/*
```

The grid takes a `focusModel` prop: `"cell"` (proposed) or `"descendant"` (spike 6). Both stay in the prototype so they can be compared side by side with a real screen reader. In Storybook it is the `focusModel` control.

## 1. The ARIA pattern

```
grid "Sheet"  aria-rowcount=N+1  aria-colcount=M+1  aria-multiselectable  aria-describedby→help text
├─ rowgroup (sticky: header row + frozen rows)
│  └─ row aria-rowindex=1
│     ├─ columnheader aria-colindex=1  "Row"             (the corner; visually hidden text)
│     └─ columnheader aria-colindex=c+2 "Prijs"          (only the windowed columns + the active one)
└─ rowgroup (body: windowed rows + the active row)
   └─ row aria-rowindex=r+2
      ├─ rowheader aria-colindex=1 "3"
      └─ gridcell aria-colindex=c+2 aria-selected  name = shown value
         (active cell: tabindex=0, contenteditable=plaintext-only, aria-describedby→details)
overlays (selection, refs, peers, fill handle): aria-hidden
polite live region ×2 (alternated, so a repeated message is spoken again)
```

- **The cell's name is its shown value** (`€ 3,27`, not `3.267`). Errors are spoken as words: `#REF!` becomes "reference error", not "number sign R E F exclamation mark".
- **Details are on the active cell only** (`aria-describedby` → one hidden element). They hold the formula (`Formula =aantal*prijs*(1+btw)`), the error explanation ("Points at a row or column that no longer exists") and "Anna is also on this cell". NVDA reads descriptions right after the name. VoiceOver reads them after a short pause, or with VO+Shift+H.
- **Header names say the formula ref when it differs from the display name** ("Kolom 2, ref k2"). When they only differ in case (`Prijs` / `prijs`) the header is just "Prijs".
- **The grid's description** gives the way out and the main keys: "Arrow keys move. Enter or F2 edits, Escape cancels. Tab moves to the next cell. F6 leaves the sheet. Shift+F10 opens the cell menu."

## 2. Focus model: why the cell, not the input

| | `descendant` (spike 6) | **`cell` (chosen)** | Live region only (Google Sheets style) |
|---|---|---|---|
| What has DOM focus | One `<input>` outside the grid | The active gridcell | Hidden input |
| How a screen reader learns the cell | `aria-activedescendant` from a textbox to a gridcell it does not own | Normal focus change into a table cell | Announcement text on every move |
| Column/row headers, position, "selected" | Only if the screen reader follows activedescendant into the grid's table model | Native table behaviour of every screen reader | Must be written into the text; table commands do not work |
| Known support | Chrome: yes, the relation resolves (measured, see transcript). **WebKit/VoiceOver: activedescendant from a plain textbox is the weakest link.** VoiceOver often speaks only the focused element ("Sheet, edit text") | Every browser and screen reader handles focus on a gridcell (APG's first-choice pattern) | Works everywhere, but double speech when the screen reader also reads focus, and no header association |
| IME, dead keys, clipboard | Native (it is an input) | **Kept:** the focused cell is a plain-text editing host. Measured in Chromium (CDP IME composition, dead key ´+e = é), Firefox and WebKit (typing, ⌘C/⌘X/⌘V events) | Native |
| Focused cell scrolled out of the window | Spike 6 dropped `aria-activedescendant` (pointing at nothing) | Active row and column stay rendered, so focus never falls to `<body>` | n/a |
| ARIA validity | `aria-expanded` on a textbox was invalid (fixed: the editor is a `combobox` while editing) | Valid; axe clean | Valid |

**What decided it:** the descendant model's quality depends on the browser and screen reader pair most likely to be weak, Safari + VoiceOver. That pair matters most on a Mac-first suite. The cell model's only cost was input robustness, and the editing-host trick removes that cost: the browser treats the focused cell as editable, so the operating system's text input (IME, dead keys, dictation) stays active. A first test that focused a plain, non-editable cell lost the IME composition entirely (`e2e/a11y/focus-host.spec.ts`).

**What the user hears for "editable":** a focused `contenteditable` gridcell is exposed as editable. NVDA may add "editable", and VoiceOver may add "edit text". That is honest (typing replaces the cell), but it is noise. If it is too much when heard, one fix is to make the cell an editing host only while a key is held down. That needs a real listening session first.

## 3. What is announced, and through which channel

| Event | Channel | Text (from the prototype) |
|---|---|---|
| Move one cell, jump, Home/End, PageUp/Down | Focus (the cell speaks) | value; header when the column changes; row header when the row changes; details |
| Formula cell | Focus → description | "€ 3,27 … Formula =aantal\*prijs\*(1+btw)" |
| Error cell | Focus → name + description | "reference error … Points at a row or column that no longer exists. Formula =#REF!" |
| Range grows (Shift+arrows, Shift+Space, header click) | Live, debounced 250 ms (one line per Shift burst) | "Aantal row 2 to Totaal row 3 selected, 2 rows by 3 columns, sum 23.1708" |
| Whole rows / columns / ⌘A | Live | "Row 5 selected", "Columns Aantal to Prijs selected, 2 columns", "Whole sheet selected" |
| Enter / F2 (edit on) | Focus moves to the editor | combobox "Editing Totaal row 6, edit mode", value = the formula |
| Type over a cell | Focus moves to the editor | "Editing Prijs row 3" + the typed text |
| F2 inside the editor | Live | "Edit mode: arrows move the caret" / "Point mode: arrows pick cells" |
| Pointing at a cell while writing a formula | Live | "prijs3, Prijs row 3" |
| Autocomplete | Combobox `aria-activedescendant` → option | option label + detail (standard APG combobox) |
| Signature help | Editor's `aria-describedby` | "SUM(number1, …) Adds numbers" |
| Escape (cancel), Delete, fill, paste, undo, insert/delete/move rows, width | Live | "Edit cancelled", "Cleared 12 cells", "Filled 5 cells", "Pasted 3 by 2", "Undone", "Inserted 1 row at row 4", "Moved to row 1", "Width set to 200 pixels" |
| Copy / cut | Live | "Copied" / "Cut" |

Plain moves put nothing in the live region; the test checks this. Speaking a move twice (once by focus, once by live region) is the most common mistake in spreadsheet accessibility.

### Remote changes and peer carets

Decided policy, built in `RemoteDigest` (`src/ycsv-ux/a11y.ts`):

- **Someone changes the cell I am on:** announced at once, at most once per second ("Ben changed this cell to Peren"). The author comes from the Yjs transaction's client clock and is named through awareness.
- **Edits elsewhere:** counted per person and spoken as one line at most once per window (10 s). "Ben edited 40 cells" was one announcement for 40 separate transactions in the e2e test. A prop (`announceRemoteEdits`) turns this off and is meant to become a user setting.
- **Rows or columns inserted or deleted by others:** in the same digest ("Ben inserted 2 rows").
- **Joins and leaves:** in the digest ("Ben and Chris joined").
- **Peer carets and selections:** never announced. Chris walks around every 1.6 s in the test story, and nothing was said in 3.5 s. **⌥⇧P / Alt+Shift+P** answers "where is everyone?": "Ben is on Product row 1. Chris is on Product row 6". When a peer is on my cell, the cell's details say so.

Recorded live output for Anna's sheet in the two-user test: `docs/spike-8-a11y/live-two-users.json`.

## 4. Keyboard-only reachability

Everything a mouse user can do now has a keyboard route, inside the one suite keymap (Enter edits, F2 edits, roving focus):

| Mouse action | Keyboard route (built and tested) |
|---|---|
| Fill handle drag (copy) | ⌘D / ⌘R, or menu "Fill down" / "Fill right" |
| Fill handle drag (series) | Select the series plus the empty cells, then menu "Fill series down" |
| Fill handle double-click | Menu "Fill down to end of data" |
| Drag row / column headers to move | **⌥⇧↑↓ / ⌥⇧←→** (Alt+Shift+arrows), or menu "Move row up" and the like |
| Drag a column border to resize | Menu "Column width…" (a dialog with Save/Cancel), or "Fit column width to content" |
| Click a header | Shift+Space (rows), Ctrl+Space (columns) |
| Right-click | Shift+F10 / the Menu key; the menu adapts to cells, rows or columns |
| Click the name box | **Ctrl+G** (both platforms) or **F6**. It is now a "Go to" field: type `prijs5` or `aantal1:prijs4` and press Enter |
| Leave the sheet | **F6** (Tab moves between cells, like every spreadsheet). Escape or F6 in the name box or formula bar returns to the sheet |
| Autocomplete / signature help | Already keyboard: ↑↓, Tab/Enter, Esc |
| Formula bar | Tabbing into it no longer starts an edit (it did in spike 6). Typing, Enter or F2 starts one |

**Assistive-tech activation** was a real gap. VoiceOver's double-tap on iOS, VO+Space, and NVDA/JAWS's default action in browse mode send a bare `click` without the pointer events before it. Spike 6 handled only pointer events, so activating a cell did nothing. The grid now treats a bare click as a tap: it selects the cell, header or row, and activating the active cell again opens the editor. This is tested with `element.click()`.

## 5. Column windowing and header association

The prototype now windows columns as well: visible columns plus 2 extra on each side. With 30 columns, only about 14 are in the DOM.

The risk: browsers build a grid's table model from **DOM position**. NVDA (through IA2 / UIA), JAWS and VoiceOver ask that model for a cell's column header, not `aria-colindex`. A row that renders a different column set than the header row pairs cells with the wrong header. That is silent and only shows when someone listens. The rules:

1. Header row and body rows render **one shared column list** (`visCols`), in the same order.
2. Row header and corner take position 0 (`aria-colindex=1`), so positions line up.
3. The active column (and the edited column) is part of that list even when scrolled away. Every row then gets that column too, so the pairing holds.
4. `aria-colindex` on every cell and header; `aria-colcount` and `aria-rowcount` hold the full sheet.

The tests check this at every step of the transcript and after scrolling 10,000 × 30 to the middle. Pairing by DOM position equals pairing by `aria-colindex`, and every rendered row has the identical column set. Chromium's CDP does not expose the computed header relation, so the header pairing itself still has to be **heard** (checklist).

## 6. What each screen reader says

### Measured: what Chromium exposes (NVDA, JAWS, VoiceOver in Chrome all read this)

Full tables: `docs/spike-8-a11y/ax-transcript-cell.md` and `ax-transcript-descendant.md`. Excerpt, cell model:

| Key | Focused node | Header | Row header | Live region |
|---|---|---|---|---|
| — | gridcell "Appels" | Product | 1 | |
| → → → | gridcell "€ 3,27" — Formula =aantal\*prijs\*(1+btw) | Totaal | 1 | |
| ⌘↓ | gridcell "circular reference error" — The formula depends on itself. Formula =totaal6 | Totaal | 6 | |
| ← ← | gridcell "reference error" — Points at a row or column that no longer exists. Formula =#REF! | Aantal | 6 | |
| ⇧← ⇧↑ | (focus stays) | | | Product row 5 to Aantal row 6 selected, 2 rows by 2 columns, sum 12 |
| Enter | combobox "Editing Aantal row 6, edit mode" | | | |
| Esc | gridcell "reference error" … | Aantal | 6 | Edit cancelled |

In the descendant model, the focused node is always textbox "Sheet" and the gridcell is only the activedescendant target. Chromium resolves that relation, but WebKit's handling is the open risk.

Playwright's aria snapshot of the windowed 10,000 × 30 grid: `docs/spike-8-a11y/aria-snapshot-wide.yaml`.

### Expected per screen reader (not heard; from known behaviour, to be confirmed with the checklist)

| | Cell model, expected | Risk to listen for |
|---|---|---|
| **NVDA + Chrome/Firefox** | Switches to focus mode when entering the grid (role=grid). On each move: value, "selected", column header when the column changes, row header when the row changes, "row 3 column 4" if coordinates are on, then the description | Extra "editable" on the focused cell. Row number off by one (see below) |
| **VoiceOver + Safari (macOS)** | Value, then column header / position as VoiceOver does for focused table cells. The description comes after a pause | "edit text" on every move. Whether VoiceOver announces the column header on column change for a focused cell (it does for VO-cursor table navigation) |
| **VoiceOver + Chrome (macOS)** | Like Safari; Chrome's mac mapping is the same tree as measured above | Same |
| **VoiceOver iOS (Safari)** | Swipe moves over rendered cells; double-tap selects; double-tap again edits (bare-click path) | Swiping past the last rendered row: VoiceOver scrolls, so more rows render, but this may skip rows. A hardware keyboard on iPad should behave like macOS |

**Row numbers off by one.** The header row is row 1 in ARIA, so the sheet's row 2 is `aria-rowindex=3`. A screen reader that reads coordinates says "row 3" while the row header says "2". ARIA 1.3's `aria-rowindextext` fixes this. I tried it, but axe 4.11 rejects it (aria-valid-attr, critical) and support is unknown, so it is not in the prototype. For now the row header's own text ("2") is the sheet row number; the screen reader reads it when the row changes. Live-region texts use sheet row numbers ("Prijs row 3").

## 7. Impact on the grid and windowing design

This changes the architecture of the real build in these places. It does not change the model, the engine or the overlay approach.

1. **Focus:** roving focus on the active gridcell, which is a plain-text editing host. The editor `<input>` exists only while editing and is `inert` otherwise. Keys, composition and clipboard handlers sit on the cell host. Focus is re-asserted in a layout effect after every render, because the active cell's element changes without the selection changing: a peer moves rows, a remote insert, a column scrolls in. Cells are keyed by row id and column id, so scrolling does not remount the focused element.
2. **Windowing:** one column list for every row (header row included), plus the active row and column pinned into the window. Spike 4's `ScaleGrid` draws absolutely positioned cells with per-row column windows. It must follow the same "one column list" rule, or header pairing breaks. `workspace-list-window.ts` can still compute the ranges.
3. **An a11y layer beside rendering:**
   - pure speech functions (`a11y.ts`)
   - one live-region announcer, with two alternating slots and a debounce for selection
   - a remote digest fed by Yjs `observeDeep` plus awareness
   - In the app this belongs in `sheets-core` as a hook. Other suite apps with live collaboration can reuse the digest; Docs and Tasks have the same "announce peers or not" question.
4. **Overlays stay `aria-hidden`.** Selection, refs, ants and peer cursors are visual. Their meaning reaches the screen reader through `aria-selected`, the live region and the cell details.
5. **The bare-click path is part of the pointer layer.** Every pointer action that has an accessible-activation meaning must also work from `click` alone.
6. **The component got bigger:** `SheetGrid.tsx` went from 1,741 to 2,230 lines. The real build should split it into hooks (`useGridFocus`, `useAnnouncer`, `useRemoteDigest`, `useWindow`) before it nears the 800-line rule.

## 8. Fixed along the way (all in the spike 6 grid)

- `aria-expanded`, `aria-autocomplete` and `aria-controls` on a plain textbox were invalid (axe critical). The editor is now `role="combobox"` while editing, per the APG combobox pattern.
- Four contrast failures in light mode: the column ref under a header on the selected-column tint, autocomplete kind and detail, and menu shortcut `kbd`. Muted text in those places is now `#52525b`. Peer name labels were white on orange (3.4:1), so label text now picks black or white by contrast (`readableOn`).
- The corner cell was an unnamed element in the header row. It is now `columnheader` "Row", so the row header column has a header and positions line up.
- Peer name labels inside the grid were stray text in the table; overlays are now `aria-hidden`.
- The focused cell scrolled out by wheel lost `aria-activedescendant`; the active row and column are now always rendered.
- Tabbing through the formula bar started an edit.
- A bare `click` from assistive tech did nothing.

**axe-core** (4.11, WCAG 2.0/2.1/2.2 A and AA plus best-practice) now finds **0 violations** in both focus models. It was run in 7 states: navigation, editing with autocomplete, context menu, width dialog, the two-user story, and 10,000 × 30 scrolled to the middle. It also passes in Firefox and WebKit. Reports: `docs/spike-8-a11y/axe-*.json`. `color-contrast` stays "incomplete" on cells over the selection tint, because axe cannot compute through translucent overlays; the tint is 12%, so the text keeps its contrast.

## 9. Verification done

| Check | Where | Result |
|---|---|---|
| Spike 6's 51 interaction tests, descendant model (column windowing added) | `e2e/1–7`, Chromium + Pixel 7 touch | 51/51 |
| Same 51 tests on the cell focus model | `FOCUS_MODEL=cell` | 51/51 |
| Cell model in Firefox and WebKit (selection, editing, fill, formula, rows/cols, a11y) | `--project=firefox --project=webkit` | All pass except the same 11 clipboard tests that fail for the descendant model too: harness limits documented in spike 6 (synthetic `clipboardData` in Firefox, `clipboard.read()` without a gesture in WebKit). One Firefox 10k-row test flaked once under load and passed 3/3 on rerun |
| Accessibility tree transcript, both models | `e2e/a11y/a11y.spec.ts` (CDP) | Recorded in `docs/spike-8-a11y/` |
| Header pairing by DOM position = by `aria-colindex` | transcript + wide-grid test | Equal at every step; identical column set in every row |
| Focus survives scrolling the active cell out (rows and columns) | wide-grid test, both models | Focus / activedescendant stays on the cell; ↓ brings it back |
| IME (Japanese) and dead key (´e → é) into the focused cell | CDP `Input.imeSetComposition` | "日本語", "één" saved |
| Live region: nothing on plain moves; one line per Shift burst; edit/clear/undo | announcements test | As in section 3 |
| Remote digest: my-cell change, 40-edit burst = 1 line, carets silent, presence on demand | two-user test | As in section 3 |
| Keyboard routes: move row, fill series, width dialog, Ctrl+G, F6, tab order | routes + tab-order tests | Pass |
| Bare-click activation selects; a second one edits | AT-click test | Pass |
| axe | 7 states × 2 models, Chromium, Firefox, WebKit | 0 violations |
| Unit: speech strings, digest throttle (fake timers), label contrast | `tests/a11y.test.ts` | 6/6 (55/55 in total) |

## 10. Not verified, and a checklist for a person

**Not verified:** no screen reader was heard. The Mac's screen was locked all session (`CGSSessionScreenIsLocked`). VoiceOver's AppleScript control is off, and turning it on needs `sudo` (`/private/var/db/Accessibility/.VoiceOverAppleScriptEnabled`). This process also has no Accessibility permission for System Events. Not run at all: NVDA (needs Windows), iOS VoiceOver (the simulator has no VoiceOver), and JAWS. `aria-rowindextext` support is unknown.

### Run VoiceOver automatically (macOS, about one run per browser)

1. VoiceOver Utility → General → turn on **Allow VoiceOver to be controlled with AppleScript**.
2. System Settings → Privacy & Security → Accessibility → allow **Terminal**.
3. `cd prototypes/ycsv && pnpm storybook`, then:

```bash
osascript scripts/voiceover-transcript.applescript Safari cell > docs/spike-8-a11y/voiceover-safari-cell.txt
```

```bash
osascript scripts/voiceover-transcript.applescript Safari descendant > docs/spike-8-a11y/voiceover-safari-descendant.txt
```

```bash
osascript scripts/voiceover-transcript.applescript "Google Chrome" cell > docs/spike-8-a11y/voiceover-chrome-cell.txt
```

The script opens the story with focus in the sheet and starts VoiceOver. It presses 16 keys (moves, formula cell, data edge, blank, `#REF!`, range, edit, cancel, menu), prints VoiceOver's last phrase after each, and quits VoiceOver. Compare the Safari `cell` and `descendant` files. If `descendant` only says "Sheet, edit text" where `cell` says the value, that confirms the choice.

### Listen by hand (VoiceOver macOS, then NVDA on Windows, then iPhone)

Story: **Spike 6 / Cell UX → A 11 Y Cell** (and **A 11 Y Two Users** for 7–8).

1. Click A1, move → → →. Do you hear the value, and the **column name** when the column changes? Is "edit text" / "editable" said on every move, and is it bearable?
2. Go to Totaal (a formula). Is the formula read (VO: after a pause or VO+Shift+H; NVDA: right away)?
3. ⌘↓, ← ←: is `#REF!` read as "reference error" with the explanation?
4. Shift+→ ×2: one line "… selected, 1 row by 3 columns", not three?
5. Enter: "Editing …" plus the value? Escape: "Edit cancelled", and back on the cell?
6. Type `=SU`: are the suggestions read while you press ↓?
7. Two users: does Ben's edit of your cell get announced once? While Chris wanders, is it quiet? ⌥⇧P: are names and places read?
8. **A 11 Y Wide**: scroll right with the trackpad to column 20, then press →. Do the column names match the cells? (Header pairing under column windowing.)
9. NVDA: does it switch to focus mode in the grid by itself? Does NVDA+Ctrl+Alt+arrow (table navigation) stop at the window edge, and is that acceptable?
10. iPhone VoiceOver: swipe through cells. Does double-tap select and a second double-tap edit? Swipe past the bottom of the screen: does it keep going down the rows?

## Open questions for the product lead

1. **Announce collaborators' edits by default?** Proposed: always announce changes to "my" cell plus joins and leaves; edits elsewhere as a 10 s digest, on by default with a setting to turn it off. Or off by default?
2. **⌥⇧P for "where is everyone"** and **Ctrl+G / F6 for Go to / leave the sheet**: fine as suite keys, or do Docs and Tasks already use something we should reuse?
3. **Row numbers:** accept that screen readers count the header row ("row 3" for sheet row 2) until `aria-rowindextext` is safe, or change the visible numbering? Proposed: accept.
4. **Header names with refs** ("Kolom 2, ref k2") are heard on every column change. Keep, or only on request?
