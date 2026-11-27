# Spike 10: Yjs state growth and compaction (Sheets and Docs)

Branch `spike/yjs-growth` (cut from `spike/sheets-rowmove`, spike 9). Nothing
here goes to main. Prototype code: `prototypes/ycsv/src/yjs-growth/`, tests in
`prototypes/ycsv/tests/yjs-growth-*.test.ts`, the real-editor Docs run in
`packages/apps/src/text-editor-core/docs-collab/spike-yjs-growth.test.ts`,
raw numbers in `prototypes/ycsv/results/growth-*.json`.

## TL;DR

1. **Growth is linear in edits and never goes down.** A living Docs document
   edited 60 times a workday reaches ~2 MiB of Yjs state (v1) after a year of
   workdays, about **8× its text**. At that pace it hits the 5 MiB sidecar cap
   after roughly two and a half years of workdays; a document four times as
   busy hits it within the first year. Sheets differ: there the *live*
   state is most of the sidecar (history adds 1.5–1.8×), and a sheet that
   grows to ~10k rows passes 5 MiB of live state on its own — **no
   compaction can keep a big sheet under 5 MiB**; the Sheets cap must be
   larger or the storage chunked.
2. **The cap is not the first problem; the save model is.** Every save sends
   the *whole* state. A year-old living doc sends ~2.2 MiB per save, and
   typing saves every 2–3 s. The actual change per save is ~160 bytes if
   taken from the edits' own `update` events — but a "diff since the
   server's state vector" is not small: Yjs puts the doc's **whole delete
   set** in every diff (2.6 KiB per save at workday 63, 6.1 KiB at 126,
   growing). Fix the save model (incremental updates) before tuning caps.
3. **Yjs cannot compact itself in a way that is safe for offline peers.**
   Tombstones are what late updates attach to; `gc` already drops deleted
   *content*, and what's left (item headers, delete sets, client ids) is
   needed. `mergeUpdates`, snapshots and `diffUpdate` don't shrink history.
4. **Compaction by epoch rebuild works and loses nothing in fuzzing**:
   rebuild the doc from its content into fresh items, tag it with a new epoch
   id, keep the previous epoch's final state on the server, and have
   old-epoch peers *rebase* their unsynced edits onto the new epoch. 1,000
   seeded runs per shape (4 peers, one offline for long stretches, ~4,200
   compactions and ~4,850 rebases with real offline edits per shape):
   **0 lost or duplicated edits** for Sheets and Docs. Rebuilding shrinks a
   year-old Docs sidecar ~2.7× (v1) and ~10× (v2+gzip).
5. **Docs rebase must replay by Yjs identity, not by content diff.** A
   content-diff replay lost or duplicated text in 909 of 1,000 runs.
6. **Recommended save model:** append-only incremental updates (v2), the
   server stores them opaquely and folds nothing; the client that opens a
   document alone folds the log into a new base (same epoch) or compacts
   (new epoch) past a threshold. Caps become per-request (small) plus a soft
   per-document cap that triggers compaction, not a hard wall.

## 0. Method

- **Deterministic, seeded simulations** (mulberry32). Every Yjs client id is
  drawn from the seed; a new id per session (page load), like the browser.
- **Sheets** uses spike 9's order-array layout (`rowOrder`/`rowData`/
  `colOrder`/`colData`). Action mix `SHEET_MIX`: retype, typo fix, formulas,
  insert/delete rows, row moves, sorts, paste blocks, clear ranges, column
  ops. `LOG_MIX` is append-heavy (a log or tracker that grows).
  Users: 4 (one of them offline for days, syncing on Thursdays), sessions
  interleaved in chunks of 5 actions, online peers pull/push via a server doc.
