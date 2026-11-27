# Spike 4 — Sheets at scale

Question: **can a Sheets app be, and stay, fast with reasonably large sheets?**


## Method

### Harness

One command, in `prototypes/ycsv`:

```bash
pnpm install --ignore-workspace
pnpm measure            # full matrix, 3 runs per configuration
pnpm measure --quick    # smoke run: 1k and 10k rows, 1 run
pnpm measure --help     # sizes / columns / variants / --no-build / --no-layouts / --no-worker
```

`scripts/measure.mjs` builds the Storybook statically (`storybook build`, production React,
`strictMode: false`), serves it from a local Node server, and opens the `Sheets/Scale` story in
headless Chromium through Playwright (`--enable-precise-memory-info`, `--js-flags=--expose-gc`).
Every run of every configuration gets a fresh browser context and page. The page calls
`window.__scale.run(config)` (`src/scale/harness.ts`) and returns raw samples. The runner writes
`results/scale-<timestamp>.{json,md}` and `results/latest.{json,md}`, with machine, CPU, Chromium
version, power source, and `uptime` (load averages) at the start and end of the whole run and
before/after each configuration (in the JSON).

Statistics: load-type numbers (one value per page) are the median over runs. Interaction numbers are
the samples of all runs pooled, reported as median / p95. With 3 runs the p95 of a load number is the
max. Each sampled step stops early after 3 samples once it has spent 15 s, so slow configurations
have fewer samples (the JSON has `n`).

### Fixture

`src/scale/generate.ts`, seeded, absolute notation (`aantal12`, as spike 2 variant B):

- **10 columns:** `product, categorie, aantal, prijs, korting, tarief, totaal, netto, btw, generaal`.
  Per-row formulas `totaal = aantal*prijs`, `netto = totaal*(1-korting)`; cross-ref
  `btw = netto*tarief1` (every row reads one cell in row 1); whole-column aggregates in
  `generaal`: row 1 `SUM(netto1:nettoN)`, row 2 `SUM(btw1:btwN)`. 3 formulas per row + 2.
- **30 columns:** the 10 above + 10 literal number columns `ma..mj` + 10 formula columns `fa..fj`
  that chain inside the row (`fa = ma*aantal`, `fb = fa+mb`, …, `fj = IF(fi>100,fi-100,0)`).
  13 formulas per row + 2.

### What is measured

| Name | What |
|---|---|
| parse | `parse(text)` of the serialized file |
| fileToDoc | building the Y.Doc from the parsed file (import path) |
| Yjs v1 / v2 | `encodeStateAsUpdate` / `…V2` byte length right after import |
| applyUpdate | loading that state into a fresh Y.Doc (the open path a client takes) |
| engine build | reading the doc into memory + dependency graph + first evaluation |
| evaluateAll | the current full recompute on the loaded model |
| open→paint | applyUpdate + engine build + React mount + first frame |
| heap | `usedJSHeapSize` after two forced GCs, with one Y.Doc, the engine and the mounted grid |
| edit typical | `aantal` in a row spread over the sheet → `totaal`, `netto`, `btw` and both aggregates change |
| edit worst | `tarief` in row 1 → every row's `btw` and the `btw` aggregate change |
| insert / delete row | insert after the middle row, then delete it again |
| paste 1,000 | one transaction writing 334 rows × 3 literal columns |
| scroll | 120 frames, 84 px (3 rows) per frame: fps, frames > 50 ms, long tasks |
| serialize | `serialize(docToFile(doc))`, which the save path sends next to the Yjs state |
| setCell / setCellAt | the mutation alone on a doc without observers: current `mutate.setCell` vs index-based |

`*→paint` ends in a `MessageChannel` task posted from the `requestAnimationFrame` after the grid's
layout effect, i.e. after the frame that shows the change. That makes 16.7 ms (one frame) the floor of
every interaction number; the "sync part" table has the sub-frame cost of the same interactions.

### Variants

