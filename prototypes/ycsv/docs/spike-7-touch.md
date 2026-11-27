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

**Recommendation for decision 5: variant C (B plus hold-to-drag), but with a 250 ms hold instead of Calendar's 160 ms.** At 160 ms a finger that rests briefly before scrolling selects cells instead in every measured case. See "Variant C" and "Decision 5" below.

Branch `spike/sheets-touch`, cut from `spike/sheets-ux`. Nothing went to main and no PR was opened.

## How to run

```bash
cd prototypes/ycsv
pnpm install --ignore-workspace
pnpm exec storybook dev -p 6027 --no-open   # "Spike 7 / Touch": Variant A/B/C, C 250, Frozen A/B/C, Ten Thousand Rows (frame meter)
SB_PORT=6027 pnpm test:touch                 # 88 touch tests: Android phone + tablet (Chromium), iPhone + iPad (WebKit)
SB_PORT=6027 pnpm test:e2e                   # spike 6 suite (desktop Chromium + Pixel 7), still green
pnpm test                                    # vitest, 51 unit tests (2 new)
PERF=1 SB_PORT=6027 pnpm exec playwright test e2e/touch-perf.spec.ts --project=touch-perf
SHOTS=1 SB_PORT=6027 pnpm exec playwright test e2e/touch-shots.spec.ts --project=iphone --project=ipad --project=android-phone
HOLD=1 SB_PORT=6027 pnpm exec playwright test e2e/touch-hold.spec.ts --project=android-phone --workers=1   # variant C accident matrix (per project)
```

The A/B/C switch sits in the story's top bar, so all variants run on the same sheet. Variant A is also the spike 6 behaviour, made finger-ready.

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

## Variant C: hold-to-drag (Calendar parity)

Asked for after A and B: does Calendar's gesture work in the grid? Calendar (`TimeLine.ts` on main) arms a drag when a finger rests 160 ms within 10 px; more travel before that is a pan and the browser keeps it. Nothing is captured or prevented until the hold arms; after that a window `touchmove` blocker stops native scrolling.

### What C does (`touchVariant="c"`, on top of B)

| Finger | Cell | Row / column header | Column header edge (±12 px) |
| --- | --- | --- | --- |
| tap, double-tap | select, edit (as A/B) | select, menu on second tap | select |
| rest 160 ms, then move > 4 px | **range selection** from that cell, with edge auto-scroll; B's handles and callout after the lift | **move the row or column** (the selected block if the header is inside it), drop line as on desktop | **resize** the column (the whole selected set if it is inside one) |
| rest 160 ms, lift without moving | a tap | a tap | a tap |
| rest 500 ms without moving | context menu (as A/B) | header menu | header menu |
| move > 10 px within 160 ms | native pan with momentum | pan | pan |
| second finger before a drag starts | pinch zoom, nothing selected | pinch | pinch |

How the two timers coexist: the 160 ms hold only *arms*. While armed nothing has changed yet: a light outline appears under the finger (`c-armed` screenshots) and native panning is blocked. If the finger then moves more than 4 px, the drag starts, the menu timer is cancelled, and a short vibration marks the start (Android only; iOS has no Vibration API). If the finger stays still, the menu opens at 500 ms, as in A and B. A lift in between is a tap. I did not vibrate on arming: many ordinary taps last longer than 160 ms and should not buzz.

The B handles stay: a hold-drag makes the first range, the knobs adjust it afterwards. The header menus keep Move up/down/left/right, because moving by drag is not discoverable.

Code: about 150 lines in `SheetGrid.tsx` (`startHoldDrag`, `endHold`, the arm timer in the touch branch of `onPointerDown`, the `holdLock` check in the existing non-passive `touchmove` listener) and `.sx-armed` in the CSS. The architecture is unchanged: C turns a pending touch into the same `select` / `move` / `resize` drags the mouse uses. `holdMs` and `holdSlop` are props, so the stories and the measurement can vary them.

### Tests

8 new tests in `e2e/8-touch.spec.ts` on all four projects (88 touch runs: 80 passed, 8 Chromium-only skipped on WebKit):