- **Docs** in two flavours:
  - the **real editor** (TipTap + `@tiptap/extension-collaboration` /
    y-tiptap + the app's own markdown extensions and track-changes marks, in
    jsdom) driven by ProseMirror transactions from one seeded script. Used
    for all Docs *growth* numbers, because y-prosemirror writes more than a
    hand-written model (at day 21: 189 KB real vs 113 KB raw for the same
    script).
  - a **raw-Yjs model** of the same shape (`default` XmlFragment, marks as
    XmlText format attributes, `comments` map with whole thread JSON per
    write). Used for multi-user runs, compaction and fuzzing.
  - Mix `DOC_MIX` (living doc): typing 27, backspace 8, delete range 8,
    rewrite a sentence 8, formatting 10, block type 2, split 3, join 3, new
    block 6, delete blocks 3, paste 1, comment 6, reply 6, resolve 4,
    suggestion 3. `NOTES_MIX` is append-heavy.
- **Sizes** per checkpoint: `encodeStateAsUpdate` v1 and v2, gzip (level 6)
  of each, the text, and the same four for a compacted rebuild. `gc: true`
  (Yjs default, also what the app uses) everywhere.
- A workday is 60 (Docs) or 120–300 (Sheets) actions; a year is 252
  workdays. These are guesses at "normal use", not measurements of users.

## 1. How fast does it grow?

### 1.1 Docs (real editor, single writer per session, new client id per session)

`living-doc`: 60 blocks, 60 actions a workday.

| workday | text KiB | v1 KiB | v2 KiB | v1+gz KiB | v2+gz KiB | compacted v1 | compacted v2+gz | rebuilt from text (v1) | comments map (v1) | clients | deleted items | live items |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 16 | 17 | 17 | 6 | 5 | 17 | 5 | 18 | 0 | 1 | 0 | 189 |
| 63 | 79 | 513 | 472 | 179 | 150 | 207 | 61 | 101 | 113 | 138 | 6,319 | 3,077 |
| 126 | 123 | 976 | 898 | 350 | 287 | 358 | 103 | 159 | 210 | 269 | 13,006 | 5,007 |
| 189 | 175 | 1,462 | 1,344 | 528 | 430 | 530 | 152 | 229 | 318 | 399 | 19,549 | 7,368 |
| 252 | 251 | 1,956 | 1,798 | 710 | 575 | 718 | 204 | 322 | 418 | 522 | 26,045 | 10,120 |

`notes` (append-heavy, 20 blocks to start):

| workday | text KiB | v1 KiB | v2+gz KiB | compacted v1 | compacted v2+gz | comments map | clients |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 63 | 138 | 524 | 149 | 246 | 69 | 83 | 116 |
| 126 | 275 | 1,048 | 301 | 495 | 137 | 168 | 236 |
| 252 | 555 | 2,098 | 604 | 991 | 272 | 329 | 503 |

Reading it:

- **Linear**: ~7.7 KiB v1 per workday (≈0.13 KiB per action), both profiles.
  Sidecar/text ≈ 8× (living doc), ≈ 4× (notes, where most of it is still
  live text).
- **Where it goes:** after a year 72 % of the living doc's items are
  tombstones (26k deleted vs 10k live). `gc` drops their content but keeps a
  header per item (client, clock, origin left/right, parent), the delete set
  and one entry per client id in the state vector (522 sessions).
- **Comment threads are the largest part of what survives compaction**
  (418 of 718 KiB). Each reply/resolve rewrites the whole thread JSON into
  the `comments` map; resolved threads stay forever. That is a product
  decision (§5), not a Yjs problem.
- **v2+gzip** is 3.4× smaller than v1 on a grown doc; on a fresh rebuild
  it's 3.5×. v2 alone saves only ~8 %; the win is gzip.
- **"Rebuilt from text"** (seed the doc from markdown, as the outside-write
  path does) is smaller still, but loses comment threads, suggestion
  metadata and all ids; it's not a compaction (§2).

**Several users vs one.** Raw model, same script volume: 4 users (one
offline, syncing weekly) 866 KiB v1 after a year, one user 863 KiB. Growth
follows edits and sessions, not concurrency.