| Variant | Grid | Model / evaluation |
|---|---|---|
| `baseline` | current `Grid` (a `<table>` with every row and cell) | `useSheet`: re-read the whole doc and `evaluateAll` on every change |
| `win-full` | `ScaleGrid`: row + column windowing | same full re-read + `evaluateAll` per change |
| `win-incr` | `ScaleGrid` | `SheetEngine` incremental: Yjs events → dirty propagation |

`baseline` runs up to 300k cells and `win-full` up to 1.5M cells (beyond that a single run takes
minutes per step without telling more).

### Environment of the numbers below

Final run `results/scale-2026-11-27T00-09-20.{json,md}` (= `results/latest.*`), Apple M5 Pro,
15 cores, 24 GB, macOS (darwin 25.6.0), on AC power, Chromium 158.0.8127.18 headless.
**The machine was shared with two other spikes.** `uptime` load averages were 14.4 / 9.3 / 11.0 at the
start, between 4.6 and 22.1 (1-minute) before individual configurations, and 4.1 / 8.4 / 9.8 at the end.
Absolute numbers will move on a rerun on an idle machine; ratios between variants, which ran
interleaved under the same load, are the more reliable reading.

Layout table: `results/layouts/` (a separate run, one page per layout; see §5). Run 1 (10-column
series only, before the fixes in §6) is kept as `results/run1-partial-before-fixes.*`; its load was
16–30. The 5k×30 rows at its end show `FAILED` because I stopped that run there.

## 1. Results — load and model (final run)

Median over 3 runs. ms unless noted. `win-incr` is the proposed architecture.

| rows×cols | variant | parse | fileToDoc | Yjs v1 | applyUpdate | engine build (read / graph / eval) | evaluateAll (med / p95) | open→paint | heap | DOM nodes | serialize (med / p95) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1k×10 | baseline | 3.7 | 10 | 449 KB | 8 | in render | 5.9 / 7.9 | 101 | 21 MB | 11,139 | 3.0 / 4.7 |
| 1k×10 | win-incr | 3.4 | 9 | 449 KB | 7 | 18 (2 / 7 / 8) | 5.0 / 7.1 | 34 | 15 MB | 423 | 2.3 / 3.7 |
| 5k×10 | baseline | 8.2 | 35 | 2.2 MB | 34 | in render | 52 / 56 | 382 | 65 MB | 55,139 | 13 / 15 |
| 5k×10 | win-incr | 8.4 | 36 | 2.2 MB | 35 | 72 (10 / 37 / 25) | 54 / 66 | 118 | 37 MB | 423 | 12 / 15 |
| 10k×10 | baseline | 12.9 | 70 | 4.5 MB | 66 | in render | 120 / 161 | 750 | 121 MB | 110,139 | 30 / 37 |
| 10k×10 | win-full | 19.7 | 94 | 4.5 MB | 88 | 237 (30 / – / 201) | 165 / 204 | 338 | 56 MB | 423 | 32 / 52 |
| 10k×10 | win-incr | 16.1 | 85 | 4.5 MB | 76 | 188 (27 / 93 / 70) | 177 / 208 | 276 | 64 MB | 423 | 34 / 67 |
| 25k×10 | baseline | 30.9 | 196 | 11.2 MB | 206 | in render | 383 / 690 | 2,110 | 290 MB | 275,139 | 74 / 206 |
| 25k×10 | win-incr | 36.3 | 225 | 11.2 MB | 270 | 662 (112 / 266 / 257) | 616 / 855 | 955 | 145 MB | 423 | 101 / 175 |
| 50k×10 | win-full | 60.2 | 326 | 22.5 MB | 329 | 1,048 (139 / – / 923) | 839 / 1,651 | 1,388 | 242 MB | 423 | 142 / 367 |
| 50k×10 | win-incr | 61.6 | 320 | 22.5 MB | 305 | 743 (107 / 365 / 278) | 716 / 1,180 | 1,054 | 288 MB | 423 | 140 / 291 |
| 100k×10 | win-incr | 121.5 | 820 | 44.9 MB | 1,011 | 2,951 (480 / 1,095 / 1,210) | 2,214 / 3,383 | 3,984 | 565 MB | 423 | 386 / 1,109 |
| 1k×30 | baseline | 5.8 | 37 | 1.3 MB | 19 | in render | 35 / 38 | 228 | 44 MB | 31,159 | 7.7 / 10 |
| 1k×30 | win-incr | 5.6 | 36 | 1.3 MB | 19 | 51 (5 / 29 / 17) | 37 / 44 | 81 | 27 MB | 483 | 8.0 / 10 |
| 5k×30 | baseline | 16.9 | 159 | 6.5 MB | 86 | in render | 228 / 393 | 1,137 | 180 MB | 155,159 | 44 / 68 |
| 5k×30 | win-incr | 17.3 | 169 | 6.5 MB | 84 | 257 (29 / 151 / 74) | 229 / 288 | 355 | 99 MB | 483 | 42 / 51 |
| 10k×30 | baseline | 31.5 | 309 | 13.0 MB | 172 | in render | 532 / 658 | 2,379 | 349 MB | 310,159 | 89 / 99 |
| 10k×30 | win-incr | 30.3 | 288 | 13.0 MB | 169 | 537 (56 / 298 / 180) | 498 / 522 | 719 | 188 MB | 483 | 83 / 92 |
| 25k×30 | win-incr | 86.1 | 699 | 32.6 MB | 426 | 1,898 (245 / 933 / 720) | 1,478 / 2,226 | 2,335 | 462 MB | 483 | 221 / 231 |
| 50k×30 | win-full | 141.0 | 1,480 | 65.1 MB | 943 | 4,286 (485 / – / 3,800) | 3,569 / 7,712 | 5,210 | 690 MB | 483 | 697 / 3,344 |
| 50k×30 | win-incr | 176.1 | 1,754 | 65.1 MB | 1,256 | 4,935 (806 / 2,240 / 1,889) | 3,695 / 6,420 | 6,264 | 914 MB | 483 | 564 / 1,010 |
| 100k×30 | win-incr | 356.8 | 2,812 | 131.4 MB | 1,707 | 8,127 (1,172 / 3,942 / 3,013) | 7,398 / 11,449 | 9,854 | 1,821 MB | 483 | 956 / 3,185 |