- hold, then drag selects a range; handles and callout take over after the lift; a knob adjusts it
- a hold without movement is a tap; double-tap still edits (keyboard / dock)
- holding still opens the menu, and the armed outline is gone
- hold-drag a column header moves the column; a row header moves the row
- hold-drag the column header edge resizes the column
- Chromium (real touch): a quick swipe still pans and keeps the selection; a rested finger then drags *without* scrolling the page
- Chromium: a second finger after a 260 ms hold pinches the grid, selects nothing, and the page does not zoom

Two findings while writing them:

- **The B start knob overlaps row header 1.** Its 44 px hit box is centred on the cell corner, so 22 px of it lies over the row header, and a hold on row header 1 grabs the knob. Not new in C, but C makes the row header a drag source, so the product should clip the knob box to the cell side.
- **A finger that lands during momentum catches the fling and does not arm.** Chromium treats that touch as part of the scroll. That is the right behaviour; it means "stop the fling, then hold" takes a second touch.

### Accidental selection while scrolling (the main risk)

`e2e/touch-hold.spec.ts` plays scroll gestures a person could make: finger down, **still for a pause**, then straight up at a **constant speed**, then lift. 3 hold times × 2 slops × 4 pauses × 5 speeds × 2 repeats on all four projects (960 gestures). Chromium gets real touch input through CDP, so Chromium's own pan decision takes part. WebKit gets synthetic touch PointerEvents timed inside the page (our logic only). Raw rows: `docs/spike-7-touch/hold-results.json`.

Accidents (a selection instead of a pan) out of 8 (4 projects × 2 repeats). Speeds in px/s: 2000 is a flick, 300 a normal drag, 100 a slow drag, 50 and 25 careful nudging. The menu never fired by accident.

| hold / slop | pause | 2000 | 300 | 100 | 50 | 25 |
| --- | --- | --- | --- | --- | --- | --- |
| 160 ms / 10 px (Calendar) | 0 ms | 0 | 0 | 0 | **8** | **8** |
| 160 ms / 10 px (Calendar) | 80 ms | 0 | **3** | **8** | **8** | **8** |
| 160 ms / 10 px (Calendar) | 150 ms | **6** | **8** | **8** | **8** | **8** |
| 160 ms / 10 px (Calendar) | 250 ms | **8** | **8** | **8** | **8** | **8** |
| 160 ms / 4 px | 0 ms | 0 | 0 | 0 | 0 | **7** |
| 160 ms / 4 px | 80 ms | 0 | 0 | **4** | **8** | **8** |
| 160 ms / 4 px | 150 ms | **4** | **8** | **8** | **8** | **8** |
| 160 ms / 4 px | 250 ms | **8** | **8** | **8** | **8** | **8** |
| 250 ms / 10 px | 0 ms | 0 | 0 | 0 | **1** | **8** |
| 250 ms / 10 px | 80 ms | 0 | 0 | 0 | **8** | **8** |
| 250 ms / 10 px | 150 ms | 0 | 0 | **7** | **8** | **8** |
| 250 ms / 10 px | 250 ms | **8** | **8** | **8** | **8** | **8** |
| 250 ms / 4 px | 0 ms | 0 | 0 | 0 | 0 | 0 |
| 250 ms / 4 px | 80 ms | 0 | 0 | 0 | 0 | **6** |
| 250 ms / 4 px | 150 ms | 0 | 0 | 0 | **4** | **8** |
| 250 ms / 4 px | 250 ms | **8** | **8** | **8** | **8** | **8** |
| 350 ms / 10 px | 0 ms | 0 | 0 | 0 | 0 | **8** |
| 350 ms / 10 px | 80 ms | 0 | 0 | 0 | 0 | **8** |
| 350 ms / 10 px | 150 ms | 0 | 0 | 0 | **8** | **8** |
| 350 ms / 10 px | 250 ms | 0 | 0 | **8** | **8** | **8** |
| 350 ms / 4 px | 0 ms | 0 | 0 | 0 | 0 | 0 |
| 350 ms / 4 px | 80 ms | 0 | 0 | 0 | 0 | 0 |
| 350 ms / 4 px | 150 ms | 0 | 0 | 0 | 0 | 0 |
| 350 ms / 4 px | 250 ms | 0 | 0 | 0 | **4** | **8** |

