# Spike 9 — moving rows and columns without losing concurrent edits

Branch `spike/sheets-rowmove`, cut from `spike/sheets-collab` (the spike 5 YCSV model). Spike only: nothing here goes to main as is.

## Question

The spike 5 model keeps rows in a `Y.Array` of row `Y.Map`s. Yjs has no array move, so moving a row (or a column) is delete + insert of a copy. An edit someone makes in the old copy at the same time lands in a deleted type and is gone. Which Yjs layout makes row and column moves safe under concurrency (single move, multi-row drag, sort), and what does it cost? This has to be settled before YCSV sidecars circulate, because changing it later means migrating every sidecar.

## Answer

**Use a separate order: a `Y.Array` of row ids, with the rows themselves in a `Y.Map` keyed by row id. Do the same for columns.** A move or a sort rewrites only the order. Cells are never deleted or copied, so no concurrent edit can be lost. In 1,000 randomized 4-peer fuzz runs (23,930 edits, 16,790 moves, 3,293 sorts) this layout lost **0 edits**, showed **0 duplicate rows or columns**, brought back **0 deleted rows** and lost **0 rows**. Today's layout lost **5,858 edits (24%)**, showed **16,527 duplicate rows** and brought back **2,999 deleted rows** in the same runs.

Concurrent moves of one row can leave the id twice in the order array. One read rule hides this, and it is a pure function of the converged state, so every peer resolves the same: the **first occurrence wins, and ids without row data are ignored** (so delete wins over move). A lazy `repair()` (for example on save) deletes the ignored entries. Two extra pieces close the intent gaps: an **undo guard** (drop an undo step whose moved row a peer has moved since) and **positional range rewrite on sort**.

The alternative, a **fractional position key per row** (a last-writer-wins `p` value in each row map), is just as safe. It has slightly cleaner conflict semantics: no duplicates, and undo never overrides a newer move. It loses on cost over time:

- Every sort rewrites one map value per row, and Yjs keeps a tombstone for each. **Five sorts grow the 50k-row sidecar by 20% (gzip 3,502 → 4,215 KiB). The order array does not grow at all (3,382 KiB after 1 and after 5 sorts).**
- Keys grow when rows are inserted one below the other in the middle of a sheet (1,000 such inserts → 204-character keys).
- Ties need a re-key, a row can lose its key, and it needs its own key library.

**Cost of the recommended layout versus today:** the same sidecar size (−2% v1, −4% gzip). Open is the same. A move costs 1–2.5 ms instead of 10–13 ms at 50k rows. **A sort costs 0.2–0.3 s instead of 21–23 s at 50k rows**: today's sort deletes and recreates every nested row map. The YCSV text format does not change at all. Migration is free now, because no sidecars exist yet. Later it would be a reseed from the canonical text with a bumped seed version.

## 1. Layouts compared

All three are in `src/ycsv-layout/`, behind one interface (`SheetLayout` in `types.ts`), so the same fuzz test, unit tests and benchmark run against each. Targets are ids, never indices: "move rows X, Y in front of row Z (or to the end)".

| | A. Baseline (today) | B. Order array + rows by id (**recommended**) | C. Fractional key per row |
|---|---|---|---|
| File | `baseline.ts` | `order-array.ts` | `frac-map.ts`, `frac-keys.ts` |
| Rows | `rows: Y.Array<Y.Map{rowId, cells: Y.Map}>` | `rowOrder: Y.Array<rowId>`, `rowData: Y.Map<rowId, Y.Map<colId, value>>` | `rowsById: Y.Map<rowId, Y.Map{p: key, c: Y.Map<colId, value>}>` |
| Columns | `columns: Y.Array<Y.Map{colId, ref}>` | `colOrder: Y.Array<colId>`, `colData: Y.Map<colId, Y.Map{ref,…}>` | `colsById: Y.Map<colId, Y.Map{p, ref,…}>` |
| Move | delete row map + insert a copy | delete id from order, insert at target | write `p` (one value per moved row) |
| Multi-row drag | copies inserted as one run | ids inserted as one run | a block of keys in a random sub-interval of the gap |
| Sort | delete all row maps, insert copies | delete the order, insert the sorted ids | write a fresh key on every row |
| Order on read | array order (duplicates visible) | first occurrence with data; orphans appended by id | sort by `(p, id)`, kept incrementally (`OrderIndex`) |