**When does it hit 5 MiB?** At 60 actions a workday: ~650 workdays (v1, the
format saved today). At 240 actions a workday (a busy shared doc; the run
itself ran out of a 4 GB jsdom heap, so this is linear extrapolation from
living-doc): ~165 workdays. The 2 MiB markdown cap is hit much later for a
living doc (text grows ~1 KiB a day), sooner for notes.

### 1.2 Sheets (order-array layout, 4 users, one offline)

Columns: workday, rows, YCSV text, sidecar v1, sidecar v2+gz, compacted
v1, compacted v2+gz (KiB). Two profiles, 252 workdays:

`tracker`: 500×8 to start, `SHEET_MIX`, 120 actions a workday.

| workday | rows | text | v1 | v2+gz | compacted v1 | compacted v2+gz |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 500 | 44 | 146 | 28 | 162 | 28 |
| 63 | 1,036 | 92 | 573 | 151 | 299 | 62 |
| 126 | 1,728 | 283 | 1,307 | 325 | 804 | 149 |
| 189 | 2,253 | 478 | 2,147 | 516 | 1,313 | 234 |
| 252 | 2,834 | 564 | 2,832 | 640 | 1,542 | 274 |

`log`: 1,000×10 to start, `LOG_MIX` (append-heavy), 200 actions a workday.

| workday | rows | text | v1 | v2+gz | compacted v1 | compacted v2+gz |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1,000 | 123 | 367 | 67 | 407 | 67 |
| 63 | 5,618 | 547 | 2,542 | 509 | 1,640 | 317 |
| 126 | 9,972 | 1,371 | 5,721 | 1,069 | 3,670 | 674 |
| 189 | 14,291 | 2,679 | 10,371 | 1,884 | 6,655 | 1,141 |
| 252 | 18,600 | 4,487 | 16,023 | 2,595 | 10,525 | 1,755 |

- History adds 1.8× (tracker) and 1.5× (log) on top of the live state: much
  less than Docs, because cell edits are cheap (below).
- The **live** order-array state is 2.3–2.7× the YCSV text (a Y.Map per row
  with a 13-char id, keys per cell, item headers). Compacted day 0 is ~10 %
  *bigger* than the original seed: the epoch's hashed client id is a 5-byte
  varint in every parent/origin reference. A small client id would fix that,
  but the hash keeps rebuilds deterministic and collision-free; kept.
- **5 MiB**: the tracker passes it around the second year; the log sheet
  passes it (v1) around workday 115, and its compacted state around
  workday 175 (~15k rows). v2+gz stays under 2 MiB for a year even for the
  log sheet. If Sheets keeps the 2 MiB text cap, the log sheet hits that
  near workday 170.
- 775 client ids after a year (one per session). Each costs a state vector
  entry and a few bytes per struct run; it is part of what compaction drops.
- A 10k×10 start profile was planned but too slow for the sim at 300
  actions a day; the log profile passes 10k rows and covers that size.

**Bytes per action** (1,000×10 sheet, one action type at a time, 246
actions; `live` = change of the compacted size, `history` = growth of what
compaction removes):

| action | v1 / action | v2+gz / action | live | history |
|---|---:|---:|---:|---:|
| retype a cell | 7.7 | 8.7 | −0.2 | 7.9 |
| typo fix | 19.9 | 12.7 | 0.8 | 19.1 |
| formula | 17.1 | 9.5 | 8.5 | 8.5 |
| insert row | 274 | 59 | 265 | 9.8 |
| delete row | −341 | −50 | −417 | 75 |
| move rows | 22 | 11 | 0 | 22 |
| sort (1,000 rows) | 11 | — | 0 | 11 |
| paste block | 737 | 149 | 507 | 230 |
| clear range | −18 | −9 | −197 | 179 |
| column op | −370 | −134 | −1,113 | 744 |

(v2+gz per action is noisy: gzip of the whole state per checkpoint.)

- Cell edits in the order-array layout are cheap: a retype costs ~8 bytes of
  history because `gc` drops the old value and the Y.Map key reuses its
  slot; only the tombstone header stays.