The four projects agree within one gesture, so the result is about timing, not about the engine or the screen size. It follows one rule: **a scroll arms the hold when `pause + slop / speed ≥ hold`**, because the finger has not yet left the slop circle when the timer fires.

What that means at Calendar's 160 ms / 10 px:

- Any scroll that starts after the finger **rests 150 ms or more** selects cells instead, even a flick (6 of 8 at 150 ms, 8 of 8 at 250 ms).
- A slow drag (50 px/s or slower) selects even with no rest at all.
- Resting a moment before scrolling is a normal way to read a sheet. I could not measure how often people do it; that is the first item on the real-phone checklist.

What helps:

- **250 ms / 10 px**: with no rest only the slowest nudge arms; with an 80 ms rest, 50 px/s and slower; with a 150 ms rest, 100 px/s and slower. Normal drags and flicks are safe up to a 150 ms rest. An intended hold-drag waits 90 ms longer than in Calendar.
- **350 ms / 4 px**: almost nothing arms by accident (only a 250 ms rest plus nudging). But 4 px is tight for a resting finger: real fingers roll and drift a few pixels, and every drift past 4 px turns an intended hold into a pan. Emulation cannot measure that drift, so this needs a phone.
- A smaller slop alone (160 ms / 4 px) helps the slow-drag case but not the rest-then-scroll case.

How bad is an accident? On a cell, a range appears with the callout; a tap clears it; no data changes. On a header, a row or column **moves** if the finger keeps going, which changes the document (undo restores it). So header accidents matter more than cell accidents.

### Conflicts

- **Double-tap**: no conflict. Each tap of a double-tap lifts before moving, and an armed but still finger is a tap. Tested.
- **Pinch**: no conflict as long as the second finger lands before the first one has started a drag (a second pointer cancels the pending hold, and the pinch handler clears an armed hold). A second finger *after* a hold-drag started does not pinch: the drag already owns the gesture. The first case is tested.
- **Long-press menu**: coexists through the "arm, then decide" rule above. Tested.
- **Edge auto-scroll**: a header hold-drag near the screen edge scrolls the grid, as the desktop drag does (`c-column-move` shows the grid scrolled to the drop line, with the dragged column out of view; a floating label of the dragged column would help on a phone).

### Frame rate

Pixel 7 emulation, headless Chromium, 10k rows (`docs/spike-7-touch/perf-c-results.json`, machine load around 4):

| | 1× CPU | 4× CPU |
| --- | --- | --- |
| fling, B | 60 fps, 0 blank | 59–60 fps, 0 blank, worst frame 33 ms |
| fling, C | 60 fps, 0 blank | 59–60 fps, 0 blank, worst frame 33 ms |
| hold-drag range into the bottom edge, 2 s of edge auto-scroll, C | 60 fps, worst 17 ms | 60 fps, worst 17 ms |

C costs nothing while scrolling: the hold check is one boolean in a `touchmove` listener the grid already had for pinch.

### A shared hold helper in `src/lib` (proposal only)

Today every app decides on its own what a resting finger means. The numbers on main:

| Where | Hold for a drag | Hold for a menu | Travel that cancels |
| --- | --- | --- | --- |
| Calendar `TimeLine.ts` | 160 ms (move / create) | none | 10 px |
| Drive `use-drive-long-press.ts` | none | 450 ms | none in the hook (the caller cancels) |
| List rows `use-delegated-list-item-events.ts` | none | 450 ms | 8 px |
| Sheets spike (A/B) | none | 500 ms | 8 px |
| Sheets spike (C) | 160 ms (prop `holdMs`) | 500 ms | 10 px (prop `holdSlop`) |

