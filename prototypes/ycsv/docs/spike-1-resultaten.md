# Spike 1 — resultaten

Omgeving: Chrome 153.0.0.0 (Headless), Linux 6.12.94+, Intel Xeon 4 vCPU @ 2.4 GHz, statische build, StrictMode uit
Dataset: 1.200 rijen × 9 kolommen, 108.0 KB

| Meting | Waarde | Drempel | Boven drempel? |
|---|---|---|---|
| M1 parse | 3.0 ms | — | — |
| M1 fileToDoc | 100.6 ms | — | — |
| M2 evaluateAll mediaan | 25.1 ms | 50 ms | nee |
| M2 evaluateAll p95 | 26.8 ms | 50 ms | nee |
| M3 commit→paint mediaan | 187.5 ms | 100 ms | ja |
| M3 commit→paint p95 | 256.0 ms | 100 ms | ja |
| M4 bytes/wijziging gem. | 36 B | 1 KB | nee |
| M4 bytes/wijziging max | 36 B | 1 KB | nee |
| M5 volledige state (vers) | 497.9 KB | 256 KB | ja |
| M5 volledige state (na 50) | 498.6 KB | 256 KB | ja |
| M6 heap na laden | 140.4 MB | — | — |
| M7 insertRow | 215.4 ms | 100 ms | ja |
| M7 deleteRow | 220.0 ms | 100 ms | ja |
| M8 serialize | 15.6 ms | — | — |

M2 max over the 20 kept runs was 29.9 ms. M8 output size was 108.1 KB. `generaal` on row 1 evaluated to the finite number 1270606.715.

## Waarnemingen

M3 is one Chrome CPU profile of the 50 `aantal` edits (sampling interval 100 µs, about 11.6 s of samples). Self time, after mapping the minified names back onto the bundle's function-name annotations:

1. `formatValue` — 6.49 s. The hottest instruction range is the currency / percent / number branch.
2. `evaluateAll` — 2.61 s. Samples sit in the loop that parses every formula and walks the raw map, including `SUM(netto1:netto1200)`.
3. `Grid` render — 0.27 s. Samples sit in the `<thead>` / `<tbody>` element creation.

`useSheet` / `useMemo` inclusive time around that profile was about 3.2 s, which covers `evaluateAll`. `formatValue` inclusive time is almost the same as its self time.

No single run exceeded 30 s. The 1,200-row sheet rendered (1,200 `<tr>` elements) and every measurement finished. The 300 / 600 / 900 fallback was not needed.

Graph construction is inside `evaluateAll` and was not timed separately.

`performance.memory.usedJSHeapSize` in the story iframe: 123.3 MB before `fileToDoc` on first mount (the JS bundle, including the fixture string, is already allocated), 140.4 MB after that load, 88.6 MB after M3. The drop after M3 means a collection ran between the two reads.

Each of the 50 document updates was 36 bytes. The encoded full state grew from 497.9 KB to 498.6 KB.

## Afwijkingen van de opdracht

- Measured on this Linux VM with Headless Chrome 153, not on a laptop on mains power. One fresh browser profile, one tab. `performance.memory` was enabled with `--enable-precise-memory-info`.
- Static files were served with `python3 -m http.server` from `storybook-static`. The build itself is `storybook build`.
- `React.StrictMode` is off via the Storybook framework option `strictMode: false`.
- `Grid` has a `useLayoutEffect` on `values` that follows the M3 snippet. It measures only when a `commit` mark exists. `src/react.d.ts` declares `useLayoutEffect` because this prototype has no `@types/react`.
- The esbuild `keepNames` flag was set on the Storybook build. The CPU profile still shows shortened names; the names above come from the `l(fn, "name")` annotations in that same bundle.
- M8 ran before M7. M7 deletes and inserts rows, and M8 is specified against the full sheet.
- Each M7 run restores the sheet to 1,200 rows before the next run. `insertRowAfter(599)` inserts after the 600th data row, and that new row is then deleted outside the sample. Each timed `deleteRow` removes the row at index 599; a blank row is inserted back outside the sample. From the second delete on, that row is the blank replacement.
- The performance story passes a local `Awareness` into `Grid` because the component requires that prop. Nothing calls `connect` or `BroadcastChannel`.