Cells were kept as a nested map in all three, so that only the order mechanism differs. Spike 5's layout findings (flat row map, short column ids, gzip) apply to B and C unchanged.

## 2. Concurrency: what each layout does

All rows are covered by tests in `tests/rowmove-semantics.test.ts`; the fuzz (§3) covers random combinations.

| Case | A. Baseline | B. Order array | C. Fractional key |
|---|---|---|---|
| Move + edit in the moved row | **edit lost** | edit kept, row at target | edit kept, row at target |
| Move + move, same row, different targets | **row twice** | once, at the earlier of the two targets (first occurrence) | once, at the last writer's target (map LWW) |
| Move + delete | **deleted row comes back** | deleted (order entry without data is ignored) | deleted |
| Move + insert elsewhere | both land | both land | both land |
| Insert anchored on a row that is moved at the same time | at the anchor's old place | at the anchor's old place | at the anchor's old place |
| Two multi-row drags into one gap | contiguous | contiguous (Yjs runs) | contiguous with probability 1 − 2⁻¹⁶ (random sub-interval) |
| Overlapping multi-row drags | duplicates | every row once, nothing lost | every row once, nothing lost |
| Sort while others edit | **every concurrent edit lost** | edits kept, order = the sort | edits kept, order = the sort |
| Sort + sort | **every row twice** | one whole sort wins | one whole sort wins (each sort writes *every* row, see §6) |
| Sort + insert | — | the new row lands after the sorted block (end) | the new row lands near its old position |
| Sort + move | — | the sort wins | per row last writer: the move may win and land by its old key |
| Column move + rename | **rename lost** (cells survive: they are keyed by column id) | both kept | both kept |
| Column move + move / move + delete | column twice / comes back empty | once / deleted | once / deleted |

**Intent notes.** In B, "first occurrence wins" means the higher of two concurrent targets wins. It is not arbitrary per peer, but it is not "last writer" either. Users will rarely see the difference; both movers see the row land at one of the places they chose. C's per-row last-writer-wins makes a sort racing a single move place that one row by a key from the old key space. That converges, but the row ends up somewhere that looks random.

**Duplicates and orphans, repaired deterministically.** Only B has them.

- A duplicate comes from two concurrent moves of one row, or from undo restoring an entry.
- An orphan entry (id without data) comes from a move racing a delete.
- Data without an entry is not produced by any operation; it is kept as a guard and appended at the end, sorted by id.

The read rule hides all three. `repair()` deletes the ignored entries. Two peers repairing at the same time delete the same Yjs items, which is idempotent, and the fuzz runs repair at random moments without divergence. A move deletes *all* entries of the moved id, so moving a row also cleans it up.

In C the equivalents are **ties** (two concurrent inserts into one gap get the same midpoint key; ordered by id; the next insert between them re-keys the tie deterministically) and **unplaced rows** (see undo below; sorted to the end by id; given a key by the next gap or `repair()`).

## 3. Fuzz test

`tests/rowmove-fuzz.test.ts`: 4 peers (3 with undo) start from one 8×4 sheet. 80 random operations go to random peers: cell edit, move 1–3 rows, insert, delete, sort, move column, rename column, insert or delete a column, undo, repair. Random one-way syncs in between make the operations concurrent in random shapes, then everything is synced. Each run asserts:

