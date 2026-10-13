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
