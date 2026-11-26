# Spike 4 — Sheets at scale

Question: **can a Sheets app be, and stay, fast with reasonably large sheets?**

_Draft — tables follow when the matrix run finishes._

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