- **convergence:** every peer and a cold replica (a fresh doc from the merged state, which also checks C's incremental order index) show the same rows, columns, names and cells;
- **no lost edits:** a cell written once keeps that value; a cell written more than once has one of the written values (rows and columns that were deleted are skipped);
- no duplicates, no resurrected deletes, no vanished rows or columns;
- a column renamed once has that name.

The undo mode checks convergence and duplicates only, since undo legitimately removes writes.

`FUZZ_RUNS=1000` (the default is 300 for the normal test run):

| Layout | Diverged | Edits | Lost edits | Duplicate rows | Resurrected rows | Duplicate cols | Resurrected cols | Renames lost | Raw anomalies hidden by the read rule |
|---|---|---|---|---|---|---|---|---|---|
| A. baseline | 0 | 23,929 | **5,858** | **16,527** | **2,999** | **767** | **302** | **578** / 3,999 | — |
| A. baseline, no sorts | 0 | 23,941 | **4,483** | **4,822** | **2,111** | **798** | **303** | **618** / 3,986 | — |
| B. order array | 0 | 23,930 | 0 | 0 | 0 | 0 | 0 | 0 | 7,903 duplicate + 3,682 orphan entries |
| B. + repair + undo guard | 0 | 23,907 | 0 | 0 | 0 | 0 | 0 | 0 | 7,374 + 3,484 |
| C. fractional key | 0 | 23,930 | 0 | 0 | 0 | 0 | 0 | 0 | 1,598 tied/unplaced rows+cols |
| C. + repair | 0 | 23,907 | 0 | 0 | 0 | 0 | 0 | 0 | 1,602 |
| all, with per-user undo (500 runs each) | 0 | | | B, C: 0 | | B, C: 0 | | | |

The rates are those of a deliberately hot sheet (8 rows, 4 peers, many moves), not of real use. The point is that A loses edits in every shape tried and B/C in none. Yjs itself always converges (no layout diverged); what A gets wrong is intent.

The fuzz found two bugs in C, both fixed:

1. **Undo of a move could leave a row without a key.** Both movers of one row undo: each undo deletes its own `p` value, and Yjs restores the overwritten old value only if nobody overwrote it. Fix: a row without `p` sorts at the end by id (`UNPLACED = "~"`), and the next gap or `repair()` gives it a key.
2. **Sort + sort mixed** two sorts when a sort skipped rows whose key did not change. That was found by the targeted test. Fix: a sort writes every row, so the same peer wins every row.

## 4. Per-user undo of a move

`Y.UndoManager` over the layout's roots, `trackedOrigins = {"local"}`, as in spike 5.

| Case | B. Order array | C. Fractional key |
|---|---|---|
| Undo my move; a peer edited the row meanwhile | row back, peer's edit kept | row back, peer's edit kept |
| Undo my move after a peer moved the same row *later* | plain undo: **the row jumps back over the peer's newer move** (my restored entry comes first). With `guardedUndo`: the step is dropped and the peer's move stays | peer's move stays (map undo does not restore over a newer value) |
| Both movers of one row undo | row back at its original place (duplicate entry, hidden) | row is unplaced: sorted to the end, deterministic; `repair()` gives it a key |
| My move, move, undo, undo, redo | works (the guard follows Yjs' `redone` links) | works |

`guardedUndo` / `topUndoIsStaleMove` (`order-array.ts`) inspect the top undo step's inserted order entries. If one is deleted and has no live redone copy, someone else moved or deleted that row since, and the step is dropped instead of undone. That is the same rule Google Sheets follows when a step no longer applies. The fuzz with undo runs it without divergence.

## 5. Formulas: row-id refs and ranges after moves

Refs are stored by row id (spike 5): `=aantal@r_x*prijs@r_x`, `=SUM(totaal@r_a:totaal@r_d)`. The file form renders row numbers from the resolved order. Tests in `rowmove-semantics.test.ts` use the real formula engine, and both B and C give the same results:

- **A point ref follows its row.** Moving row 4 to the top turns `=ka4*2` into `=ka1*2` in the file, with the same value.
- **A range means "from row a to row b in the current order".** A row moved out leaves the range, and a row moved in joins it. Moving an endpoint row stretches the range to wherever it went (`SUM(ka1:ka4)` with row 4 moved to the bottom becomes `SUM(ka1:ka6)`). That is Excel's cut + insert semantics: references follow cut cells.
- **Sort must not use those semantics.** With id endpoints, sorting would leave a range covering whatever lies between wherever its two endpoint rows ended up. That is silently wrong (a total over a column would drop rows). Excel and Google Sheets keep a range's *positions* on sort ("sort moves values, not the frame"). So the sort, in the same transaction, rewrites every `X@a:Y@b` whose endpoints were at positions i and j to the rows now at i and j (`rewriteRangesForSort` in `common.ts`). Point refs keep following their row, which is better than Excel for a sheet with named rows ("the total for Kaas" stays on Kaas).
- **Known gap:** a range typed *concurrently* with someone's sort is not rewritten. Its endpoints follow their rows and the range can come out reversed (`SUM(ka6:ka1)`; the test documents it). The engine should normalise reversed ranges; a product decision could also refuse a sort while a peer's cell editor is open. Rare.

## 6. Size and speed

`tests/rowmove-bench.test.ts`, opt-in:

```bash
RUN_BENCH=1 pnpm exec vitest run tests/rowmove-bench.test.ts --pool=forks
```

It runs in Node on **spike 4's fixture** (`src/stories/scale-file.ts`, copied from `origin/spike/sheets-perf`): 10 columns, per-row formulas, a cross-row ref and two whole-column `SUM`s, in id form, with 13-character row and column ids.

Spike 4's harness drives Chromium through Storybook. Only its fixture was reused here, because the comparison is between layouts, not of the grid. The Node numbers line up with spike 4's Chromium numbers for today's layout: 10k×10 build 48–71 ms against 70–94 ms, `applyUpdate` 59–60 ms against 66–88 ms, v1 4.35 MB against 4.5 MB.

The machine: Apple M5 Pro, Node 26.8.2, **on battery**, shared with other sessions. Ranges cover two runs, at load averages 4.8 and 6–7 (`results/rowmove-bench-run1.jsonl`, `results/rowmove-bench.json`). A third run at load 28 is not used. Sizes are deterministic. "Edit" is a cell write by row id; "< 0.05" means below timer noise.

| rows | layout | Yjs v1 / v2 / gzip (KiB) | build | `applyUpdate` | resolve order | read all cells | edit | insert | move 1 row | move 100 rows | sort |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10k | A. baseline | 4,245 / 3,441 / 700 | 48–71 | 59–60 | 3.5–4.1 | 17 | < 0.05 | 0.8–2.4 | 0.9–1.3 | 6.4–7.4 | **1,474–1,743** |
| 10k | B. order array | 4,178 / 3,500 / 674 | 29–33 | 49–55 | 2.8–4.2 | 10–11 | < 0.05 | < 0.1 | 0.2 | 0.4 | 37–53 |
| 10k | C. fractional | 4,272 / 3,525 / 702 | 31–37 | 62 | 4.6–4.7 | 6–7 | < 0.05 | 0.1 | 0.1 | 0.5 | 51–54 |
| 50k | A. baseline | 21,288 / 17,203 / 3,497 | 173–221 | 276–291 | 19–22 | 111–114 | < 0.05 | 9–12 | 10–13 | 27 | **21,553–23,150** |
| 50k | B. order array | 20,948 / 17,496 / 3,364 | 145–183 | 268–279 | 18–19 | 59–68 | < 0.05 | 0.1–0.2 | 1.2–2.5 | 1.6–3.9 | 234–281 |
| 50k | C. fractional | 21,432 / 17,639 / 3,502 | 179–186 | 293–337 | 34–35 | 47–60 | < 0.05 | 0.4–0.5 | 0.6–0.7 | 3.4–3.9 | 385–435 |

(ms. The baseline's lookups use a row-id index rebuilt when the array changes, so they measure the layout, not a linear scan. The prototype's real `mutate.setCell` scans linearly: 6 ms at 50k in spike 4.)

**History growth (sidecar gzip, KiB):**

| rows | layout | seeded | after 1,000 single moves | after 1 sort | after 5 sorts |
|---|---|---|---|---|---|
| 10k | A | 700 | 732 | 772 | (not run) |
| 10k | B | 674 | 702 | 689 | **689** |
| 10k | C | 702 | 719 | 761 | **846 (+20%)** |
| 50k | A | 3,497 | 3,534 | 3,810 | (not run) |
| 50k | B | 3,364 | 3,401 | 3,382 | **3,382** |
| 50k | C | 3,502 | 3,523 | 3,783 | **4,215 (+20%)** |

Why: in B a sort deletes one run of order entries (Yjs merges the deleted run into a single struct and drops its content) and inserts one new run of ids, so repeated sorts cost nothing extra. In C every sort overwrites 50k map values, and each overwritten value leaves a tombstone struct in its own row map that cannot merge with its neighbours (about 10 bytes per row per sort). A's sort deletes 50k nested maps (550k items). Deleting alone takes ~6 s at 50k in Yjs, and delete + insert in one transaction took 71 s in an isolated check.

**Fractional key length (C):** seeded keys are 4 characters at 10k–50k rows. **1,000 rows inserted one below the other in the middle reach 204 characters** (about 1 bit per insert). A sort rewrites fresh keys (back to 4). A real build would also re-key a local run when a key passes a threshold. B has no keys.

**Open and edit** are the same across layouts (within ±15%). The size and edit numbers of spikes 4 and 5 stand for B.

## 7. Migration from the current layout

- **Now: free.** No YCSV sidecars exist outside spikes. Build B into `sheets-core` from the start.
- **Later, if needed:** a sidecar is not canonical; the `.ycsv` text is. Bump `YCSV_SEED_VERSION` and recognise the old roots (`rows`/`columns`) as "old layout". The first client then reseeds from the text into the new roots (deterministic, so two clients migrating at once produce the same bytes) and drops the old sidecar.
  - Cost: Yjs history and undo stacks are lost.
  - A peer still running the old code writes into roots nobody reads, so those edits are lost unless the migrator first merges them, which can be done by reading the old roots after a final sync. That needs a minimum client version gate on the collab room.
  - In-memory conversion of a 10k / 50k-row doc measured 44–49 / 237–259 ms.

## 8. What changes

**YCSV text format: nothing.** Rows and columns serialize in resolved order; ids, order arrays and keys stay in the sidecar, as row ids already do (`layoutToFile` in `view.ts` renders any layout; the serialized text is identical on every peer after a merge, tested). Range refs in the file stay positional (`totaal1:totaal5`).

**Yjs sidecar layout (the shape in spike 5's `ycsv-collab/shape.ts`):**

- roots `rowOrder` (Y.Array<string>) + `rowData` (Y.Map<rowId, Y.Map<colId, string>>) replace `rows`; `colOrder` + `colData` replace `columns`. The row's `rowId` field disappears (it is the key);
- `recognisesYcsv` / `isYcsvEmpty` read the new roots; the undo manager tracks all four plus `meta`/`raw`;
- the deterministic seed builds the same ids into both the order and the map; bump `YCSV_SEED_VERSION` to `2`;
- spike 5's other layout advice (short column ids, empty cells omitted, gzip the sidecar) applies unchanged.

**Model API:**

- every reader goes through one `rowOrder()` / `colOrder()` (dedupe + data check). Nothing reads the raw array;
- moves and sorts take ids;
- `repair()` runs lazily, for example by the client that saves;
- undo goes through `guardedUndo`;
- sort rewrites ranges positionally.

**Engine (spike 4):** structural changes arrive as order-array deltas. With possible duplicates the engine cannot map raw indices to rows 1:1, so it re-resolves the order on a structural change (18–19 ms at 50k) and diffs by id. Spike 4's engine already diffs row inserts and deletes by id.

## 9. Recommendation and trade-offs

1. **Adopt B for rows and columns** (one mechanism, one code path). Columns are cheap either way; using the same mechanism keeps one read rule and one undo guard.
2. **Read rule:** first occurrence with data wins; orphan data at the end by id. **Repair** lazily on save.
3. **Undo:** `guardedUndo`; a step whose moved row was moved or deleted by a peer since is dropped. Product decision: drop silently (proposed) or show "can't undo: Ann moved this row".
4. **Sort:** rewrites the order and, in the same transaction, the ranges positionally. Possible refinements, not built:
   - minimal-churn sort: keep the longest increasing subsequence in place, so rows a concurrent insert was anchored to stay put;
   - sort of a selected block of rows only.
5. **Moves:** endpoint rows carry ranges with them (Excel cut + insert semantics).

What B costs:

- a read-time dedupe pass (O(n), ~18 ms at 50k, on structural changes only);
- move + move resolves to the topmost target rather than the last writer;
- an insert anchored on a row that is being moved, or racing a sort, lands at the old place or at the end;
- the undo guard is code we own on top of Yjs internals (`Item.redone`, `iterateDeletedStructs`).

Why not C: the same safety, but per-sort tombstone growth (+20% sidecar after five sorts at 50k), key growth on sequential middle inserts, ties and unplaced rows to repair, a key library (`fractional-indexing` was added to the prototype only for this comparison), and an order index that has to be kept sorted.

## 10. Not verified

- **Not integrated:** `ycsv-model`, the grid, the collab shape and the spike 5 e2e still use today's layout. The layouts are standalone modules with their own tests. No browser, no real transport, no two-browser run.
- **Node, not Chromium;** shared machine on battery; two usable benchmark runs. Undo of a sort at 50k, and a sort's update size on the wire, were not measured.
- **Fuzz scope:**
  - small sheets (8 rows × 4 columns), 3–4 peers, 80 operations, plain string values;
  - formulas are not in the fuzz; refs and ranges are covered by targeted tests only;
  - no column sort, no partial-range sort, no paste of many rows.
- **Range rewrite on sort** handles `X@a:Y@b` in id form only; a range typed during a concurrent sort is not rewritten. Whole-column / open-ended ranges and cross-sheet refs do not exist yet.
- **Sort order** compares raw cell text (numbers numerically, blanks last), not evaluated formula values or locale collation.
- **C's block jitter** (16 halvings) and **tie re-key** were tested but not tuned. B was not tested with many thousands of accumulated duplicate entries (repair keeps them away).
- **Migration** of a live sidecar (old + new clients in one room) was not built.

## Files

- `src/ycsv-layout/`: `types.ts` (interface), `baseline.ts`, `order-array.ts` (+ undo guard), `frac-map.ts` + `frac-keys.ts`, `common.ts` (sort, range rewrite), `view.ts` (YCSV serialization for any layout).
- `tests/rowmove-harness.ts`, `tests/rowmove-fuzz.test.ts` (`FUZZ_RUNS`), `tests/rowmove-semantics.test.ts`, `tests/rowmove-bench.test.ts` (`RUN_BENCH=1`, `BENCH_SIZES`).
- `src/stories/scale-file.ts`: spike 4's fixture.
- `results/rowmove-bench.json`, `results/rowmove-bench-run1.jsonl`.

```bash
cd prototypes/ycsv && pnpm install --ignore-workspace && pnpm exec vitest run
FUZZ_RUNS=1000 pnpm exec vitest run tests/rowmove-fuzz.test.ts
RUN_BENCH=1 pnpm exec vitest run tests/rowmove-bench.test.ts --pool=forks
```

The 50k-row baseline sort blocks the vitest worker for ~20 s, which makes vitest print a harmless `Timeout calling "onTaskUpdate"`; the results are complete.