The same finger on the same phone should not mean different things per app. Proposal: one small controller in `src/lib/touch/touch-hold.ts`, framework-free because Calendar is Lit and Sheets and Drive are React, plus a `useTouchHold` hook for React.

```ts
// dragMs: 250 if the real-phone check confirms the measurement above; Calendar would then move from 160 to 250.
export const TOUCH_HOLD = { dragMs: 250, menuMs: 450, slopPx: 10, dragPx: 4 } as const;

type TouchHoldEvents = {
  /** The hold armed: the finger now owns the gesture (native panning is blocked). */
  onArm?(at: { x: number; y: number }): void;
  /** Moved more than dragPx after arming: start the app's drag here. */
  onDragStart?(at: { x: number; y: number }, pointerId: number): void;
  /** Still at menuMs (and no drag started). */
  onMenu?(at: { x: number; y: number }): void;
  /** Lifted before anything armed or after arming without moving: a tap. */
  onTap?(at: { x: number; y: number }, heldMs: number): void;
};

/** Call from pointerdown with pointerType "touch". Returns a cancel function. */
export function beginTouchHold(e: PointerEvent, events: TouchHoldEvents, opts?: Partial<typeof TOUCH_HOLD> & { drag?: boolean; menu?: boolean }): () => void;
```

What it owns, so the apps stop repeating it:

- the pending state: window pointermove / pointerup / pointercancel listeners for that pointerId, the timers, and the travel check (`slopPx` before arming = a pan; the browser keeps it)
- a second finger cancels it (pinch wins)
- on arm: pointer capture and a window `touchmove` blocker (`passive: false`, `preventDefault` when `cancelable`), removed on lift or cancel; this is exactly what Calendar does today
- `navigator.vibrate` once when a drag starts or a menu opens, never on arm (a slightly long tap must not buzz)
- the "lift does not click the menu item under the finger" guard

What stays in the app: what a drag or a menu means (move an event, select cells, move a file), the drop feedback, and the arm visual.

Migration would be one app at a time. The open question is Calendar's 160 ms: the accident measurement above applies to its timeline as much as to the grid (a resting finger that then scrolls the day view starts a move or create there; not measured in Calendar itself). If the suite takes 250 ms, Calendar changes too, and that is a product call, not a refactor. I did not touch Calendar or Drive in this spike.

## Decision 5: recommendation — variant C with a 250 ms hold

*Updated after variant C. The original B reasoning follows below and still holds; C is B plus one gesture.*

- **C over B**, because sliding a finger over cells is what people try first to select a block, and dragging a header is how they expect to move a row or column (Numbers and Google Sheets do both). B can do both only through knobs and menus.
- **But not at Calendar's 160 ms.** At 160 ms, every scroll that starts after a short rest becomes a selection. **250 ms / 10 px** keeps normal scrolling safe up to a 150 ms rest and costs 90 ms on an intended drag.
- **Headers are the riskier half**, because an accidental header drag moves data. If the real-phone check shows header accidents, keep hold-drag on cells and drop it on headers (the Move items in the header menu stay).
- **The fallback is cheap.** C is B with the hold switched on; switching it off gives B. Try `VariantC250` / `FrozenC250` on a phone, next to `VariantC` / `FrozenC` (160 ms).
- **One suite number.** Whatever Sheets picks should become the suite's hold time through the shared helper above, which reopens Calendar's 160 ms.

### The original B reasoning

Variant A is enough to **edit**. It is not enough to **work with ranges**. With A you cannot select a block of cells by finger: no 3×4 copy, no clearing a block, no status-bar sum of a range, no two-cell series to fill from. You can only work with one cell or whole rows and columns.

B adds that with:

- **No new gesture conflicts.** A finger on a cell still always pans, and only the knobs drag. All B tests also pass the A rules: swipe pans, tap selects, long-press opens the menu.
- **About 150 lines** on top of A, plus the callout.
- **The model people already know** from Google Sheets, Numbers, Excel mobile and iOS text selection.

The cost is that fill moves from an always-visible handle into the callout/menu ("Fill", then drag), as in Excel for iPhone. On tablets one could later show both the fill handle and the knobs, because there is room. I did not build that; it is a v1.1 question.