- **Sorts and moves are cheap** with the order array (spike 9's reason to
  pick it): ~11–22 bytes per action of history.
- Deleting rows/columns or clearing ranges is where history piles up: the
  live state shrinks, the tombstones stay.
- So a sheet that is mostly *edited* stays near its live size; a sheet that
  is repeatedly *cleared and refilled* (import → clear → import) grows like
  a doc.

## 2. How to compact safely

### 2.1 Why Yjs-native compaction doesn't do it

| Yjs tool | What it does | Why it's not compaction |
|---|---|---|
| `gc: true` (default) | Drops content of deleted items, merges adjacent tombstones into `GC` structs | Already on. What remains (item ids, delete set, client ids) is exactly what later updates refer to. |
| `encodeStateAsUpdate(doc)` | Whole state, no undo history | That *is* today's sidecar. No history to strip: the size **is** the CRDT state. |
| `mergeUpdates` / `diffUpdate` | Merge or diff update binaries without a Y.Doc | Lossless by design; the merge of all updates is the same bytes as the state. |
| Snapshots (`gc: false`) | Version a doc by state vector + delete set | Need `gc: false`, i.e. a *bigger* doc. Good for history, useless for size. |
| v2 encoding | Column-wise encoding | ~8 % smaller; plus gzip 3.4×. Worth doing, but it's encoding, not compaction. |

The only way to drop tombstones is to **start a new document** with the
same content. Every replica that still holds the old document then holds
items the new one has never heard of; merging the two shows the content
twice (`yjs-growth-compaction.test.ts`: "epochs never meet" — a merged
sheet has 20 rows instead of 10, a merged doc two copies of the text).
So compaction is a protocol problem: the new document must never meet the
old one, and edits made against the old one must be carried over.

### 2.2 Options compared