Every variant/size is in `results/latest.md`; rows omitted here repeat the pattern. Yjs v2 is
consistently ~72% of v1 (e.g. 10k×30: 9.5 MB vs 13.0 MB). Mount alone (React render + first frame)
of the windowed grid is 10–25 ms at every size; for `baseline` it is 93 ms (1k×10), 683 ms (10k×10),
1.9 s (25k×10), 2.2 s (10k×30).

## 2. Results — interaction (final run)

Edit→paint, median / p95, pooled over 3 runs (n = 90 typical edits, 30 worst-case edits, 15 pastes for
almost every row; slow `baseline`/`win-full` cells have fewer, see JSON). 16.7 ms = one frame (floor).

| rows×cols | variant | edit typical | edit worst (rate cell) | cells eval'd (worst) | insert row | delete row | paste 1,000 | scroll fps | long tasks while scrolling |
|---|---|---|---|---|---|---|---|---|---|
| 1k×10 | baseline | 21 / 24 | 27 / 32 | all | 29 / 32 | 29 / 32 | 27 / 34 | 60 | 0 |
| 1k×10 | win-incr | 17 / 18 | 17 / 18 | 1,002 | 17 / 18 | 17 / 19 | 16 / 19 | 60 | 0 |
| 5k×10 | baseline | 123 / 138 | 146 / 163 | all | 159 / 175 | 159 / 175 | 124 / 142 | 60 | 0 |
| 5k×10 | win-full | 60 / 67 | 59 / 67 | 50,000 | 60 / 68 | 59 / 69 | 67 / 75 | 60 | 0 |
| 5k×10 | win-incr | 17 / 19 | 17 / 18 | 5,002 | 17 / 19 | 17 / 18 | 17 / 19 | 60 | 0 |
| 10k×10 | baseline | 300 / 475 | 364 / 418 | all | 393 / 456 | 392 / 454 | 302 / 330 | 60 | 0 |
| 10k×10 | win-full | 199 / 254 | 201 / 246 | 100,000 | 201 / 254 | 208 / 264 | 213 / 288 | 60 | 0 |
| 10k×10 | win-incr | 17 / 18 | 18 / 37 | 10,002 | 17 / 18 | 17 / 18 | 18 / 43 | 60 | 0 |
| 25k×10 | baseline | 921 / 2,088 | 2,408 / 3,227 | all | 1,111 / 5,793 | 1,195 / 3,716 | 1,476 / 6,339 | 49 | 3 (187 ms) |
| 25k×10 | win-incr | 17 / 18 | 72 / 92 | 25,002 | 20 / 48 | 19 / 26 | 54 / 286 | 60 | 0 |
| 50k×10 | win-full | 947 / 1,751 | 1,004 / 1,686 | 500,000 | 916 / 1,650 | 915 / 1,656 | 941 / 2,346 | 60 | 0 |
| 50k×10 | win-incr | 17 / 19 | 78 / 127 | 50,002 | 31 / 52 | 33 / 51 | 68 / 669 | 60 | 0 |
| 100k×10 | win-full | 2,457 / 5,816 | 2,337 / 5,507 | 1,000,000 | 2,309 / 5,729 | 2,334 / 5,286 | 2,720 / 5,672 | 60 | 0 |
| 100k×10 | win-incr | 17 / 18 | 286 / 472 | 100,002 | 90 / 340 | 89 / 113 | 284 / 2,894 | 54 | 0 |
| 1k×30 | baseline | 71 / 87 | 83 / 97 | all | 93 / 103 | 93 / 104 | 79 / 82 | 60 | 0 |
| 1k×30 | win-full | 50 / 68 | 50 / 61 | 30,000 | 50 / 67 | 50 / 60 | 51 / 52 | 60 | 0 |
| 1k×30 | win-incr | 17 / 18 | 17 / 19 | 1,002 | 17 / 18 | 17 / 19 | 17 / 18 | 60 | 0 |
| 5k×30 | baseline | 441 / 1,182 | 506 / 1,720 | all | 589 / 1,676 | 616 / 1,478 | 815 / 1,561 | 57 | 1 (98 ms) |
| 5k×30 | win-incr | 17 / 19 | 17 / 18 | 5,002 | 17 / 18 | 17 / 18 | 17 / 18 | 60 | 0 |
| 10k×30 | baseline | 1,111 / 1,274 | 1,284 / 1,732 | all | 1,637 / 3,013 | 1,601 / 3,306 | 1,235 / 2,873 | 46 | 6 (526 ms) |
| 10k×30 | win-full | 552 / 934 | 592 / 978 | 300,000 | 518 / 765 | 526 / 770 | 517 / 587 | 60 | 0 |
| 10k×30 | win-incr | 17 / 18 | 18 / 37 | 10,002 | 17 / 18 | 17 / 18 | 18 / 25 | 60 | 0 |
| 25k×30 | win-incr | 17 / 18 | 52 / 84 | 25,002 | 18 / 37 | 18 / 23 | 46 / 73 | 60 | 0 |
| 50k×30 | win-full | 4,378 / 10,646 | 4,129 / 5,042 | 1,500,000 | 3,819 / 7,370 | 3,818 / 9,700 | 4,087 / 7,356 | 60 | 0 |
| 50k×30 | win-incr | 17 / 18 | 164 / 225 | 50,002 | 77 / 308 | 79 / 111 | 178 / 1,457 | 59 | 0 |
| 100k×30 | win-incr | 17 / 18 | 262 / 712 | 100,002 | 102 / 277 | 105 / 215 | 186 / 3,282 | 60 | 0 |