So, before C: **v1 = B** (tap, double-tap, long-press, range handles, callout with Fill), with **Move up/down/left/right** in the header menus instead of header dragging. With C, header dragging comes in through the hold.

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
  - selecting multiple separate ranges by touch
- Variant C, not measured: how often real people rest before scrolling, and how far a resting finger drifts (which decides whether a 4 px slop is usable). Both need the real-phone check (steps 18–25). The accident risk in Calendar's own timeline was inferred from the same timing rule, not measured there.
- Variant C, not built: a floating label of the dragged row or column (on a phone the column can scroll out of view while it moves), and clipping the B start knob's hit box away from the row header.
- Clipboard on iOS: menu Paste shows Safari's own "Paste" bubble, and paste from other apps needs it. Not verified.

## Checklist for a real iPhone and Android phone

Start Storybook so the phone can reach it (same Wi-Fi):

```bash
cd prototypes/ycsv && pnpm exec storybook dev -p 6027 --no-open --host 0.0.0.0
```

Open `http://<mac-ip>:6027/iframe.html?id=spike-7-touch--variant-a&viewMode=story` (and `--variant-b`, `--frozen-b`, `--ten-thousand-rows`, `--variant-c`, `--variant-c-250`, `--frozen-c`, `--frozen-c-250`). The A/B/C switch is in the top bar. Do each step on the iPhone (Safari) and on Android (Chrome):

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

Variant C: do 18–25 on `--frozen-c` (160 ms) **and** on `--frozen-c-250` (250 ms).

18. **Read and scroll** for a minute as you would read a long sheet: put a finger down, look, then scroll, slowly and fast. Count how often a blue range appears instead of a scroll. This is the main question for C.
19. Put a finger on a cell, wait until the light outline appears, then slide → a range grows. Lift → knobs and the callout appear.
20. Hold a cell still → the outline appears, then the menu at about half a second; lifting does not pick an item.
21. Hold a column header, then slide sideways → the column moves to the blue line. Same for a row header, up or down. Note whether a row or column ever moved by accident in step 18.
22. Hold on the line between two column headers, then slide → the column gets wider or narrower.
23. Hold a cell, and while holding put a second finger down and pinch → the grid zooms, no range.
24. Double-tap still edits, a quick tap still only selects, and a flick still flings.
25. On a phone that vibrates (Android): one short buzz when a drag starts and when a menu opens, never on a plain tap.

Report: per step OK / not OK, the phone model and OS version, and a screenshot of step 16.

## Files

- `src/ycsv-ux/touch.ts`: coarse pointer, `visualViewport` hook, edge speed, zoom helpers, the variant C hold constants.
- `src/ycsv-ux/SheetGrid.tsx` / `.css`: variants, handles, dock, popover placement, pinch, stepped window, memoised rows.
- `src/ycsv-ux/ContextMenu.tsx`: long-press click guard.
- `src/stories/Touch.stories.tsx`, `touch-hud.tsx` (frame meter), `ux-seeds.ts` (seeds shared with spike 6).
- `e2e/8-touch.spec.ts`, `e2e/touch-helpers.ts`, `e2e/touch-perf.spec.ts`, `e2e/touch-shots.spec.ts`, `tests/touch.test.ts`.
- Variant C: `e2e/touch-hold.spec.ts` (accident matrix); results in `docs/spike-7-touch/hold-results.json` and `perf-c-results.json`.
- Screenshots: `docs/spike-7-touch/{iphone,ipad,android-phone}-*.png`. Variant A: `a-tap`, `a-long-press-menu`, `a-after-fill`. Variant B: `b-tap`, `b-range-callout`, `b-fill-mode`, `b-column`, `b-rows`, `b-dark`. Editing: `edit-autocomplete`, `edit-pick-ref`. Also `frozen-scrolled` and `pinch-zoomed-out` (Android). Variant C: `c-armed`, `c-hold-drag`, `c-after-lift`, `c-column-move`, `c-after-resize`.