## 1b — Na formatter- en AST-cache

Same machine, same static Storybook build, StrictMode off, same `large.ycsv` (108.0 KB). M1, M4, M5, M6, and M8 were not repeated.

| Meting | Was | Nu | Drempel | Boven drempel? |
|---|---|---|---|---|
| M2 evaluateAll mediaan | 25.1 ms | 18.5 ms | 50 ms | nee |
| M2 evaluateAll p95 | 26.8 ms | 20.9 ms | 50 ms | nee |
| M3 commit→paint mediaan | 187.5 ms | 50.3 ms | 100 ms | nee |
| M3 commit→paint p95 | 256.0 ms | 67.2 ms | 100 ms | nee |
| M7 insertRow | 215.4 ms | 66.4 ms | 100 ms | nee |
| M7 deleteRow | 220.0 ms | 66.3 ms | 100 ms | nee |
| M9 formatter-cache | — | 3 entries, 0 missers tijdens M3 (3 totaal) | — | — |
| M9 AST-cache | — | 2401 entries, 0 missers tijdens M3 (2401 totaal) | — | — |

M2 max over the 20 kept runs was 22.2 ms (was 29.9 ms). M3 max over the 50 edits was 77.1 ms.

### Nieuw profiel

One Chrome CPU profile of the same 50 `aantal` edits (sampling interval 100 µs, about 4.1 s of samples). Self time, after mapping minified names through the bundle's `l(fn, "name")` annotations:

1. `evaluateAll` — 2.52 s. Of that, 2.31 s sits in the `cell` closure (`rowOrder.includes` plus the value-map read).
2. `Grid` render — 0.18 s. Samples sit in the `<tbody>` element creation.
3. `formatValue` — 0.16 s.

`astFor` is 2.3 ms in that profile. `fmt` is 20.6 ms. `dependencies` is 9.6 ms.

### Waarnemingen

`formatValue` dropped from 6.49 s to 0.16 s of self time and is no longer first. `evaluateAll` stayed near its previous 2.61 s and is now first. The Grid render stayed near its previous 0.27 s.

On this profile `evaluateAll` is the heaviest function. The assignment's rule for that outcome is incremental evaluation as the next decision. That is not built here.

M9 matches the formatter expectation: 3 entries (`currency|nl-NL|EUR`, `percent|`, `date|`) and no further misses after the first render. The AST cache holds 2401 entries, one per formula (1,200 `totaal`, 1,200 `netto`, one `generaal`). Misses during M3 are 0, not one per edit. The edited cells are `aantal` literals. The row-1 `totaal` formula string was identical before and after the 50 edits, so those lookups are hits. The key is the formula text; an `aantal` write does not change it.

`evalNode`, `dependencies`, and the parser only read AST fields. Nothing in `src/ycsv-formula` assigns to a node. Cached nodes are not mutated.

`dependencies` is a separate function, and it was not cached. A range's expanded row list depends on the current `rowOrder`, so the formula string is not a sufficient key. The walk still runs on every `evaluateAll`.

The AST cache did not reach 10,000 entries, so it was not cleared.

### Afwijkingen

- Same environment deviation as the first run: Headless Chrome 153 on this Linux VM, static files from `python3 -m http.server`.
- A parse error whose message is already a cell error (`#REF` as well as `#SYNTAX`) is cached as that error. The sketch cached every throw as `#SYNTAX`.
- Both caches count misses so M9 can be read. The counters are not part of the sketches.
- Meet runs M2, M3, M9, then M7 on the sheet the story already loaded. It does not call `fileToDoc` again, so the entry counts are the first render's caches. M1, M4, M5, M6, and M8 are unchanged from the first section.

## 1c — Na rij-index