| | (a) Epoch rebuild + rebase (recommended) | (b) Yjs-native only | (c) Rebuild from text (today's outside-write path) |
|---|---|---|---|
| Size after | live content only (2.7× smaller v1, ~10× v2+gz, year-old doc) | unchanged | smallest, but |
| Keeps comment threads, suggestions, row/col ids | yes (built from doc content with its ids) | yes | **no** — YCSV has no row/col ids, markdown has no threads |
| Offline peer with unsynced edits | rebases: replays its edits onto the new epoch; fuzz 0 losses | n/a | loses them or shows the conflict dialog |
| Online peers during compaction | next save gets `409 epoch_changed` → rebase (usually nothing to replay), swap doc | n/a | same as (a) |
| Per-user undo | undo stack cleared at the switch | n/a | cleared |
| Server | stores epoch id (string) + previous final sidecar; still Yjs-blind | nothing | nothing |

### 2.3 The protocol (implemented in `src/yjs-growth/epoch.ts`)

1. **Epoch id** = hash(parent epoch | state vector it compacted). Stored in
   the doc (root map `collab-epoch`: `{id, parent}`) so an IndexedDB copy
   knows which epoch it is, and sent with every save (header). Genesis =
   `e0`, so existing sidecars need no migration.
2. **Deterministic rebuild.** The compacting client snapshots the content
   (shape-specific, with its own ids: row/col ids, block structure + marks,
   comment threads) and writes it into a fresh Y.Doc whose client id is
   `hash32("epoch|<shape>|<epoch>")`. Same input → same bytes, so any peer
   can rebuild the base of an epoch on its own from the archived final
   state, and its replayed ops will reference the same item ids as
   everyone else's base.
3. **Server** (`EpochServer`, Yjs-blind): saves carry the epoch id; a save
   for another epoch gets `409 epoch_changed` and is not stored. A
   compaction is a save with `compactFrom=<epoch>` and the sidecar etag it
   read (If-Match); the previous sidecar moves to an **archive** keyed by
   its epoch id. Retention: last N epochs or N days (§5).
4. **Rebase** an old-epoch replica (`rebase()`):
   - nothing unseen (state vector *and* delete set ⊆ archive) → just load
     the new epoch. Deletion-only edits don't move the state vector; the
     fuzz found that (deleted text came back) — hence the delete-set check.
   - else merge local into the archived final state (`merged`), snapshot,
     rebuild the new epoch's base locally (guard: its client id must be in
     the server's state vector, otherwise refuse), and **replay**
     `merged − archived` as ordinary operations on that base, then send
     only what the replay added. These ops reference base items only, so
     they merge with everything that happened since the compaction.
5. **Replay per shape:**
   - **Sheets** (`replaySheet`): by row/column id — column deletes,
     inserts/renames, column moves, row deletes, row moves (back to front,
     anchored on the next common row), row inserts (anchored on successor),
     then cell diffs. Works because spike 9 gave rows and columns ids.
   - **Docs** (`replayDocs`): by **Yjs identity**, not by content. `merged`
     and `archived` share item ids, so blocks are matched by element item
     id, text by character item id (inserts keyed by their base anchor
     offset, deletes = base characters gone from `merged`), then formatting
     and block attributes are synced, and the comments map is diffed by
     canonical JSON. The content-diff version (prefix/suffix + LCS of
     blocks) lost or duplicated text in **909 of 1,000** fuzz runs; identity
     replay in **0**.
6. **Clients after the switch:** drop the undo stack (it references
   old-epoch items), replace the IndexedDB copy (it carries the epoch in
   `collab-epoch`, so a stale tab that wakes up refuses to merge), and drop
   awareness state from the old doc.

### 2.4 Who compacts, and when

- **The client that opens a document and is alone on it** (no other
  awareness peers on the relay), when the loaded state is over a soft
  threshold (proposal: state > 4× text and > 256 KiB, or > 1 MiB). Alone
  means no online peer has to rebase mid-typing; it is not required for
  safety (online peers rebase like offline ones; the fuzz compacts while
  others are online).
- Not the server: it would need to parse Yjs (core value: server stays
  Yjs-blind; also PHP has no maintained Yjs).
- Two clients compacting at once: the second gets a conflict (If-Match),
  reloads and rebases. Deterministic ids mean even a lost race produces the
  same epoch bytes.

### 2.5 Hard cases

| Case | What happens | Verified |
|---|---|---|
| Offline peer for days, edits, reconnects after one or more compactions | `409 epoch_changed` → fetch archive of its epoch → rebase → save in new epoch. Chained if several compactions happened (`catchUp` in the fuzz). | fuzz, 1,000 runs × 2 shapes, 0 losses |
| Offline peer whose epoch's archive expired | cannot rebase safely → today's conflict path (download local copy / pick version). Needs retention policy (§5). | design only |
| Online peers while someone compacts | their next save/relay message is refused; rebase finds little or nothing; swap doc; undo cleared | fuzz (compaction at random points, peers online) |
| Peer that only deleted | delete-set check in `hasUnseen` | unit test + fuzz |
| Deterministic results | placeholder client id while applying the replay (Yjs otherwise picks a random new id when its own id arrives from outside) | unit test, fuzz reproducible by seed |
| Per-user undo | cleared on switch | design only |
| IndexedDB copy | `collab-epoch` in the doc; on load, compare with server epoch before merging | design only |
| Relay (live mesh) | frames must carry the epoch; receiver drops foreign-epoch frames before `applyUpdate` | design only |
| Outside write (WebDAV PUT of the text) | unchanged: the server already detects text ↔ sidecar mismatch (#1349) and the client rebuilds from text. That rebuild should *become* an epoch switch (new epoch id) instead of the salted seed written into the same doc, so old replicas rebase instead of merging duplicate seeds. | design only |

## 3. Do the caps make sense?

### 3.1 What a save costs today

- `saveDocument` PUTs the framed body: whole text + whole v1 state, every
  2–3 s while typing (SAVE_DELAY_MS 2 s, SAVE_MAX_WAIT_MS 3 s → up to ~20
  saves a minute per open editor).
- Year-old living doc: ~2.2 MiB per save. Twenty a minute is ~45 MiB a
  minute up for one typist, to change a few hundred bytes. Year-old tracker
  sheet: ~3.4 MiB per save (text + state); the log sheet ~20 MiB, which is
  already over the caps.
- **An incremental save is only small if built from events.**
  `tests/yjs-growth-delta.test.ts` (raw Docs model, a save every 5
  actions): `encodeStateAsUpdate(doc, serverSV)` averaged 2,581 bytes per
  save at workday 63 and 6,119 at 126 (it always carries the whole delete
  set); `mergeUpdates` of the `update` events since the last save averaged
  164 and 157 bytes. In the multi-user sims the state-vector diffs averaged
  8.7 KiB (Docs) and 28 KiB (tracker sheet) per save over the year.
- Shared hosting bans an IP above ~60 requests a minute (traffic budget
  Epic); three open editors on one office IP already reach that with today's
  save cadence, independent of size.

### 3.2 PHP cost (`scripts/php-save-cost.php`, real `FramedPayload`)

| body | peak memory added | parse time |
|---|---:|---:|
| framed PUT, 0.25 MiB text + 1 MiB state | +3.8 MiB | 2.2 ms |
| framed PUT, 2 MiB + 5 MiB (today's caps) | +21 MiB | 14 ms |
| framed PUT, 4 MiB + 20 MiB | +72 MiB | 44 ms |
| Notes PATCH, JSON `number[]`, 1 MiB state (3.6 MiB body) | +17 MiB | 45 ms |
| Notes PATCH, JSON `number[]`, 5 MiB state (17.9 MiB body) | **+133 MiB** | 244 ms |

- The framed PUT is fine at 5 MiB: ~4× the body in memory, fast.
- **The Notes JSON `number[]` path is not**: a 5 MiB state becomes an
  18 MiB body and >128 MiB of PHP memory (the CLI default `memory_limit`;
  many shared hosts use 128–256 MiB). It fails before the 5 MiB cap is
  reached. Move it to the framed binary body (or base64 at worst, 1.33×).
- `post_max_size` / `client_max_body_size` 32 MiB (docker, .htaccess,
  INSTALL) is above all caps; but `post_max_size` doesn't apply to a raw
  PUT body read via `php://input` in all SAPIs — not verified here.

### 3.3 Recommended limits and save model

1. **Incremental saves (append log).** The client sends only the update
   since the last acknowledged save, built from the doc's own `update`
   events (`mergeUpdatesV2` of what happened since; not
   `encodeStateAsUpdate(doc, sv)`, which carries the whole delete set), with the epoch id and the base etag. The server
   appends it opaquely (`doc_yjs_updates(doc, epoch, seq, bytes)`) and
   returns the new sequence. Loading = base + log. No Yjs on the server.
   - Per-request cap: small (proposal **256 KiB** compressed; a paste or
     import larger than that goes as chunks, the Drive way:
     `drive-upload-chunked.ts`).
   - The text file is still written on each save for WebDAV/outside readers
     (or debounced longer than the Yjs log; the sidecar is the source of
     truth for collab).
2. **Folding** (same epoch): when the log is long (proposal: > 200 entries
   or log > base), a client that loaded base + log saves the merged state
   as a new base with If-Match on the last sequence it folded. Lossless,
   no rebase needed (same items), server stays blind.
3. **Compaction** (new epoch, §2): when the folded base is over the soft
   threshold. Rare.
4. **Caps per shape** (soft = compact, hard = refuse):
   | shape | soft (triggers compaction) | hard |
   |---|---|---|
   | Docs | 1 MiB v1 or 4× text | 8 MiB stored base (v2+gz) |
   | Sheets | v1 > 2× the last compacted size | 16 MiB stored base (v2+gz); a 10k-row sheet's *live* state is ~4 MiB v1, ~0.7 MiB v2+gz |
   | Notes / text fields | 256 KiB | 2 MiB, and only via the binary body |
5. **v2 + gzip for storage and wire** (3–4× smaller). Browser:
   `CompressionStream('gzip')`. Server stores bytes as is.
6. **Save cadence** independent of the cap: with incremental saves and the
   relay carrying live updates, saving every 10–15 s while typing (and on
   blur/unload) is enough and keeps an office within the 60 req/min budget.

## 4. What the fuzz checks

`tests/yjs-growth-fuzz.test.ts` (FUZZ_RUNS default 150; 1,000 run for this
report): 4 peers, 120 steps, each step a peer edits, saves (today's model),
goes offline/online, or compacts (p = 0.06, only after a save, only by an
online peer). Every edit writes a unique marker; at the end all peers sync
and the test checks every marker that was not deleted is present exactly
once, deleted ones are gone, row order has no duplicates, no deleted row
came back.

| harness | runs | compactions | rebases | rebases that replayed edits | problems |
|---|---:|---:|---:|---:|---:|
| Sheets (order array) | 1,000 | 4,169 | 12,507 | 4,851 | **0** |
| Docs (raw y-tiptap shape, identity replay) | 1,000 | 4,220 | 12,660 | 4,876 | **0** |
| Docs, content-diff replay (rejected) | 1,000 | — | — | — | 909 runs, 19,664 problems |

## 5. Product decisions raised

1. **Resolved comment threads**: keep in the doc forever, or move them out
   (thread store, Tasks-like) after resolve? They are the largest part of a
   compacted living doc.
2. **Undo across a compaction** is lost. Acceptable if compaction only
   runs at open-when-alone (no undo stack yet).
3. **Archive retention**: how long can a device be offline and still get
   its edits rebased? Proposal: keep the last 3 archived epochs and at
   least 30 days; past that, the conflict dialog.
4. **Who may compact**: any editor (proposal) vs owner only.
5. **Version history** (if ever wanted) can't come from Yjs snapshots with
   `gc` on; epochs' archived states could double as coarse versions.

## 6. Not verified

- Identity replay against the **real** y-tiptap shape with nested nodes
  (lists, tables, images); the raw model has flat blocks. Split/join/
  block-type changes are in the growth script but **excluded from the
  fuzz** (the raw model's split/join is not how y-prosemirror does it).
- Multi-user runs with the real editor (real-editor runs are single-writer
  with a new client id per session). In the raw model, 4 users with one
  offline (866 KiB v1 after a year) cost the same as one user running the
  same number of actions (863 KiB): concurrency itself adds little; the
  number of edits and sessions drives growth. The raw model writes less
  than y-tiptap (866 vs 1,956 KiB), so raw numbers are lower bounds.
- The 240-actions/day Docs profile (extrapolated; jsdom ran out of heap)
  and the 10k-row Sheets start profile (covered by the log profile passing
  10k rows).
- Pending-update bookkeeping across reloads (events not yet saved must be
  kept in IndexedDB, or the client falls back to a state-vector diff once).
- Browsers, IndexedDB, the relay, `CompressionStream`, real PHP PUTs
  through Apache/nginx with `post_max_size` limits.
- The append-log save model and folding are designed, not built.
- How users actually edit (action mixes and rates are guesses).

## 7. Reproduce

```bash
cd prototypes/ycsv
pnpm exec vitest run tests/yjs-growth-compaction.test.ts tests/yjs-growth-fuzz.test.ts
FUZZ_RUNS=1000 pnpm exec vitest run tests/yjs-growth-fuzz.test.ts
RUN_GROWTH=1 pnpm exec vitest run tests/yjs-growth-bench.test.ts --pool=forks
php -d memory_limit=2G scripts/php-save-cost.php
cd ../../packages/apps && RUN_GROWTH=1 pnpm exec vitest run --project unit src/text-editor-core/docs-collab/spike-yjs-growth.test.ts
```
