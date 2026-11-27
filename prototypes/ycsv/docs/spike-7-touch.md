# Spike 7: touch for the Sheets cell grid

**Question:** can the spike 6 grid design carry a good phone and tablet experience, or does touch force changes to the grid architecture? And for product decision 5: is touch v1 only tap / double-tap / long-press / finger fill handle (variant A), or also draggable range handles (variant B)?

**Answer: the design carries it.** The three load-bearing ideas from spike 6 all hold under a finger:

- one focused input
- one overlay layer drawn from geometry (column widths × row height)
- windowed rows inside a native scroll container

Nothing needed a canvas, a custom scroller or JavaScript momentum. The browser keeps doing the panning and momentum. The grid only reacts to taps, long-presses and drags that start on a handle.

Touch did force two changes inside the grid. Neither changes the architecture:

1. **Render cost per scroll frame.** At phone-like CPU speed the spike 6 grid re-rendered every row on every scroll event and dropped to about 30 fps. Two small changes fixed that, measured below:
   - the row window only moves in steps
   - rows are memoised
2. **A second home for the editor on phones.** On a phone the on-screen keyboard covers half the screen, so the formula bar becomes the editor and docks above the keyboard. Spike 6 already let the formula bar be the editor (`source: "bar"`), so this is placement, not a new editing model.

**Recommendation for decision 5: variant B.** See "Decision 5" below.

Branch `spike/sheets-touch`, cut from `spike/sheets-ux`. Nothing went to main and no PR was opened.

## How to run

```bash
cd prototypes/ycsv
pnpm install --ignore-workspace
pnpm exec storybook dev -p 6027 --no-open   # "Spike 7 / Touch": Variant A, Variant B, Frozen A/B, Ten Thousand Rows (frame meter)
SB_PORT=6027 pnpm test:touch                 # 56 touch tests: Android phone + tablet (Chromium), iPhone + iPad (WebKit)
SB_PORT=6027 pnpm test:e2e                   # spike 6 suite (desktop Chromium + Pixel 7), still green
pnpm test                                    # vitest, 51 unit tests (2 new)
PERF=1 SB_PORT=6027 pnpm exec playwright test e2e/touch-perf.spec.ts --project=touch-perf
SHOTS=1 SB_PORT=6027 pnpm exec playwright test e2e/touch-shots.spec.ts --project=iphone --project=ipad --project=android-phone
```

The A/B switch sits in the story's top bar, so both variants run on the same sheet. Variant A is also the spike 6 behaviour, made finger-ready.

## What was built

Shared by both variants (code: `src/ycsv-ux/SheetGrid.tsx`, `touch.ts`, `SheetGrid.css`, `ContextMenu.tsx`):