The typical edit re-evaluates 6 cells (10 columns) or 16 (30 columns) at every size, including the two
50k–100k-row `SUM` aggregates. Sync cost of that edit (mutation + Yjs + engine) is 0.1–2.1 ms median
up to 100k×30.

Mutation alone on a doc with no observers: current `mutate.setCell` (full snapshot + linear row scan)
0.2 ms at 1k, 6 ms at 50k×10, 19 ms at 100k×10; index-based `setCellAt` < 0.05 ms everywhere.

The paste p95 outliers (669 ms at 50k×10, 1.5–3.3 s at 50k–100k×30) sit on a median of 46–284 ms
and are one or two samples per configuration; GC on a 0.3–1.8 GB heap is the likely cause. Not
investigated further.

## 3. Virtualization

`src/scale/ScaleGrid.tsx`: fixed 28 px rows and 120 px columns, 8 rows / 2 columns overscan,
absolutely positioned cells in a sized scroller, sticky header, `contain: strict`. It renders 423 DOM
nodes at 10 columns and 483 at 30 columns at every row count (the baseline: 11k nodes per 1k×10 rows,
310k at 10k×30). Mount + first frame is 10–25 ms at every size up to 100k×30. Scrolling held
60 fps with zero long tasks in every windowed configuration; the lowest were 54 fps at 100k×10 and
58.5 fps at 50k×30 (one frame over 50 ms each); the baseline drops to 49 fps (25k×10) and 46 fps (10k×30) with long tasks.