Same machine, same static Storybook build, StrictMode off, same `large.ycsv`. M1, M4, M5, M6, and M9 were not repeated.

| Meting | 1b | Nu | Drempel | Boven drempel? |
|---|---|---|---|---|
| M2 evaluateAll mediaan | 18.5 ms | 6.3 ms | 50 ms | nee |
| M2 evaluateAll p95 | 20.9 ms | 7.8 ms | 50 ms | nee |
| M3 commit→paint mediaan | 50.3 ms | 39.4 ms | 100 ms | nee |
| M3 commit→paint p95 | 67.2 ms | 50.2 ms | 100 ms | nee |
| M7 insertRow | 66.4 ms | 56.8 ms | 100 ms | nee |
| M7 deleteRow | 66.3 ms | 58.0 ms | 100 ms | nee |
| M8 serialize | 15.6 ms | 3.8 ms | — | — |

M2 max over the 20 kept runs was 10.1 ms. M3 max over the 50 edits was 57.3 ms. M8 output size was 108.1 KB.

### M10 — schaalgedrag van evaluateAll

M2 procedure on each size: 23 runs, drop the first 3, median of the remaining 20. Same generator and seed as `large.ycsv`. The 1,200-row generator output matches that fixture byte for byte.

| Rijen | M2 mediaan | Factor t.o.v. vorige |
|---|---|---|
| 300 | 1.3 ms | — |
| 600 | 2.8 ms | 2.19 |
| 1.200 | 6.0 ms | 2.09 |
| 2.400 | 14.2 ms | 2.39 |

### Nieuw profiel

One Chrome CPU profile of the same 50 `aantal` edits (sampling interval 100 µs, about 2.0 s of samples). Self time:

1. `evaluateAll` — 0.24 s. Inside that function: building the per-cell items 0.12 s, the visit that evaluates the graph 0.09 s, the `cell` map read 0.03 s.
2. `Grid` render — 0.19 s, of which 0.17 s sits in the `<tbody>` element creation.
3. `formatValue` — 0.15 s.

The `cell` closure was 2.31 s in section 1b. It is now a `Map` read.

### Gevonden en vervangen lineaire lookups

Replaced with one index built for that call:

- `eval.ts` `rowsBetween`: `rowOrder.indexOf` for the range start and end.
- `graph.ts` `rangeRows`: the same `rowOrder.indexOf` pair. `rowOrder.slice` still returns the rows between those indexes.
- `graph.ts` `cell`: `rowOrder.includes(row)`.
- `refs.ts` `toFileForm`: `rowIds.indexOf(rowId)`. `docToFile` builds the index once and passes it in. Callers that omit it still use `indexOf`.
- `doc.ts` `fileToDoc`: `colInfos.indexOf(col)` while writing each cell. The loop index is used instead.

`toIdForm` does not scan `rowIds`. It takes the optional index and does not read it. Row numbers there are already `rowIds[n - 1]`.

Left in place, because they scan a string rather than a row or column array: `key.indexOf("@")`, `ident.includes("@")`, `ident.indexOf("@")`, `ident.includes(".")`, and the operator checks `"+-*/^%".includes` and `"+-*/^%=<>:,()".includes`.

### Waarnemingen

Every doubled row count multiplies `evaluateAll` by 2.19, then 2.09, then 2.39. A quadratic step would be about 4. The scaling is linear.

M2, M3, and M7 are under their thresholds. M8 has no threshold and dropped from 15.6 ms to 3.8 ms.

With linear scaling and the thresholds met, spike 1 is complete. These numbers do not call for virtualization or incremental evaluation.

### Afwijkingen

- Same environment as section 1b: Headless Chrome 153 on this Linux VM, static files from `python3 -m http.server`.
- M8 ran after the 50 edits and before M7, so serialize still sees 1,200 rows.
- M10 builds each size in its own `Y.Doc` through `buildLargeFile`. The mounted sheet stays the 1,200-row fixture.
- `toIdForm` accepts the row index and ignores it. Only `toFileForm` consults that map.
