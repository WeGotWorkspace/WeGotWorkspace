# Spike 2 — resultaten

Omgeving: Chrome 153.0.0.0 (Headless), Linux 6.12.94+, Intel Xeon 4 vCPU @ 2.4 GHz, statische Storybook-build, StrictMode uit. Zelfde machine als spike 1c.

| Meting | 1c (= B, oude code) | A | B | C | D |
|---|---|---|---|---|---|
| M9 AST-cache | 2401 | 3 | 2401 | 2401 | 2401 |
| M1 fileToDoc | 101 ms | 19.1 ms | 14.7 ms | 15.4 ms | 12.6 ms |
| M8 serialize | 3.8 ms | 2.3 ms | 3.0 ms | 2.8 ms | 3.3 ms |
| M2 evaluateAll | 6.3 ms | 6.7 ms | 6.5 ms | 6.7 ms | 6.5 ms |

M2 is the median of 20 runs after 3 discarded. M8 is the median of 10. M1 is one `fileToDoc`. M3 and M10 ran only on variant A. M3 commit→paint median was 35.4 ms (p95 50.1 ms, max 50.4 ms). Spike 1c median was 39.4 ms.

`generaal` evaluated to 1270606.715 on all four files, the same finite value as spike 1.

## Normalisatie-controle

| | Verwacht | Uitkomst |
|---|---|---|
| `serialize(parse(C))` | `=== B` | ja, via `serialize(docToFile(fileToDoc(parse(C))))` |
| `serialize(parse(D))` | `=== B` | ja, via dezelfde model-write |
| `serialize(parse(A))` | `=== A` | ja |
| `serialize(parse(B))` | `=== B` | ja |

`parse` + `serialize` alone leaves C and D unchanged, because `serialize.ts` does not rewrite cell text. The normalization above is the write through `toIdForm` / `toFileForm`.

## M10 — schaalgedrag

Variant A, same procedure as spike 1c (23 runs, drop 3, median of 20).

| Rijen | Spike 1c | Nu |
|---|---|---|
| 300 | 1.3 ms | 1.6 ms |
| 600 | 2.8 ms | 3.2 ms |
| 1.200 | 6.0 ms | 6.6 ms |
| 2.400 | 14.2 ms | 14.4 ms |

Factors against the previous size: 1.97, 2.10, 2.18.

## Afwijkingen van het amendement

- Refs are case-sensitive, as decided for this spike.
- A cross-sheet ref without a row (`producten!totaal`) is `#SYNTAX`. `!` is not a formula token, so the scanner rejects it before evaluation.
- The ambiguity example `='q'12` with a three-row array is `=#REF!`, because row 12 does not exist. The test also has `='q'2` → `='q'@r_b`, and bare `=q12` still uses longest prefix → `=q1@r_b`.
- `astDeps` is cached on the formula string together with a sorted column-name key, and recomputed when that key changes. The column set did not change during these measurements, so nothing was invalidated.
- A ref that is not a bare identifier is stored in id form with quotes (`'Prijs €'@rowId`). A space in an unquoted id form cannot be scanned back. File form still quotes only when the emit rule requires it.
- The literal `serialize(parse(C)) === B` does not hold. Cell text is normalized on the model write, not inside `serialize`.

## Waarnemingen

M9(A) is 3: one AST for `=aantal*prijs`, one for `=totaal*(1-korting)`, one for `SUM(netto1:netto1200)`. M9(B), M9(C), and M9(D) are 2401. The shared-AST gate holds.

M2 is the same across A–D and matches the spike 1c figure for B (6.5 ms against 6.3 ms). Variant B did not get more expensive.

M8(B) 3.0 ms and M8(C) 2.8 ms are the same work after normalization. M8(A) is 2.3 ms. That is lower, and not an order of magnitude lower: writing the CSV still dominates.

The single browser sample for M1 has A at 19.1 ms and B at 14.7 ms, so A is not much faster on that one shot. Eight further `fileToDoc` runs in Node on this machine, median of the middle, were A 14.8 ms, B 16.5 ms, C 18.6 ms, D 15.3 ms. The gap is a few milliseconds. Building the Y.Doc is most of the ~15 ms. The bare path returns before any column scan; C, which does positional resolution, is the slowest of the four. The predicted direction is there. The old 101 ms is not.

M10 still doubles when the row count doubles. The `astDeps` cache was not a problem.