**Windowing alone is not enough.** `win-full` (windowed, full recompute) still pays the whole
re-read + `evaluateAll` on every change: 199 ms per edit at 10k×10, 552 ms at 10k×30, 947 ms at
50k×10. It removes the React/DOM half of the cost (baseline 10k×10 is 300 ms), not the model half.

**Own windowing vs a library.** `packages/apps` depends on no virtualization library
(`@tanstack/react-virtual`, `react-window`, `react-virtuoso`: none). The suite already has its own
windowing (`packages/apps/src/workspace-list/src/workspace-list-window.ts` and `use-workspace-list-window.ts`,
`drive-core/src/drive-grid-rows.ts`). With fixed row heights a grid window is arithmetic;
`listRowOffsets` + `listWindowRange` from `workspace-list-window.ts` already cover variable row
heights. Recommendation: own windowing, reusing that module for rows and the same math for columns.
No library needed.

## 4. Incremental recompute and worker

`src/scale/engine.ts` (`SheetEngine`, mode `incremental`):

- Applies Yjs `observeDeep` events to an in-memory model (cell keys changed in `cells` maps; row
  inserts/deletes diffed by row id). Local and remote updates take the same path.
- Dependency graph: point edges (same-row refs, absolute refs) in both directions, plus per-column
  sets of range owners (a range is checked by index at change time, so inserts inside a range need no
  graph rewrite). Dirty set = transitive dependents; evaluation order = iterative DFS over dirty
  precedents (no recursion, cycles → `#CYCLE` like `evaluateAll`).
- Values column-major (`Map<ref, Value[]>` indexed by row), and `SUM/COUNT/MIN/MAX/AVERAGE` over one
  range as a plain loop when the range holds only numbers and blanks (falls back to formulajs otherwise).
- `tests/scale-engine.test.ts` checks that after edits, inserts, deletes (incl. a range end row),
  paste, a cycle and its repair, the incremental values equal a fresh `evaluateAll` (10 and 30 columns).

What mattered, measured in Node on 50k×10 (`tests/scale-profile*.test.ts`, contended machine):

| Engine at that step | propagate, typical edit (6 dirty cells) |
|---|---|
| values in a `Map` keyed `ref@rowId`, formulajs `SUM` | 33–35 ms |
| column-major values, formulajs `SUM` | 4–7 ms |
| column-major values + native aggregate loop | 0.7–1.7 ms |

The dirty set was right from the start (6 cells); the cost was the two 50k-row aggregates building
fresh `ref@rowId` strings and hashing them on every lookup.

**Worst case** (`tarief1` read by every row): re-evaluates `rows + 2` cells. On the main thread:
72 ms at 25k×10, 78 ms at 50k×10, 286 ms at 100k×10, 52 ms at 25k×30, 164 ms at 50k×30.
A running balance edited at the top is the same class of cost (all rows below are dirty):
50,001 cells in 217 ms in Node (`tests/scale-chain.test.ts`).

**Worker** (`src/scale/worker.ts`, `worker-client.ts`): the main thread keeps the Y.Doc and forwards
every update; the worker holds a replica + the incremental engine and answers with changed values.