| Topic | What it does now |
|---|---|
| **Scroll vs select** | One rule: a finger that starts on a cell or header *always pans*. Native scrolling, with momentum, through `touch-action: pan-x pan-y`. A tap is "down and up within 8 px". Only a drag that starts on a handle (fill handle, range handle, resize grip) changes the selection. Those elements have `touch-action: none`. When the browser takes over a pan it sends `pointercancel`, and the grid drops the pending tap. |
| **Tap / double-tap / long-press** | Tap selects without raising the keyboard (`inputmode="none"` on the focus input). Double-tap (within 350 ms) edits. Long-press (500 ms, no movement) opens the menu. Android's own `contextmenu` on long-press is ignored, so the menu does not open twice. |
| **Keyboard covering the cell** | `useVisualViewport()` tracks the visible area. iOS Safari and Chrome on Android 108+ shrink the *visual* viewport, not the layout viewport. While editing, the grid scrolls so the edited cell sits above the keyboard and the dock. It also adds temporary room below the last row, so even the last row can get above the keyboard. |
| **Editing on a phone** | Below 600 px width, a finger edit happens in the formula bar, docked above the keyboard. The dock has the name box, the input at 16 px (iOS zooms into smaller inputs), ✕ and ✓, a strip with `= ( ) : , + - * / $ "` (a layer deep on phone keyboards), and a one-line signature help. Tapping a cell while a formula wants an operand inserts a reference, as with the mouse. Tablets edit in the cell, as on desktop. |
| **Raising the keyboard** | iOS only shows the keyboard for a `focus()` made *inside* the touch handler. On a double-tap the handler focuses synchronously: the dock input on a phone, or the cell input re-focused as a text field on a tablet. |
| **Formula autocomplete** | Phone: the suggestions become 44 px chips in the dock, in place of the symbol strip, so nothing covers the cell being edited. A first attempt with a list above the dock hid the edited cell on an iPhone-sized screen (screenshots proved it). Tablet: the list sits below the cell and flips above it when the keyboard leaves less than about 220 px. Options are 44 px tall. |
| **Fill handle by finger** | A 14 px dot with a 44 px hit area. Drags with a finger. **Edge auto-scroll** now runs on `requestAnimationFrame`: a finger resting at the bottom edge keeps scrolling and extending. Spike 6 scrolled only on pointer moves; that was an open item there, and this fixes desktop too. The bottom edge is the top of the keyboard / dock when they are up. |
| **Row / column headers** | Tap a header to select the row or column. Tap the selected header again, or long-press it, to open its menu. The menu has insert, delete, freeze and fit width, plus **Move up/down/left/right**, because a header drag is a pan on touch. A selected column shows a 28 px resize grip at its right edge. The 8 px desktop resize strips are hidden under a finger. |
| **Copy / paste** | Through the menu (and the B callout), using the async Clipboard API. When the browser refuses (no permission, or Safari's Paste callout dismissed), copy still works inside the sheet and paste falls back to that in-memory copy. Paste from other apps needs the system clipboard. |
| **Menus** | 44 px items, scrollable, opened 28 px below the finger. **Bug found and fixed:** lifting the finger after a long-press landed as a click on the item under it (Chromium ran "Cut" by itself). Menu items now act on a pointer click only after a press started inside the menu. Keyboard activation still works. |
| **Frozen rows** | Unchanged sticky layer. Tested while scrolled programmatically and during a CDP momentum fling: the frozen row does not move. |
| **Pinch** | Pinch zooms **the grid, not the page**: 0.6×–1.8×, scaling row height, column widths and cell font, anchored at the pinch centre. Two-finger `touchmove` is `preventDefault`ed, and Safari's `gesturestart/gesturechange` are blocked on the grid. The zoom level is per person and device (`localStorage`), not in the document. See "Pinch policy". |

Variant A (`touchVariant="a"`): the above, plus the always-visible finger fill handle. There is no way to select a block of cells by finger. Only a cell, a whole row or column (headers), or everything (corner).

Variant B (`touchVariant="b"`): the above, plus **range handles**:

- Two 14 px knobs with 44 px hit areas, at the top-left and bottom-right corners of the selection.
- Drag either knob to resize the range. The opposite corner stays put.
- The knob, not the finger, decides the cell: the grab offset is kept, so the finger does not hide the corner it moves.
- Whole rows get their knobs on the row headers (top/bottom), and whole columns on the column headers (left/right). Dragging those keeps the selection whole.
- Knobs live in their own layer above the sticky row headers, so a knob on column A is not half hidden.
- Edge auto-scroll works for knob drags too.
- After a knob drag, an iOS-style **callout** (Cut · Copy · Paste · Fill · ⋯) appears next to the range.
- The fill handle is hidden in B, because the bottom-right corner belongs to the range knob. "Fill" in the callout or menu turns the end knob into the fill handle until you fill or change the selection. Excel for iPhone works the same way.
- The menu also has **Fill down / Fill right** in both variants (⌘D/⌘R equivalents).

## Tests

`e2e/8-touch.spec.ts`: 14 tests × 4 projects = **56 runs, all green**:

- `android-phone` (Pixel 7) and `android-tablet` (Galaxy Tab S4) on Chromium. Taps, long-presses, drags, swipes, flings and pinches are real touch input through CDP, so Chromium itself arbitrates tap vs pan.
- `iphone` (iPhone 15) and `ipad` (iPad Pro 11) on WebKit. Taps are real. Drags and long-presses are synthetic touch-type `PointerEvent`s, because Playwright WebKit has no touch-drag API and no `Touch` constructor. So in WebKit the tests prove our gesture code, not Safari's own pan/zoom arbitration. Swipe and pinch run in Chromium only (4 skips).

| Test | Covers |
|---|---|
| tap selects without the keyboard; header tap selects, second tap opens actions | tap, `inputmode`, 36 px rows, header actions, 44 px items |
| double-tap edits: docked on a phone, in the cell on a tablet | double-tap, dock, focus, commit with ✓ / Enter, keyboard dismissed |
| long-press menu; copy and paste through it | long-press, menu size, clipboard (system in Chromium, in-sheet fallback in WebKit) |
| move a row down from the header menu | row actions without header drag |
| frozen rows stay while the body scrolls | frozen rows, programmatic scroll + momentum fling (Chromium) |
| the edited cell stays above the keyboard | `visualViewport` shrink → dock position, cell scrolled above it |
| autocomplete, symbol strip, tap-to-reference | phone chips in the dock / tablet flip above, symbol keys, signature, ref by tap |
| A: no range handles; finger fill handle | variant A fill |
| A: finger resting on the bottom edge keeps the fill going | rAF edge auto-scroll, filled past the screen |
| B: handles replace the fill handle; dragging selects a range | both knobs, callout, status bar |
| B: Fill from the callout | fill mode |
| B: whole rows get their handles on the row headers | header knobs |
| swipe pans and leaves the selection alone, both variants (Chromium) | scroll vs select |
| pinch zooms the grid, not the page (Chromium) | grid zoom, `visualViewport.scale` stays 1, zoom stored per device |

Also: `tests/touch.test.ts` (edge speed, zoom clamp). The spike 6 suites still pass:

- desktop Chromium: 47 tests
- Pixel 7: 4 tests
- desktop WebKit and Firefox: 70 tests, minus the known clipboard harness limits

The whole touch + desktop Chromium set ran twice in a row green (206/206).

Two harness traps worth knowing:

- Playwright's `testIgnore: /touch/` matched the *worktree path* (`sheets-touch-…`), so the desktop project silently ran zero tests. The patterns are now anchored to `e2e/`.
- A 0×0 knob element counts as "hidden" for Playwright, so the knob element is now its own 44 px hit box.

## Measurements

10,000 rows × 4 columns, Pixel 7 emulation in headless Chromium, `Input.synthesizeScrollGesture` touch flings with momentum (2,500 px, speed 6,000 px/s), each fling travelling about 3,800 px. Frame gaps come from `requestAnimationFrame` on the main thread. "Blank" counts frames where the rendered rows did not cover the rows `scrollTop` says are visible. CPU throttling stands in for a phone. The Mac was **busy** (load average 6–16 from other sessions). Raw data: `docs/spike-7-touch/perf-results.json`.

**Before** (spike 6 rendering, every scroll event re-renders every row):

| CPU | fling fps | frames > 20 ms | blank frames | long tasks | pinch fps |
|---|---|---|---|---|---|
| 1× | 60 | 0 | 0 | 0 | 60 |
| 4× | 29–30 | 30 of 46 | 4–6 | 1 | 45 |
| 6× | 20–22 | 19–21 of 34 | 5–7 | 20–22 | 33 |

Overscan (4, 12 or 30 rows) made no difference: the cost was the render, not the number of rows.

**After** (row window moves in steps of half the overscan, rows memoised):

| CPU | overscan | fling fps | frames > 20 ms | blank frames | long tasks | pinch fps |
|---|---|---|---|---|---|---|
| 1× | 4 / 12 / 30 | 60 | 0 | 0 | 0 | 60 |
| 4× | 4 | 57–58 | 3–4 of 91 | 0–2 | 0 | 57 |
| 4× | 12 (default) | 58 | 3 of 92 | 0–1 | 0 | 56 |
| 4× | 30 | 57–59 | 1–4 of 93 | 0 | 0 | 54 |
| 6× | 4 | 49–50 | 13–17 of 77 | 2–6 | 0–1 | 42 |
| 6× | 12 (default) | 45–48 | 18–22 of 74 | 0–6 | 0–1 | 39 |
| 6× | 30 | 45–53 | 10–21 of 78 | 0–5 | 0 | 44 |

Read: at 4× (a mid-range phone) momentum scrolling at 10k rows holds 57–59 fps with at most two blank frames per fling. At 6× (an old phone) it is about 50 fps. The worst gaps are single 33–50 ms frames, and long tasks fell from about 20 per fling to 0–1. Pinch is now the heaviest gesture, because every step changes the row height and so re-renders all rows. The known fix is to scale with a CSS transform during the pinch and re-layout once at the end.

How the two changes work:

- **Stepped window.** Outside editing, menus and the callout, the scroll position in React state moves in steps of half the overscan (6 rows with the default 12). The visible rows are always covered, and the other half of the overscan is slack for the compositor running ahead. Anything placed in viewport coordinates (editor, menu, callout, knob maths) reads the live `scrollTop`/`scrollLeft` instead. Selecting a cell that scrolls the grid reads the scroll position in the same pass, so `aria-activedescendant` never points at an unrendered row. The spike 6 "10,000 rows" test caught that regression.
- **Memoised rows.** Each row gets one selection signature string (selected column spans, active column, editing flag), so rows that stay in the window skip rendering.

Default overscan on touch is 12 rows (4 with a mouse).

**Not measured:** a real phone, real iOS momentum (WebKit's scroll events and compositor differ from Chromium's), and compositor checkerboarding. A main-thread rAF cannot see a frame the compositor drew with missing rows, and the "blank" count is only a proxy. The `Ten Thousand Rows` story has an on-screen frame meter for that check on a device (see the checklist).

## Pinch policy

Inside the grid, **pinch = grid zoom**. Outside it, page zoom is untouched: the viewport meta does not set `user-scalable=no`, and the page can still be zoomed from the toolbar area and with the OS text size.

Why:

- A page zoom inside the grid scales the sticky headers, the dock and the menus with it.
- It moves `position: fixed` against the visual viewport.
- It turns `visualViewport` into "zoom" instead of "keyboard".

Google Sheets and Numbers both zoom the grid itself. Zoom changes row height and column widths, and because all geometry comes from those two numbers, selection, handles, fill and hit testing follow for free. Accessibility: grid zoom up to 1.8× plus OS text size covers WCAG 1.4.4 for the grid. When the page *is* zoomed, the keyboard detection switches off (`visualViewport.scale > 1`) so the dock does not jump.

## Architecture impact

What touch did **not** need:

- a canvas grid or library
- custom scroll physics or JavaScript momentum
- a second hit-test path: touch, mouse and pen go through the same `hitTest(clientX, clientY)`
- a second editor: the formula bar was already one

What changed in the grid, all local:

1. **Scroll state is stepped, rows are memoised** (performance, above). This should be in the real grid from day one. It also suits the incremental engine from spike 4: a cell value change re-renders one row.
2. **Live scroll reads for anything in viewport coordinates** (`liveTop`/`liveLeft`), because state is no longer exact.
3. **A handles layer above the sticky row headers**, and header-attached knobs for whole rows and columns. A z-order detail, but it has to be planned: the selection overlay must stay *under* the sticky headers while knobs sit *over* them.
4. **Edge auto-scroll on `requestAnimationFrame`** with a keyboard-aware bottom edge, shared by mouse and touch.
5. **`visualViewport` as the source of the visible area** while editing. The edited cell, the dock, and the popovers' room and flip all derive from it.
6. **Zoom as a multiplier on widths and row height.** Stored widths stay unzoomed, and resize divides by zoom.
7. **Menu click guard** after a long-press (`ContextMenu.tsx`).

For the real build, the suite `dropdown-menu` must get the same long-press guard, and `popover.tsx` needs the flip-above-the-keyboard rule.

## Decision 5: recommendation — variant B

Variant A is enough to **edit**. It is not enough to **work with ranges**. With A you cannot select a block of cells by finger: no 3×4 copy, no clearing a block, no status-bar sum of a range, no two-cell series to fill from. You can only work with one cell or whole rows and columns.

B adds that with:

- **No new gesture conflicts.** A finger on a cell still always pans, and only the knobs drag. All B tests also pass the A rules: swipe pans, tap selects, long-press opens the menu.
- **About 150 lines** on top of A, plus the callout.
- **The model people already know** from Google Sheets, Numbers, Excel mobile and iOS text selection.

The cost is that fill moves from an always-visible handle into the callout/menu ("Fill", then drag), as in Excel for iPhone. On tablets one could later show both the fill handle and the knobs, because there is room. I did not build that; it is a v1.1 question.

So: **v1 = B** (tap, double-tap, long-press, range handles, callout with Fill), with **Move up/down/left/right** in the header menus instead of header dragging.

## Other choices I made (reversible)

- **Phone breakpoint**: a coarse pointer and either a width under 600 px or a visible height under 500 px. Landscape phones with the keyboard up count as phones.
- **The dock keeps a 41 px empty slot** where the bar was, so the grid does not jump when editing starts. On a short phone that space could be given back; open polish.
- **Long-press 500 ms, double-tap 350 ms, tap slop 8 px.** These are close to platform defaults. Tune them on devices.
- **The callout appears only after a knob drag (B)**, not on every tap, so a tap stays quiet.
- **Number columns still open a text keyboard.** `inputmode="decimal"` would be nicer for numbers, but it hides `=`, and switching keyboards mid-edit is unreliable on iOS. The symbol strip covers `=`.

## Not done or not verified

- **The iOS Simulator was not used.** Access to the simulator device was declined when I asked, so I did not retry. Real iOS behaviour is therefore unverified: the keyboard rising on double-tap (the gesture-focus rule), Safari's pinch suppression (`gesturestart`), real momentum and `visualViewport` with a real keyboard. WebKit in Playwright runs with an iPhone profile but has no real keyboard, momentum or pinch.
- **No real phone or tablet.** The Chromium measurements are emulation on a busy Mac.
- The keyboard is simulated in tests and screenshots: a shrunken `visualViewport` and a grey block.
- Android's `interactive-widget` viewport setting, Android Chrome's own long-press `contextmenu` timing, and iPad with a hardware keyboard or trackpad (that switches to a fine pointer) were not tried.
- No VoiceOver or TalkBack pass. The knobs are `aria-hidden`, and range selection for screen-reader users still goes through the menu and keyboard.
- Not built:
  - horizontal windowing (all columns render; fine for 4–10 columns, not for 30 on a phone)
  - freezing the first column, which phones would like
  - CSS-transform pinch
  - knob loupe/magnifier
  - drag-to-move rows by long-press-then-drag
  - selecting multiple separate ranges by touch
- Clipboard on iOS: menu Paste shows Safari's own "Paste" bubble, and paste from other apps needs it. Not verified.

## Checklist for a real iPhone and Android phone

Start Storybook so the phone can reach it (same Wi-Fi):

```bash
cd prototypes/ycsv && pnpm exec storybook dev -p 6027 --no-open --host 0.0.0.0
```

Open `http://<mac-ip>:6027/iframe.html?id=spike-7-touch--variant-a&viewMode=story` (and `--variant-b`, `--frozen-b`, `--ten-thousand-rows`). The A/B switch is in the top bar. Do each step on the iPhone (Safari) and on Android (Chrome):

1. Tap a cell → it is selected, **no keyboard** appears.
2. Swipe up and down hard → the grid flings with momentum, the selection does not change, and the page itself does not bounce or move.
3. Double-tap a cell → **the keyboard appears**. Phone: the bar with ✕/✓ and the symbol strip sits right on top of the keyboard, and the cell is still visible above it. Type, tap ✓ → saved, keyboard gone.
4. Double-tap a cell in the **last visible row** → after the keyboard opens, that row moves up above the bar.
5. Double-tap an empty cell, tap `=`, type `SU` → chips appear in the bar. Tap `SUM` → `=SUM(`. Tap another cell → its name is inserted. Tap `)` then ✓ → a number shows.
6. While editing, tap iOS "Done" (or Android back) → the edit is saved, not lost.
7. Long-press a cell → a menu opens *below* your finger. Lifting the finger does **not** pick an item.
8. Menu → Copy, long-press another cell → Paste → the value is copied. On iPhone, note whether Safari shows its own "Paste" bubble.
9. Copy a cell in Numbers / Google Sheets / Excel on the phone, then use the grid menu → Paste → does it arrive?
10. Variant A: drag the round fill handle down 3 rows → filled. Drag it to the bottom edge and **hold still** → it keeps scrolling and filling.
11. Variant B: tap a cell, drag the bottom-right blue knob → a range grows, and your finger does not hide the corner. Drag the top-left knob → the other corner stays. The callout appears; Copy works.
12. Variant B: callout → Fill → a square handle appears; drag it → filled.
13. Tap a column header → column selected. Tap it again → column menu with Move left/right. In B, the knobs sit on the header edges.
14. Frozen B: scroll → row 1 stays on top, also during a hard fling.
15. Pinch on the grid → the **grid** zooms, the page does not. Pinch on the top bar → the page zooms as normal. Reload → the grid zoom is remembered.
16. Ten Thousand Rows: fling hard several times → the meter (bottom right) shows fps and "blank". Note the numbers and whether you ever see empty white rows.
17. Rotate to landscape and double-tap → the phone layout (bar above the keyboard) is still used, and nothing is hidden behind the keyboard.

Report: per step OK / not OK, the phone model and OS version, and a screenshot of step 16.

## Files

- `src/ycsv-ux/touch.ts`: coarse pointer, `visualViewport` hook, edge speed, zoom helpers.
- `src/ycsv-ux/SheetGrid.tsx` / `.css`: variants, handles, dock, popover placement, pinch, stepped window, memoised rows.
- `src/ycsv-ux/ContextMenu.tsx`: long-press click guard.
- `src/stories/Touch.stories.tsx`, `touch-hud.tsx` (frame meter), `ux-seeds.ts` (seeds shared with spike 6).
- `e2e/8-touch.spec.ts`, `e2e/touch-helpers.ts`, `e2e/touch-perf.spec.ts`, `e2e/touch-shots.spec.ts`, `tests/touch.test.ts`.
- Screenshots: `docs/spike-7-touch/{iphone,ipad,android-phone}-*.png`. Variant A: `a-tap`, `a-long-press-menu`, `a-after-fill`. Variant B: `b-tap`, `b-range-callout`, `b-fill-mode`, `b-column`, `b-rows`, `b-dark`. Editing: `edit-autocomplete`, `edit-pick-ref`. Also `frozen-scrolled` and `pinch-zoomed-out` (Android).