| rows×cols | worker init (build) | main thread receiving all formula values | typical edit wall / main | worst edit wall / main |
|---|---|---|---|---|
| 10k×10 | 215 ms (191) | 2.8 ms (30k values) | 0.1 / 0.1 ms | 9.3 / 0.8 ms |
| 50k×10 | 1,118 ms (1,054) | 22 ms (150k values) | 0.3 / 0.1 ms | 82 / 4.1 ms |
| 50k×30 | 4,220 ms (4,035) | 79 ms (650k values) | 0.3 / 0.0 ms | 155 / 10.5 ms |

(Single run each; "main" = the synchronous mutation + posting + applying the delta.) The worst-case
edit at 50k×30 costs the main thread 10.5 ms instead of 164 ms; the result arrives 155 ms later. The
worker replica doubles Y.Doc memory (two copies) unless the worker owns the doc and the main thread
only renders — a design choice for the real build.

## 5. Limits and the Yjs layout

### Where each threshold breaks (final run, proposed `win-incr` architecture)

Interpolated between measured sizes; "≈" marks an interpolation.

| Threshold | 10 columns | 30 columns | In cells | Today (`baseline`) |
|---|---|---|---|---|
| **Yjs state 5 MiB** (v1, current layout) | ≈ 11,000 rows (10k = 4.5 MB) | ≈ 3,900 rows (1k = 1.3 MB) | ≈ 110k cells | same |
| Heap 300 MB | ≈ 50k rows (288 MB) | ≈ 16k rows (10k 188 MB, 25k 462 MB) | ≈ 500k | 25k×10 (290 MB), ≈ 9k×30 |
| Open→paint 1 s | ≈ 48k rows (25k 955 ms, 50k 1,054 ms) | ≈ 13k rows (10k 719 ms, 25k 2.3 s) | ≈ 400–500k | ≈ 13k×10, ≈ 4.4k×30 |
| Edit→paint 100 ms, typical | not reached at 100k | not reached at 100k | > 3M | ≈ 4k×10, ≈ 1.3k×30 |
| Edit→paint 100 ms, worst (all rows dirty) | ≈ 55k rows (50k 78 ms, 100k 286 ms) | ≈ 35k rows (25k 52 ms, 50k 164 ms) | ≈ 0.55–1M | same as typical |
| Insert/delete row 100 ms | ≈ 100k rows (90 ms) | ≈ 100k rows (102 ms) | ≈ 1–3M | ≈ 3k×10 |
| Paste 1,000 cells 100 ms (median) | ≈ 55k rows (50k 68 ms, 100k 284 ms) | ≈ 35k rows (25k 46 ms, 50k 178 ms) | ≈ 0.55–1M | ≈ 4k×10 |
| Serialize on save 100 ms (main thread) | ≈ 25k rows (25k 101 ms) | ≈ 12k rows (10k 83 ms, 25k 221 ms) | ≈ 250–360k | same |

**The binding limit is the Yjs size cap, by a factor of 4–5 before anything in the browser.**
With the proposed client the browser holds to roughly 400–500k cells on this machine (load and heap
go first); the server cap stops a sheet at ~110k cells.

### What the layout costs

`src/scale/layouts.ts` stores the same id-form cell strings in five Yjs structures. Separate run,
fresh page per layout: `results/layouts/scale-2026-11-27T00-59-14.md`. Heap = used heap after
`applyUpdate` minus before; the encoded state is freed between the two readings, so every heap number is
understated by roughly the v1 size (L5's small negative values are that effect).

| 10k×30, absolute refs | Yjs v1 | Yjs v2 | applyUpdate | heap (doc) | bytes/edit |
|---|---|---|---|---|---|
| L1 current: `Array<Map{rowId, cells: Map}>` | 13.0 MB | 9.5 MB | 159 ms | 54 MB | 35 |
| L2 one map per row `Map{_id, [colId]}` | 12.8 MB | 9.3 MB | 155 ms | 52 MB | 35 |
| L3 one cell map `"rowId\|colId"` + row order array | 15.1 MB | 14.3 MB | 237 ms | 51 MB | 35 |
| L4 = L2 + 4-char column ids, empty cells omitted | 9.9 MB | 6.9 MB | 143 ms | 50 MB | 33 |
| L5 columnar `Array<string>` per column (**unsafe**, below) | 5.7 MB | 5.7 MB | 40 ms | ~0 | 43 |

Same with `current` notation (same-row refs stored bare, `=aantal*prijs`, instead of
`=aantal@r_x*prijs@r_x`): L1 9.9 MB / 6.4 MB v2, **L4 7.1 MB / 3.8 MB v2**, L5 2.6 MB.

At 10k×10: L1 4.5 MB (v2 3.2 MB), L4 3.2 MB (v2 2.2 MB), L4 + current + v2 1.6 MB. At 50k×10:
L1 22.5 MB, L4 16.0 MB (v2 10.9 MB).

Reading:

- A Y.Map entry per cell is the cost floor of every LWW-per-cell layout: L1, L2 and L3 are within
  ~16% of each other. Dropping the nested `cells` map (L2) saves ~1–4%.
- What does move the size: **shorter keys** (column ids are stored once per cell: 12 → 4 chars and
  omitting empty cells is −23 to −29%), **same-row refs without row ids** (−14 to −24%; absolute refs
  embed a 12-char row id per reference), and **Yjs v2 encoding** (−28 to −46%). Together (L4 +
  current + v2) 10k×30 goes from 13.0 MB to 3.8 MB: **3.4× more rows under the same cap**
  (≈ 3,900 → ≈ 13,000 rows at 30 columns, ≈ 11k → ≈ 32k rows at 10 columns).
- L5 (a `Y.Array<string>` per column) is 2–4× smaller again and loads 4× faster, because Yjs
  merges a pushed run of values into one item. It is not safe for collaboration as is: a cell edit is
  delete+insert, so two people editing the same cell both insert, and the column shifts by one
  against the others. Mentioned as the floor, not as an option.
- Edits do not grow the state much: +1,000 edits added ~15 KB in every Map-based layout (35 B per
  update on the wire, deleted items are kept as compact tombstones).
- heap(doc) is ~180–240 bytes per cell for every Map-based layout (54 MB / 300k cells, 23.6 MB / 100k,
  both understated as said); the layout choice does not change client memory much — the item count does.

## 6. Bugs found in the existing prototype code

| Where | Problem | Evidence | Fixed here? |
|---|---|---|---|
| `ycsv-model/doc.ts` `fileToDoc` | `rows.push([map])` per row inside one transaction is quadratic in Yjs | run 1: 12 s at 25k×10, 56 s at 50k, 143–201 s at 100k; probe: 20k rows 2.6 s per-row vs 97 ms batched | yes: one push; final run 100k×10 820 ms |
| `ycsv-formula/graph.ts` `evaluateAll` | recursive `visit` overflows the stack when each row reads the row below (bottom-up chain) | `Maximum call stack size exceeded` from 5,000 rows (`tests/scale-chain.test.ts`); top-down chains are fine | engine has its own iterative pass; `evaluateAll` unchanged |
| `ycsv-formula/graph.ts` AST cache | keyed by formula text, cleared at 10,000 entries; with absolute refs every cell's text is unique, so from ≈3,400 rows × 3 formulas every `evaluateAll` re-parses every formula | probe: 0 misses per pass at 3k rows, 12,002 at 4k (all) | engine keeps a per-cell parse; cache unchanged |
| `ycsv-model/mutate.ts` `setCell`, `deleteRow` | snapshot of every row id + linear scan per call | 6 ms at 50k, 19 ms at 100k per edit, before any recompute | `setCellAt` / `deleteRowAt` (index-based) in the spike |

## 7. Conclusions

1. **Yes, with three changes, a Sheets app on YCSV stays fast well beyond what the server lets a
   sheet grow to.** Windowed grid + incremental engine: a typical edit paints in one frame at every
   measured size up to 100k×30 (3M cells), scrolling holds 60 fps, insert/delete stays under 100 ms to
   ~1M cells and a 1,000-cell paste to ~0.55M. The current prototype (full DOM + full recompute) crosses 100 ms per
   edit at ~4k×10 and ~1.3k×30.
2. **The first wall is the 5 MiB Yjs cap**: ≈ 11k rows at 10 columns, ≈ 3,900 rows at 30 columns
   (≈ 110k cells) with the current layout. Everything client-side is fine there. Compacting the model
   (short ids, bare same-row refs, v2) moves it ~3.4×, to ≈ 13k×30 / ≈ 32k×10.
3. **Client walls after that** (this machine, contended): open→paint 1 s and heap 300 MB both near
   400–500k cells; worst-case "every row depends on this cell" edits cross 100 ms near 0.55–1M cells;
   the client-side `serialize` on every save crosses 100 ms at ≈ 250–360k cells.
4. Windowing alone does not fix edits; incremental alone would not fix load/scroll of the baseline
   table. Both are needed. Of the incremental work, **data layout** (column-major values, no string
   keys on hot paths) was worth more than the graph itself.

## 8. Recommendations

- **Virtualization: yes, own windowing**, rows + columns, reusing `workspace-list-window.ts`
  (prefix sums for variable row heights). No library.
- **Incremental recompute: yes, from the first version.** Dependency graph with point edges +
  per-column range owners, iterative evaluation (no recursion), column-major value store, native
  aggregate loops. Drop `evaluateAll`'s recursion and text-keyed AST cache from the real engine.
  Next cost to remove: graph build at load (365 ms at 50k×10, 2.2 s at 50k×30) — use integer cell
  ids instead of `ref@rowId` strings for edges, and share parsed formulas by shape.
- **Worker: yes for evaluation, decide the ownership model.** It turns the worst-case edit at
  50k×30 from 164 ms main-thread into 10.5 ms, for little code (the engine is DOM-free). Either the
  worker owns the Y.Doc (one copy; main thread renders values and sends intents), or it keeps a replica
  (two copies of the doc in memory). Also move `serialize(docToFile())` for the save off the main
  thread or make it incremental.
- **Model changes (before the format is fixed):** short column ids (≤ 4 chars), omit empty cells,
  store same-row refs bare (the `current` notation: also shares one AST per column formula), and
  persist Yjs v2 if the server path allows it. Keep the Y.Map-per-row layout; flattening it (L2) or
  one big cell map (L3) is not worth a migration. Index-based mutations in `mutate.ts`.
- **Product limit:** state a supported size in cells, not rows. With the model changes, ~400k cells
  is where both the server cap and this client run out at about the same time.

## 9. Open questions

- The real limit is the server's `MAX_YJS_BYTES`. Raise it, compact the model (above), or split big
  sheets into several Yjs documents (subdocs per row block, loaded on demand)? Spike 3 found the save
  path linear to the 5 MiB cap; it did not test beyond.
- Numbers on an idle machine and on a slower laptop / mobile device: this was an M5 Pro under
  load avg 5–22. The orchestrator rerun covers the first.
- Does a reload after many sessions of edits stay small? Measured: +15 KB per 1,000 edits. Not
  measured: thousands of row inserts/deletes (array tombstones), and undo history.
- Variable row heights / wrapped text, frozen columns, and selection rendering in the windowed grid
  are out of scope here (spike d).
- The paste p95 outliers (0.7–3.3 s at ≥ 50k rows) are unexplained beyond "likely GC".
- `headless` Chromium's frame clock: interaction numbers floor at 16.7 ms; scroll FPS is the rAF
  rate in headless mode, not a measured compositor frame rate.

## 10. Rerunning

```bash
cd prototypes/ycsv
pnpm install --ignore-workspace
pnpm measure            # ≈ 50 min on this machine: matrix (3 runs), layouts, worker
```

Writes `results/scale-<timestamp>.{json,md}` and `results/latest.{json,md}`. The layout section in
the final run's `latest.md` predates the one-page-per-layout fix (its heap column is not usable); a
rerun produces the corrected table in the same file.

Correctness tests: `pnpm test` (engine vs `evaluateAll`, chain depth). Profiles:
`SCALE_PROFILE=1 pnpm vitest run tests/scale-profile2.test.ts`; Node probes in `scripts/probe/`
(run with `vite-node`).
