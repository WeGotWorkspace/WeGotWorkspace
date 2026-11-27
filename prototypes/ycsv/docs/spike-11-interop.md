# Spike 11 — YCSV interop with Excel, Google Sheets, LibreOffice and Apple Numbers

Branch `spike/sheets-interop`. Nothing here is on main, and nothing changes
`src/ycsv-model` or the grid.

**Sources.** The spec and the `spreadsheet-core` parser and engine are
snapshots from `feat/spreadsheet-core` (e30a45bbc). They live in
`prototypes/ycsv/upstream/` (see its README for why they are not under
`packages/apps`). The spec amendments are written into
`upstream/ycsv-spec-v1.md` as **Appendix B**, marked "Proposal (spike 11)".
Each section they touch has a short pointer note.

**Tools.** The reference engine was LibreOffice 26.8 headless (`soffice`),
using a throwaway profile per run. The libraries were SheetJS CE 0.20.3
(installed from the SheetJS CDN tarball; npm `xlsx` is stuck at 0.18.5 with
known CVEs) and exceljs 4.4.0. Everything ran in Node 26 under vitest.

## Answers in short

1. **Conformance.** With every decision up to 2026-11-27 written in, the
   spec decides 57 of the 70 corpus cases. `spreadsheet-core` passes 16 of
   them and the prototype passes 24. The two parsers agree on only 17 of
   the 70. The largest single cause is row
   numbering:
   - **The prototype follows the spec**: the first data row is row 1.
   - **The core engine counts the header as row 1.** That is a bug against
     §7.1 (Wouter's decision, see [Row numbering](#row-numbering-decision)).
     With that bug simulated as fixed (refs shifted by one), it passes 33.

   Both parsers lose:
   - trailing empty rows;
   - any cell that contains a `---` line.
2. **Import.** Use SheetJS CE to read XLSX, ODS and CSV, plus a small
   raw-XML reader (about 100 lines) for what CE does not expose: frozen panes,
   data validation and bold. 37 of 37 formulas from a realistic workbook
   round-trip A1 → YCSV → A1 as identical text. The core engine reproduces
   LibreOffice's values for 29 of the 37.
3. **Export.** exceljs is the only XLSX writer that kept everything. After
   LibreOffice recalculated its output, all 135 checked cells were identical,
   and styles, validation, freeze, merges, notes, names and hidden sheets all
   survived. Export XLSX + CSV in v1. Leave ODS export out of v1: SheetJS's
   ODS writer corrupts cross-sheet refs.
4. **Formulas.** Use the function set in [v1 function set](#v1-function-set)
   (about 100 functions). 80 of 112 test formulas match LibreOffice today.
   - Most misses are in the engine: how it passes 2-D ranges and errors, plus
     precedence, `%` and case rules.
   - formulajs itself lacks XLOOKUP and XMATCH, and gets the `*IFS`
     functions with boolean criteria, TEXT with dates, and dates as JS `Date`
     wrong.
5. **Notation.** **Store the canonical form in the file. Show and accept the
   locale form in the editor**: `=ROUND(3,27;1)` in nl-NL, the same as Excel
   and LibreOffice. The prototype converter (`interop/notation/`) passes
   2,000 random round trips. One case cannot be detected safely: a canonical
   formula typed in nl-NL. The editor can flag it, but cannot always fix it.
6. **Apple Numbers.**
   - **Reading `.numbers`:** SheetJS CE reads them in the browser or a worker,
     but **values only**. Formulas are frozen at their last result; the
     importer says so and suggests exporting from Numbers as Excel, which
     keeps formulas.
   - **Numbers' own XLSX export:** usable, but it inlines named ranges, shows
     hidden sheets, drops some formulas that are in error, and moves times by
     one day. The importer now handles 1904 dates, float noise, Numbers'
     spare columns and times.
   - **Exporting to Numbers:** use our XLSX. Numbers recalculates an
     exceljs XLSX to LibreOffice's values in 131 of 135 cells; it has no
     TEXT().
   - **Notation:** Numbers in nl-NL accepts only `;` and the decimal comma
     in formulas, with English function names.
7. **Lossy import is fine; silent loss is not.** The fidelity table gives a
   fallback per lost feature. The import report logs every loss, including
   every formula whose result differs from the source app's.
8. **Row numbering.** P1 is **rejected**: the spec keeps the first data row
   as row 1. Import and export now map A1 rows to YCSV rows (Excel row 2 = YCSV
   row 1 under a header). **P30 is accepted**: empty rows keep their
   number, so that header offset is the whole mapping and blank rows need no
   renumbering. All checks still hold: 37/37 formulas round-trip as
   identical text, 29/37 engine values match, and the exceljs export gives
   135/135 in LibreOffice. The constraint that matters: the grid shows the
   same number as the formulas use, so the header row is unnumbered. Still
   open for Wouter: how is the header row labelled in the grid? See
   [Open questions](#open-questions).
9. **Header flag accepted (P2/P27).** Every sheet states `header:
   true|false`. Detection (rules D1–D7, now in spec §4.1) runs only when the
   flag is missing, as on a plain CSV, and its result is written back. Users
   can toggle "first row is header", which renumbers only the file form. See
   [Header flag and detection](#header-flag-and-detection).
10. **CSV first (P31, P32 accepted).** The header row stays in the CSV body,
    and `columns` is an optional enrichment. A `.csv` stays CSV until a
    YCSV-only feature is used; then the editor asks. Proposed matching rule:
    ref equals header text first, then position (C1–C5). Build consequence:
    `.csv` needs a Yjs sidecar and Sheets routing. See
    [CSV first](#csv-first-header-in-the-body-csv-stays-csv).
11. **Named header columns without frontmatter (P33, P34): accepted.**
    Frontmatter is optional in `.ycsv` too (first line exactly `---` or
    not). Refs come from the header text alone: the text itself, quoted
    when it is not an identifier or ends in a digit (`'Prijs incl. BTW'3`,
    `'kw1'2`), case-insensitive, no name for empty or duplicate headers.
    Renaming a header by hand breaks formulas; our editor is safe. See
    [Refs from the header text](#refs-from-the-header-text-p33-p34).
12. **Spec: all proposals decided (2026-11-27).** P1 rejected; everything
    else accepted, P29 in a changed form (addresses use the formula ref
    grammar: `product0:totaal0`). Checking the bulk-accepted proposals
    against the decisions found 22 conflicts (K1–K22), each resolved in
    the direction of the decisions; one needs Wouter's confirmation (K2:
    the ref of a renamed duplicate column). The spec copy has every
    decision written in, and `ycsv-spec-v1-clean.md` is the same text
    without spike notes. It stays **v1.0**: v1 has not shipped, and a
    v1.1 would promise compatibility with v1.0 files that the changes
    break. See [Decisions of 2026-11-27](#7-decisions-of-2026-11-27).

## 1. Conformance corpus and round trips

The full table is in [spike-11-conformance-results.md](spike-11-conformance-results.md).
- **Corpus:** `interop/conformance/corpus/`.
- **Cases:** `interop/conformance/cases.ts`.
- **Runner:** `interop/conformance/run.test.ts`.

| | core (`spreadsheet-core`) | proto (`prototypes/ycsv`) |
|---|---|---|
| Spec-decided cases passed (of 40) | 12 (25 with its header-as-row-1 bug simulated as fixed) | 19 |
| Agree with each other | 16 of 70 | |
| Spec example 9.4 (`categorieën`) | fails: ASCII-only refs | fails: single-sheet only |
| `---` line inside a quoted cell | splits the sheet | splits the sheet |
| Empty rows keep their number (§7.2, P30) | yes (with the shift); keeps trailing empty rows | yes, but skips blank lines and keeps trailing empty rows |
| Header reordered vs `columns` | matched by position | matched by position |
| Quote in mid-field | swallows the rest of the file | ok |
| Missing `ycsv_version` / frontmatter | accepted | accepted |
| Unknown sheet / cycle (spec: hard error) | per-cell `#REF!` / cycles not flagged | accepted |
| `-2^2` / `2^3^2` (Excel: 4 / 64) | 4 / 512 | -4 / 512 |
| File without header (A-Z, §9.1) | ok | row 1 always taken as header |
| CR inside a cell | kept | stripped |

**Round-trip properties** (fast-check, seed 11; results in
`interop/conformance/roundtrip-results.json`):

| Property | core | proto |
|---|---|---|
| Plain values, no fully empty rows | pass | pass |
| A trailing fully empty row survives | dropped (P26: correct) | dropped (P26: correct) |
| A cell containing `\n---\n` survives | **fail** | **fail** |
| `\r` inside a cell survives | pass | **fail** |

**Large files** (`large-results.json`, parse only, Node 26 on this Mac):

| File | core | proto |
|---|---|---|
| 10k rows × 10 columns, 1 MB | 41 ms | 142 ms |
| 100k rows × 10 columns, 10 MB, 1 formula column | 1,528 ms | 2,413 ms |
| One 5 MB cell | 114 ms | 131 ms |
| 50 sheets × 200 rows, chained cross-sheet refs | 46 ms | n/a (single-sheet) |

Neither parser has a problem with size. Evaluation and the browser main
thread were not measured here.

## 2. Import (XLSX, ODS, Google Sheets export shape)

### Library evaluation

`interop/xlsx/probe.ts` read each fixture with both libraries. Results are in
`interop/xlsx/probe-results.json`.

| | SheetJS CE 0.20.3 | exceljs 4.4.0 |
|---|---|---|
| Licence | Apache-2.0 (CDN tarball, not npm) | MIT, last release 2023 |
| Size (min / gzip) | full 951 KB / 336 KB; mini 280 KB / 86 KB | 928 KB / 258 KB |
| Formats read | xlsx, xlsm, xls, xlsb, ods, csv, … | xlsx only |
| Formulas + cached values | yes (`_xlfn.` stripped) | formulas yes; cached values only when the writer stored them |
| Number formats, merges, widths, hidden, names, notes, hyperlinks | yes | yes |
| Bold / fonts / alignment | no (Pro only) | yes |
| Fill colours | yes | yes |
| Frozen panes, data validation, conditional formatting | no | freeze and validation yes; conditional formatting yes |
| ODS details | loses hidden sheets, widths and styles; dates come out as `m/d/yy`; garbles a named range | n/a |

**Recommendation: SheetJS CE for reading.** It is the only library here that
reads every format users bring, it has cached values, and its mini build is
small. Add our own raw-XML reader for XLSX freeze, validation and bold; the
spike's `rawParts()` in `interop/xlsx/import.ts` is about 100 lines. Load it
lazily in a worker. ODS import is supported, but at lower fidelity (see the
table below).

Other options I considered and did not choose:
- **PhpSpreadsheet** (MIT, server-side) reads everything, but import would
  then need the server, and the app is offline-first.
- **HyperFormula** is GPL or commercial; it is an engine, not a file reader.

### Fixtures

`interop/fixtures/gen-fixtures.ts` builds the workbook:

- **Workbook:** a small studio workbook with 4 sheets.
- **Contents:**
  - typed columns;
  - a hidden settings sheet;
  - named ranges;
  - validation;
  - notes;
  - merges and freeze;
  - a Q1 report sheet with 30 key figures: lookups, `*IFS`, dates, `&`,
    `%`, a whole column, `$` refs, errors, a hyperlink and rich text.
- **Variants:** the exceljs original, plus versions converted by
  LibreOffice to `.xlsx` and `.ods`.
- **Google Sheets fixture:** `google-shape.xlsx` imitates what Google Sheets
  writes. It wraps functions Excel does not know in
  `__xludf.DUMMYFUNCTION`, with cached values.

The fixtures were not produced by real Excel or real Google Sheets (see
[Not verified](#not-verified)).

### Fidelity per feature

**Lossy import is accepted.** YCSV has fewer features than the
applications it imports from, so losing things is expected. This table is
the deliverable: what survives, what degrades, and what is lost, each with a
fallback. Every degraded or lost item is written to the import log, which
becomes the import report the user sees (`interop/xlsx/results.json`, field
`log`). The one rule: a value the user cares about is never lost or changed
silently. See [No silent loss](#no-silent-loss).

Columns:
- **XLSX**: files written by exceljs and by LibreOffice. They behave the
  same unless the cell says otherwise.
- **ODS**: LibreOffice.
- **Google**: the shape of a Google Sheets XLSX export.
- **.numbers**: a native Numbers file read with SheetJS CE.
- **Numbers XLSX**: Numbers' own File → Export To → Excel.

The imported YCSV is in `interop/fixtures/out/*.ycsv`.

| Feature | XLSX | ODS | Google | .numbers | Numbers XLSX | Fallback when not surviving |
|---|---|---|---|---|---|---|
| Values: text, numbers, booleans | survives | survives | survives | survives (checkbox → boolean) | survives | — |
| Dates | survives (ISO) | survives | — | survives after 1904 fix | survives | — |
| Times of day | survives | survives | — | **degrades** → fixed: a date-formatted value on day 0/1 becomes `time` | survives after fix (Numbers adds one day) | logged |
| Header row → refs + names | survives | survives | survives | survives (after trimming Numbers' spare columns) | degrades when the table title is shown: title in row 1, header in row 2, A-Z refs | logged; refs fall back to A-Z |
| Formulas (text) | 36/36, 37/37 | 37/37 | 2/2 | **lost**: values only | survives (13/13; studio 35 of 42) | .numbers: keep the last value, log once per file: "export from Numbers as Excel to keep formulas" |
| Formula result = source app's cached value | 29/37 | 29/37 | 2/2 | — | 11/12, 28/34 | each difference logged with both values (see below) |
| Unsupported function | — | — | degrades: cached value + `source_formula` | — | Numbers drops some error formulas (`TEXT(date)`, `NA()`) | keep the cached value; store the original in `source_formula` |
| Postfix `%` | degrades (needs P4) | degrades | — | — | degrades | logged |
| Named ranges | survives | survives | — | lost | lost (Numbers inlines them) | the inlined range still works |
| Number format → type | survives | percent display lost | survives | **degrades**: dates only; currency and percent become plain numbers | survives | value kept; column becomes `number` |
| Exact format code | `excel_format` | `m/d/yy` | — | — | `excel_format` | Intl defaults for the type |
| Per-cell formats (report sheets) | survives | survives | — | — | survives | — |
| Bold | survives (raw XML) | lost | — | lost | lost (Numbers re-styles tables) | drop, log |
| Fill colour | survives | lost | — | lost | lost (indexed colours, not read) | drop, log |
| Italic, sizes, alignment, borders | lost | lost | lost | lost | lost | drop, log (P16 would keep italic and alignment) |
| Rich text runs | degrades: plain text | degrades | — | degrades | degrades | text kept |
| Merged cells | survives | survives | — | survives | survives (also the table title row) | — |
| Frozen panes | survives (exceljs file) | lost | — | lost | lost | drop |
| Column widths, hidden columns | survives | lost | survives | lost | widths survive | renderer default |
| Row heights | lost (decision 6) | lost | — | lost | lost | fixed row height |
| Hidden sheets | survives | lost | — | — | lost (Numbers shows them) | sheet visible |
| Tab colour | survives | lost | — | — | lost | drop |
| Data validation | survives (2 rules) | lost | — | lost | 1 of 2 rules | drop the rule, keep values |
| Conditional formatting | lost (not built) | lost | lost | lost | lost | drop, log |
| Notes | survives (author dropped) | survives | survives | survives | survives | — |
| Hyperlinks | survives as `=HYPERLINK()` | survives | — | survives | survives | — |
| Error values | survives as `=NA()` | survives | — | degrades: no error code → `=NA()` | `=1/0` kept without a value; others dropped | logged |
| Several tables on one sheet (Numbers) | — | — | — | degrades: one sheet per table; names lost (`Budget_1`) | degrades: one sheet per table, named `Sheet - Table` | logged with the table names |
| Header column / footer row (Numbers) | — | — | — | degrades: plain cells | degrades: plain cells | — |
| Autofilter, print areas | lost | — | — | — | — | drop |
| Charts, images, pivots | not in the fixtures | | | | | drop, log (not built) |

The 8 formulas where the core engine differs from LibreOffice's cached values:
- VLOOKUP on a 2-D range def (the engine flattens ranges);
- XLOOKUP (`#NAME?`, not in formulajs);
- SUMIFS with a `TRUE` criterion (0);
- whole column `totaal:totaal` (`#PARSE!`);
- `50%` (`#PARSE!`);
- EOMONTH and TODAY (one hour off: local-time `Date`);
- TEXT(date) (returns the serial number).

### Google Sheets export shape

Google exports XLSX with cached values for every formula. It wraps functions
Excel lacks as `IFERROR(__xludf.DUMMYFUNCTION("GOOGLEFINANCE(…)"), 1.08)`.
The importer:
- keeps the cached value as a plain value;
- stores the original formula in `cells.<A1>.source_formula` (P21);
- logs the cell as degraded.

Plain functions come through like any XLSX file. One gap: `source_formula` is
not written back on export, so a Google → YCSV → Google round trip loses
those formulas.

### Apple Numbers

**Fixtures** (`interop/fixtures/files/numbers/`), made with Numbers 15.1
("Numbers Creator Studio") through osascript, in a temp folder:
- `native-*.numbers` is built in Numbers itself:
  - sheet "Budget" with two tables, "Uitgaven" (header row, footer row) and
    "Samenvatting" (header column);
  - currency, percent, checkbox and text formats, dates, cross-table formulas
    (`Uitgaven::B2:B6`), INDEX/MATCH, ROUND, `&`, an error (`=1/0`), and an
    empty second sheet;
  - variants `plain`, `formats`, `checkbox` and `full` add the features one
    by one;
  - each comes with Numbers' own `.xlsx` and `.csv` exports.
- `studio.from-xlsx.numbers` is the studio workbook opened in Numbers and
  saved as `.numbers`, with Numbers' `.xlsx` and `.csv` exports.

**Reading `.numbers`.** A `.numbers` file is a zip of IWA files, which are
Snappy-compressed protobuf.

| Library | Reads | Writes |
|---|---|---|
| SheetJS CE 0.20.3 | yes: values, dates, booleans, merges, notes, hyperlinks. No formulas, no number formats except dates, no styles, no table names. Dates come in the 1904 system (`date1904`), so serials are 1,462 days smaller, and the importer must shift them. | yes, values only (number, boolean, text; no formulas, formats or dates), and only with the 127 KB "zahl" template (59 KB gzip) |
| exceljs, LibreOffice | no | no |
| Others | No maintained JS reader found besides SheetJS. Apple publishes no spec; the format changes between Numbers versions. | |

In the browser or a worker, reading `.numbers` is realistic. It is the same
SheetJS code path as XLSX (pure JS, zip + Snappy + protobuf), with no
server. The cost is the loss above: **a `.numbers` file imports as values
only**, so every formula is frozen at its last result. The importer says so
once per file and points to the fallback: in Numbers, choose File → Export
To → Excel, then import that file, which keeps the formulas.

One early fixture crashed SheetJS CE (`throw 5`, "data list type 5"). I
built it with formulas Numbers had rejected (see notation, below). After a
rebuild, all four variants read fine. I did not find out what caused it, so
the importer must catch reader errors and show "this Numbers file could not
be read; export it as Excel".

**Numbers' XLSX export:**
- **Sheets:** a first sheet "Export Summary" maps each Numbers sheet and
  table to a worksheet. The importer drops it and logs the table names.
- **Tables:** each table becomes its own worksheet, named `Sheet - Table`
  when a sheet has several tables. When the table title is shown, it is in
  row 1 (merged) and the header moves to row 2.
- **Formulas:** they survive as array formulas (`t="array"`), and
  cross-table refs become sheet refs.
- **Named ranges:** inlined.
- **Hidden sheets:** made visible.
- **Freeze:** dropped.
- **Styles:** bold mostly dropped; fills written as indexed colours.
- **Formulas in error:** some are written as empty cells, so both the
  formula and the error are gone (`TEXT(date)`, `NA()`). `=1/0` is kept, but
  without a value, and SheetJS only reads it with `sheetStubs: true` (fixed in
  the importer). An importer cannot detect the dropped ones; the report says
  so for every Numbers XLSX.
- **Times:** a time of day is written with day 1 included (09:30 became
  1.3958, that is 1900-01-01 09:30). The importer keeps only the time part
  for `time` cells.
- **Values:** Numbers' cached values match LibreOffice's for 131 of 135
  studio cells. The four differences are those formulas in error and the
  time.

**Numbers' CSV export** is a folder with one file per table (`Sheet-Table.csv`):
- `;` separator, decimal comma;
- display formats: `€ 1250,50`, `5-1-26`, `82,8584680625497%`;
- no BOM;
- errors written as empty cells.

It needs the same locale-aware CSV import as Dutch Excel CSV, and it is
lossier than Numbers' XLSX export.

**Formula notation in Numbers** (nl-NL, checked by setting cell formulas
through AppleScript):
- Function names stay English (`SUM`, `ROUND`; Dutch names such as
  `AFRONDEN` are not recognised).
- Arguments take `;` and the decimal comma: `=ROUND(1,255;2)` works.
  `=ROUND(1.255,2)` and `=IF(1>0,"ja","nee")` are rejected, and the cell
  stays empty.
- Numbers follows Excel on precedence and `%` (`-2^2` = 4, `2^3^2` = 64,
  `50%*10` = 5, `"a"="A"` is true) and has XLOOKUP.

This supports the notation recommendation in §5: canonical in the file,
locale in the editor.

### No silent loss

These are the cases where an import could change a value the user cares
about without saying so, each with what the spike importer now does:

| Case | Without care | Now |
|---|---|---|
| Our engine computes a formula differently from the source app (VLOOKUP on a 2-D range, XLOOKUP, SUMIFS with `TRUE`, `50%`, whole columns, EOMONTH/TODAY, TEXT(date)) | the cell silently shows another number than in Excel | every difference is logged with both values. Proposed UI: keep the formula, flag the cell, show "Excel showed 0.1". Fixing the engine (§4) makes the list shrink. |
| `.numbers` formulas | values look right but no longer update | logged once per file, with the Excel-export fallback |
| `.numbers` dates (1904 system) | every date 4 years early | fixed: shifted by 1,462 days |
| `.numbers` float noise (`0.6000000000000001`) | ugly values | fixed: 15 significant digits on import (as Excel) |
| Times stored as day 1 + time (Numbers) | time shown as the date 1899-12-31 | fixed: becomes a `time` cell, logged |
| Numbers' spare empty columns | header not detected, A-Z refs | fixed: trailing empty columns trimmed (merged and hidden columns kept) |
| Formula cells without a cached value | dropped by SheetJS | fixed: read with `sheetStubs` |
| Numbers XLSX dropping error formulas | cell empty | not detectable; logged as a warning for every Numbers XLSX |
| Dutch CSV read with library defaults | `0,45` → 45, `05-01-2026` → 1 May | CSV import must ask for or detect the locale (B.7) |
| Google-only functions | cached value only | `source_formula` kept, logged |

`interop/xlsx/interop.test.ts` adds a log entry for every formula whose
engine result differs from the cached value. Across all fixtures, that is
the complete list above.

## 3. Export (YCSV → XLSX / ODS / CSV)

`interop/xlsx/export.ts` exports each imported workbook three ways:
- SheetJS XLSX and SheetJS ODS, written with our engine's values as cached
  values;
- exceljs XLSX, written with no cached values and recalculate-on-load.

Each export is then checked in two ways:
- re-imported with our importer, and the YCSV text diffed against the first
  import;
- converted to CSV by LibreOffice headless (which recalculates the formulas)
  and compared, cell by cell, with LibreOffice's own CSV of the original ODS.

| Export | LibreOffice values = original (studio workbook) | Lost on re-import |
|---|---|---|
| **exceljs XLSX** | **135/135** | tab colour (not written by the spike), width rounding |
| SheetJS XLSX | 133/135 | validation, bold, freeze, tab colour (CE cannot write them) |
| SheetJS ODS | 122/135 | the same, plus writer bugs |

What these numbers show:
- **SheetJS XLSX:** LibreOffice did not recalculate it. It showed our
  engine's cached values, including the wrong ones. This is why the spec
  proposal on cached values says: write correct cached values or none.
- **SheetJS ODS:** the writer turns cross-sheet refs into
  `Producten![.C2]`, which gives `#NAME?`. A formula with no value becomes
  `of:=#NUM!`.
- **Re-import:** the exceljs round trip YCSV → XLSX → YCSV is otherwise
  line-identical.
- **ODS as the source:** starting from the ODS-sourced import, exceljs reaches
  126/135. The 9 differences are percent display, which was already lost on
  the ODS import, not in the export.

**CSV.** Export writes one file per sheet: values from the engine, ISO dates,
and `'` removed. Two problems with CSV coming the other way:
- LibreOffice's own CSV export writes US display formats (`01/05/2026`,
  `18%`).
- **A Dutch Excel CSV (`;`, `0,45`, `05-01-2026`) read with SheetJS defaults
  silently turned `0,45` into 45 and `05-01-2026` into 1 May.** CSV import
  must parse the raw text with an explicit locale (proposal B.7).

**Recommendation for export:**
- **XLSX:** use exceljs, with no cached values and "recalculate on load".
  - exceljs is MIT but not maintained since 2023. It is still the only
    option here that writes bold, validation and freeze.
  - If maintenance becomes a problem, write the few XML parts ourselves on
    top of SheetJS CE.
- **CSV:** per sheet.
- **ODS:** not in v1. LibreOffice opens our XLSX at 135/135.
- **Numbers:** export XLSX (exceljs), not `.numbers`. See below.

### Export to Apple Numbers

- **`.numbers` via SheetJS:** it writes a valid file (`numbersWritesNumbers`
  in `interop/xlsx/numbers-results.json`), but values only. There are no
  formulas, formats or date type, and it needs the zahl template. Not worth
  it.
- **XLSX:** Numbers opens XLSX and recalculates it. The evidence is the
  studio workbook written by exceljs with no cached values, the same writer
  and shape as our export. Numbers opened it and got LibreOffice's values in
  131 of 135 cells. The four differences:
  - `TEXT(date)`: Numbers has no TEXT function, so `=TEXT(…)` breaks in
    Numbers;
  - two formulas in error (`=1/0` and `=NA()`), which Numbers leaves without
    a value;
  - one time cell, which Numbers' re-export moves by one day.

  What Numbers keeps from that XLSX: formulas, number formats, merges,
  notes, hyperlinks, widths and a list validation. What it loses: named
  ranges (inlined), hidden sheets, freeze, tab colour and the whole-number
  validation rule.
- **Not verified:** opening *our* export file in Numbers. Driving Numbers
  from the test was unreliable:
  - AppleScript's `open` never returns for an XLSX;
  - a second installed Numbers (14.5) took the `open -a` call;
  - later opens produced no document at all.

  The step is in `interop/xlsx/numbers.test.ts` behind `NUMBERS_E2E=1`.
  It needs a manual check.
- **Advice for v1:** offer "Excel (.xlsx)" and say it opens in Numbers. If
  Numbers users matter, avoid TEXT() in templates, or add a Numbers-safe
  export that writes TEXT() results as values.

## 4. Formulas

### v1 function set

These are the functions people use most in spreadsheets, grouped below. Each
one was checked against LibreOffice in `interop/formulas/functions.test.ts`:
112 test formulas on one sheet, with the input data in A1:E6. Results are in
`functions-results.json`.

| Group | Functions | Match LibreOffice |
|---|---|---|
| Math | SUM, SUMIF, SUMIFS, SUMPRODUCT, ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, PRODUCT, POWER, SQRT, CEILING, FLOOR | 14/16 |
| Statistics | AVERAGE, AVERAGEIF, COUNT, COUNTA, COUNTBLANK, COUNTIF, COUNTIFS, MIN, MAX, MEDIAN, MAXIFS, MINIFS | 7/12 |
| Logic | IF, IFS, AND, OR, NOT, IFERROR, IFNA, SWITCH | 7/8 |
| Lookup | VLOOKUP, HLOOKUP, XLOOKUP, INDEX, MATCH, XMATCH, CHOOSE, ROW, COLUMN | 2/10 |
| Text | CONCAT, CONCATENATE, TEXTJOIN, LEFT, RIGHT, MID, LEN, UPPER, LOWER, PROPER, TRIM, SUBSTITUTE, FIND, SEARCH, TEXT, VALUE, REPT, EXACT | 17/19 |
| Date | DATE, YEAR, MONTH, DAY, WEEKDAY, WEEKNUM, ISOWEEKNUM, EDATE, EOMONTH, DATEDIF, NETWORKDAYS, WORKDAY, DAYS, TIME, HOUR, DATEVALUE, TODAY, NOW | 14/18 |
| Info | ISBLANK, ISNUMBER, ISTEXT, ISERROR, ISNA, NA | 3/5 |
| Finance | PMT | 1/1 |
| Other | HYPERLINK (P18) | (import test) |
| **All, with edge cases** | | **80/112** |

Where each miss comes from: `interop/formulas/formulajs-direct.test.ts` calls
formulajs directly with Excel-shaped arguments, to separate formulajs gaps
from engine gaps.

| Miss | Cause | Fix |
|---|---|---|
| XLOOKUP, XMATCH → `#NAME?` | missing in formulajs | add our own implementation |
| SUMIFS / COUNTIFS / MAXIFS / MINIFS with `TRUE` criterion → 0 | formulajs | patch or wrap |
| IFNA, ISERROR, ISNA don't see errors | formulajs error objects vs engine errors | engine: pass errors as formulajs errors |
| TEXT(date, "yyyy-mm-dd") → serial | formulajs | own TEXT (we need Excel format codes anyway, P9) |
| DATE, EDATE, EOMONTH, WORKDAY one hour off | formulajs returns local-time `Date` | engine converts to serial numbers (P7) |
| SUM over text numbers → 1007 (Excel 0) | formulajs coerces text in ranges | wrap: ignore text in ranges, coerce only direct args |
| SUMIF, AVERAGEIF, COUNTBLANK wrong | engine (formulajs alone is right) | engine range handling |
| VLOOKUP / HLOOKUP / INDEX on 2-D ranges | engine flattens ranges to 1-D | pass ranges as 2-D arrays (P4) |
| ROW(), COLUMN() → `#N/A` | engine passes values, not references | implement in the engine |
| `-2^2`, `2^3^2`, `50%`, `#N/A` literal | engine parser | P4 |
| `"a"="A"` → false, `A5=""` → false | engine | P4: case-insensitive; blank equals `""` |
| `0.1+0.2=0.3` → false | engine | compare at 15 significant digits, like Excel |
| UPPER("straße") → STRASSE (LibreOffice ẞ, Excel STRASSE) | none | accept |

### A1 ↔ column refs

`interop/xlsx/translate.ts` translates in both directions, and all 37 fixture
formulas round-trip as identical text.

| Excel A1 | YCSV |
|---|---|
| `C2` (header in row 1, column C = `prijs`) | `prijs1` |
| `$C$2`, `$C2`, `C$2` | `$prijs$1`, `$prijs1`, `prijs$1` |
| `C2:C6` | `prijs1:prijs5` |
| `A2:C4` | `id1:korting3` (rectangular, P4) |
| `E:E` | `totaal:totaal` |
| `'Q1 overzicht'!B4` (no header, row 2 empty) | `q1_overzicht!B4` (A-Z refs; the empty row keeps its number, P30) |
| `Producten!E2:E6` | `producten!totaal1:totaal5` |
| `C1` (the header cell itself) | `prijs0` |
| a ref to a fully empty row | the same row, a blank cell (P30) |
| a column whose name ends in a digit or has spaces | `'kw1'1`, `'Zo Doen'1` (P12) |
| `BTW_TARIEF` (named range) | `btw_tarief` (def, P13) |
| `_xlfn.XLOOKUP(…)` | `XLOOKUP(…)` (prefix added back on export) |
| `Table1[Prijs]` (structured ref) | flagged, not translated |

### Row numbering decision

P1 (header = row 1, as in Excel) is **rejected**. Wouter's words: rows count
from 1 in the spec; in the CSV source the header can be line 1, and the grid
can start its visible numbering at the data. So:

- **The spec stands.** The first data row is row 1, the header is row 0
  (§7.1). Fully empty rows keep their number (§7.2 as replaced by P30,
  accepted after this decision).
- **`spreadsheet-core` has a bug.** Its engine counts the header as row 1,
  against §7.1. It is not an alternative numbering, and it must be fixed
  before it ships. Its corpus score with that bug simulated as fixed is 20 of
  35.
- **Import and export map row numbers per sheet** (`rows` in
  `interop/xlsx/translate.ts`, `rowNumbers` / `toYRow` / `toA1Row`):
  - With a header in source row 1, Excel row 2 = YCSV row 1. Without a
    header, the numbers are the same.
  - **No renumbering for blank rows** since P30: an empty row keeps its
    number, so the header offset is the whole mapping. (Before P30 every
    empty row above a ref lowered it by one more: Q1 sheet Excel `B4` →
    `B3`, next to its own label "50%*B4". Now it stays `B4`.)
  - Export applies the inverse.
- **The checks still hold with the mapping:**
  - 37/37 formulas round-trip A1 → YCSV → A1 as identical text;
  - the engine matches the cached values in 29/37, as before;
  - the exceljs export gives 135/135 identical values after LibreOffice
    recalculates;
  - re-import is line-identical apart from tab colour;
  - the Numbers fixtures keep the same scores.
- **Frontmatter addresses (P29)** follow the same numbering. Header cells are
  row 0 (`cells: product0: …`, P29 as decided). Styles on a fully empty row keep their address
  (before P30 they were dropped and logged).

**The one constraint that matters.** The number the grid shows next to a row
must be the number a formula uses for it. Otherwise `totaal3` points at a
different row than the one labelled 3.

**Recommendation for the renderer:**
- Show the header row with **no row number**, like Numbers' header rows (and
  like the column header band in Excel). Number data rows from 1. The
  formula bar, the name box (`prijs3`) and error messages use the same
  number.
- Empty separator rows are numbered like any other row (P30), so numbers
  never jump.
- Copying cells to Excel or exporting is where the numbers change (Excel
  adds the header row). That is expected, and the export does the mapping.

**Empty rows: decided (P30 accepted, Wouter: "A!").** Empty rows keep
their number; spec §7.2 is replaced. The rules:
- an empty line, a whitespace-only line and an all-separators line (`,,`)
  are all empty rows, and parsers must not skip blank lines;
- row number = body line number minus the header offset;
- a blank line inside a quoted field is part of the value;
- the final newline is not a row, and trailing empty rows are not stored
  (P26);
- cells of an empty row are blank cells: aggregates ignore them as in Excel,
  and charts skip empty rows.

The old §7.2 said empty rows are "skipped during formula evaluation". With
numbered rows that only means: an empty row has no formulas, and its blank
cells are ignored by `SUM`, `AVERAGE`, `COUNT`, `COUNTA`, `MIN` and `MAX`
(`COUNTBLANK` and `ROWS` count them). A reference to such a cell is a blank,
not an error. The spec now says this in §7.2.

What changed in the spike code: `rowNumbers` numbers every row
(`interop/xlsx/translate.ts`); re-import shows the Q1 sheet's formulas at
their Excel row numbers again and keeps the bold styles on its blank rows.
The 37/37 text round trip and the 135/135 export are unchanged.

Conformance cases for it (`r01`, `r04`–`r08`):

| Case | core (+1 shift) | proto |
|---|---|---|
| `,` row keeps its number | pass | pass |
| blank line is a row | pass | **fail**: skips blank lines |
| whitespace-only line is a row | pass | pass |
| final newline / trailing empty rows not stored | **fail**: keeps them | **fail**: keeps one |
| blank line inside quotes is part of the value | pass | pass |
| aggregates ignore an empty row | pass | pass |

Without the shift, core fails all six because of its header-as-row-1 bug.

### Edge semantics proposed for v1

These follow Excel, because that is what imported files expect:
- A blank cell is `0` in arithmetic and `""` in text comparison.
- Text compares case-insensitively.
- Text inside a range is ignored by SUM and AVERAGE. A direct `"3"*2` is
  coerced (= 6).
- Booleans count in arithmetic (`TRUE+TRUE` = 2), but not in SUM over a range.
- Numbers compare at 15 significant digits.
- Errors propagate. IFERROR, IFNA, ISERROR and ISNA catch them.
- Dates are serial numbers (P7).
- Unknown sheets and cycles are per-cell errors.

## 5. Formula notation under nl-NL

**Question:** is canonical input (`=ROUND(3.27,1)`) acceptable in nl-NL, or
must the editor follow the locale (`=ROUND(3,27;1)`)?

**Prototype:** `interop/notation/notation.ts` and `notation.test.ts`.
- `notationFor(locale)` reads the decimal mark from Intl. When it is `,`
  (nl-NL, nl-BE, de-DE, fr-FR), the argument separator is `;`. en-US, en-GB
  and de-CH stay canonical.
- `toLocale` and `fromLocale` convert with a tokenizer. They change only
  number literals and argument separators. They never change strings,
  quoted refs, or row numbers glued to a ref (`prijs2`, `'Zo Doen'2`).
- 9 hand cases, including `"#,##0.00"` format strings and `STDEV.S`.
- 2,000 random formulas round-trip canonical → nl-NL → canonical unchanged.
- `readInput` flags the one ambiguous case. In nl-NL, `=SUM(1,2)` reads as
  `SUM(1.2)`. That is what Excel does too, but a user pasting a formula from
  an English forum gets a silent wrong answer. The editor warns when the
  input has a decimal-comma number and no `;`.

**Recommendation: canonical in the file, locale in the editor.**

- Every Dutch user who knows Excel types `;` and `3,27`. If the editor
  refused that, every formula they type from habit would be an error.
  Showing the same file differently per user is safe, because the file
  itself never changes.
- Display follows the user's locale setting, not the column's `locale`.
  Two colleagues see the same formula in their own notation.
- Accept `;` as a separator in every locale; it is never ambiguous. In a
  `,`-decimal locale, read `,` as the decimal mark, as Excel does, and show
  the warning above.
- What this costs:
  - The converter must run on every edit and every display. It is a
    linear tokenizer.
  - Formula suggestions and help texts must use the locale separator.
  - Docs and support answers must name both forms.
- The alternative, canonical everywhere, is simpler and fully predictable,
  but it fails the "works like Excel" expectation for every nl-NL user from
  the first formula. I do not recommend it.

Not built: the actual editor UI (the grid is owned by the sheets-integration
session). The converter is ready to plug into the formula bar.

## 6. Spec amendments

**All decided on 2026-11-27** (see [Decisions of 2026-11-27](#7-decisions-of-2026-11-27)):
P1 rejected, everything else accepted, P29 in a changed form. The current
status of each one is in the spec's Appendix D.1; the table below is the
evidence as it was proposed.

| Id | Proposal | Why (evidence) |
|---|---|---|
| P1 | ~~Grid row numbering: header = row 1~~ **Rejected** (Wouter): spec §7.1 stands | Import/export map rows instead; `spreadsheet-core` row counting is a bug |
| P29 | Frontmatter addresses use YCSV rows; header = row 0. **Accepted in changed form:** the formula ref grammar (`product0:totaal0`) | `B3` must mean one cell in `cells` and in formulas; changes example 9.3 |
| P31 | Header in the CSV body; `columns` is enrichment — **accepted**. Matching rule C1–C5 is a proposal | Wouter; see "CSV first" |
| P32 | `.csv` stays CSV until a YCSV-only feature; editor asks — **accepted**. Dialect kept, `=` is text in CSV: proposals | Wouter; needs collab for `.csv` |
| P30 | Empty rows keep their number (**accepted**) | §7.2 renumbered formulas on every Excel import with blank rows; now replaced |
| P2 / P27 | Explicit `header: true\|false` — **accepted** (Wouter); detection rules D1–D7 in §4.1 | A-Z files misread by proto; detection guesses |
| P3 / P17 | Sheet refs: Unicode grammar; `hidden`, `tab_color`, array order | Example 9.4 fails in core; fixtures |
| P4 | Excel grammar: `$`, rectangular ranges, whole columns, `&`, postfix `%`, Excel precedence, case-insensitive compare, same-row refs | 37 fixture formulas; precedence and `%` tests |
| P5 | Leading `'` = literal text | No other way to store `=text` or `'007` |
| P6 | Percent stored as fraction | §6.3 makes `=200*p1` = 10000; every import/export would rescale |
| P7 | Dates as serial numbers in formulas; floating local datetimes | One-hour offsets from local `Date` |
| P8 | Canonical number grammar in the body | Dutch CSV corruption; ambiguity of `1,234` |
| P9 | Per-cell `type`/format; `excel_format` passthrough | Report sheets mix types per column |
| P10 | `merges` | Fixtures |
| P11 | `freeze`, column `width`/`hidden` | Fixtures; row heights excluded by decision 6 |
| P12 / P28 | Ref grammar; quoted refs for names ending in a digit; duplicates are an error | `kw1` + row 2 = `kw12` |
| P13 | Defs may be ranges | Excel named ranges |
| P14 | `notes` (plain text) | Fixtures |
| P15 | Validation: `list` from a range, whole-number bounds (`range_value`, now `range.integer`, K7) | Fixtures |
| P16 | `italic`, `underline`, `align`, `wrap` | Common in real sheets |
| P18 | Hyperlinks as `=HYPERLINK()` | Fixtures |
| P19 / P26 | Trailing empty rows carry no meaning | Both parsers drop them |
| P20 | Errors stored as formulas (`=NA()`) | `#N/A` text is ambiguous |
| P21 | Explicit v1 function list; `_xlfn.`; `source_formula` | formulajs gaps; Google shape |
| P22 | Split on `---` only outside quoted fields | Both parsers break |
| P23 | CR inside cells → LF | Proto strips, core keeps |
| P24 | Readers strip BOM | Excel "CSV UTF-8" |
| P25 | YAML 1.2 core schema | `no`, `010` |
| — | Unknown sheet / cycle = per-cell error | One bad cell must not block a workbook |
| — | CSV import with explicit locale | Silent corruption shown above |
| — | Export: correct cached values or none | LibreOffice shows cached values as they are |

Row numbering is decided: P1 is rejected and §7.1 stands, P30 and P29
(changed form) are accepted. Still to do: **fixing `spreadsheet-core`**,
whose engine counts rows against §7.1.

### Header flag and detection

**Decision (Wouter):** "header true lijkt me een mooie aanpak". P2/P27 is
accepted and written into spec §3, §3.1, §4.1 and A.5.

- **The flag:** `header: true|false`, at the top level of a single-sheet file
  and per entry in `sheets`. The flag wins; writers always write it. The
  spike importer already writes it for every XLSX, ODS and Numbers sheet.
- **Detection:** it only runs when the flag is missing, for example on a
  plain CSV, which counts as valid YCSV. Its result is recorded as the flag.
  Rules, first match wins:

  | Rule | When | Result |
  |---|---|---|
  | D1 | Row 1 missing or fully empty | no header |
  | D2 | `columns` defined: every row-1 value matches a column `ref` or `name` | header, else no |
  | D3 | Fewer than two non-empty rows | no header |
  | D4 | A row-1 value is empty, a number, an ISO date/time, a boolean, a formula or a `'` literal | no header |
  | D5 | Duplicate row-1 values | no header |
  | D6 | A column has numbers, dates, booleans or formulas below row 1 | header |
  | D7 | All text: header unless a row-1 value repeats in its column | header / no |

  The prototype is `interop/csv/detect-header.ts`, with 13 cases in
  `detect-header.test.ts`. They include:
  - spec 9.1 (no header, A-Z);
  - `Totaal,2026,2027` as a first row;
  - an empty header cell;
  - duplicate names;
  - an all-text contact list;
  - `columns` matched by ref or display name.
- **Known weak spots:**
  - An Excel export with one empty header cell (D4) is read as no header.
  - An all-text list without a header whose first row never repeats (D7) is
    read as having one.
  - Both are cases where the user toggles. The XLSX importer uses the same
    idea plus "no merged cell in row 1".
- **Toggling "first row is header"** renumbers only the file form:
  - On: data row 1 becomes the header and the rest moves up by one.
  - Off: the header becomes row 1 and the rest moves down by one.

  Formulas in the Yjs model point at row ids, so what they point at does not
  change; the writer only prints new numbers. When the header is switched
  off, the writer keeps the column refs in `columns`, with the old header
  text as `name`, so `prijs3` keeps working instead of turning into `C4`.
  Neither the model nor the toggle was built in this spike; the grid is owned
  by the sheets-integration session.
- **Since decided:** the header stays in the body (P31), and a `.csv` stays
  CSV until a YCSV-only feature is used (P32). See
  [CSV first](#csv-first-header-in-the-body-csv-stays-csv). P30 is
  accepted too (empty rows keep their number).

### CSV first: header in the body, `.csv` stays CSV

**Decisions (Wouter), written into the spec as accepted:**
- **P31:** the header row stays in the CSV body, and `columns` is an
  optional enrichment (spec §4). A plain CSV with a header row is a complete
  sheet. `columns` adds `ref`, `type`, format and validation; people who
  type source can start with a bare CSV.
- **P32:** a `.csv` edited in our editor stays a plain CSV while only values
  change (spec §2.4). The first YCSV-only feature is the trigger, and the
  editor asks first. The features: a formula, a type or format, a style,
  validation, a note, a merge, a def, a second sheet, a chart, or a header
  choice that differs from detection.

**Proposal: matching `columns` to the CSV columns (spec §4.3, C1–C5).** I
checked the suggested pure-position rule (header text = display name,
`columns` by position) against two write paths:

| Write path | Pure position | Proposed: ref = header text first, then position |
|---|---|---|
| Hand-typed source, header `product,prijs`, refs the same | works | works |
| Hand-typed, a column moved in the source | types, validation and formula targets move to the wrong column, silently | columns follow their header |
| Outside tool (CSV editor, script, Excel over DAV) reorders columns | silently wrong | follows, except for columns whose header text is not their ref; those attach by position **with a warning** |
| Outside tool renames a header | still right (position unchanged) | falls back to position, so still right |
| Outside tool adds a column | the new column takes the next definition if it sits in the middle (wrong) | untyped new column, ref = header text (P33) |
| Outside tool removes a column | the definitions after it shift onto the wrong columns | the definition is unused, with a warning; formulas using it give `#REF!` |

So I propose:
- **C1:** with a header row, the header text is the display name.
  `columns[i].name` is ignored (warn when it differs), and writers do not
  write it.
- **C2:** match by `ref` = header text (normalised).
- **C3:** then by position.
- **C4:** extra columns are untyped; extra definitions are unused, with a
  warning.
- **C5:** without a header, position only, and `name` is the display name.

Writers give a new column `ref` = its header text (P33, below), so C2
keeps working and the writer need not write `ref` at all.

Prototype: `interop/csv/resolve-columns.ts`. Its 9 cases cover hand-typed,
reordered, display-name, renamed, added and removed columns, `name` under a
header, and no header. The case where an outside tool reorders two columns
with display-name headers is the one weak spot, and it warns.

**Build consequence of P32.** `.csv` needs real-time collaboration like
`.ycsv`, so it needs a Yjs sidecar:
- **Client:** `DOCS_COLLAB_TEXT_EXTENSIONS` in
  `packages/apps/src/lib/files/docs-collab-text-files.ts` (main) already
  lists `csv`, but routes it to the Docs text editor. Routing must send
  `.csv` and `.ycsv` to Sheets, or offer both.
- **Server:** `CollabDocFormats` in
  `packages/api/app/Services/Drive/CollabDocFormats.php` (main) knows only
  `md` and `markdown`. `csv` and `ycsv` need a sheet doc type there before a
  sidecar `.<name>.csv.yjs` is accepted.
- **Outside writes:** the external-write detection that Docs and Notes use
  must also cover the CSV, so that an outside write rebuilds the Yjs sheet.
- **Writing the file back:** it must keep the CSV's dialect (separator,
  line endings, BOM, quoting, number format). That part is a proposal in
  §2.4. It matters because the Dutch Excel CSV uses `;` and the decimal
  comma, and Excel must be able to read the file again.

**Proposed with P32, not decided:**
- **Dialect preservation:** see the last point above.
- **`=` is text in a plain `.csv`:** a value starting with `=` is text,
  because CSV has no formulas; typing a formula is the trigger.

### Refs from the header text (P33, P34)

Wouter: "de koprij bovenaan was ook fijn omdat je dan named header rows hebt
zonder frontmatter, waarnaar je kunt verwijzen in formules." Both parts are
written into the spec as proposals.

**P34: frontmatter is optional in `.ycsv` too** (spec §2, A.2). A file has
frontmatter only when its first line, after an optional BOM, is exactly
`---`. Otherwise the whole file is one CSV body with a detected header,
refs from the header text and formulas allowed:

```
product,prijs,aantal,totaal
Appels,0.45,6,=prijs1*aantal1
Brood,2.99,2,=prijs2*aantal2
```

In such a file a `---` line is data (writers quote it as `"---"`), and a
second sheet needs frontmatter. Today the spec makes frontmatter mandatory
and a missing `---` an error.

**P33: refs from the header text alone** (spec §4.4, folded into P12/P28).
There is nowhere to store a generated ref, so every reader must derive the
same ref from the text. Two options:

| | Normalise (slug) | Text as ref, quoted when needed (proposed) |
|---|---|---|
| `Prijs incl. BTW` | `prijs_incl_btw3`: not what the user sees | `'Prijs incl. BTW'3` |
| `kw1` | still ends in a digit, so needs a suffix (`kw1_`) or quoting anyway | `'kw1'3` |
| `Prijs-incl` and `Prijs incl` | collide after slugging | distinct |
| `categorieën` | needs a choice: keep letters or transliterate (differs per library) | `categorieën3` as is |
| Hand-typed `prijs` | `prijs3` | `prijs3` |

So the proposal keeps the text (H1: NFC, trimmed, whitespace folded) and
uses the existing quoted-ref syntax of P12/P28 (H2). Refs compare
case-insensitively (H3), like Excel and LibreOffice names; that changes
"case-sensitive" in P12/P28. Empty headers (H4) and duplicate headers (H5,
all of them, not "first wins") get no name and fall back to their letter
(H6) with a warning. A positional suffix for duplicates (`naam_2`) was
rejected: when a column moves, formulas would silently follow the wrong
column.

**Tests** (`interop/csv/header-refs.ts`, 14 cases):
- the H1–H6 cases above, each checked as A1 → YCSV → A1 through the
  importer's translator (`a1ToYcsv`, `ycsvToA1`);
- the corpus: every header row of every CSV in `interop/fixtures/` (studio
  workbook from Excel, LibreOffice and Numbers, the Google shape, the
  Numbers natives, hand-made CSVs). All round-trip. Headers that need
  quoting there: `BTW tarief`, `Overzicht Q1 2026`, `Table 1`, and `0.21` and
  `21%` (rows 1 that detection rejects as headers anyway);
- the hand-typing case (`product,prijs,aantal` → `prijs3`), and
  `prijs3` finding the header `Prijs`.

`resolve-columns.ts` (C2) compares refs with the same rule. Since P33 was
accepted, the XLSX importer writes the header text as the ref (`BTW tarief`,
`Prijs`) instead of a slug. The prototype still accepts a slug match for
older files; the spec does not (C2 matches `ref` or `name`, K13).

**Renaming a header** (spec §4.4):
- **Hand-edited file, no `columns`:** formulas with the old name give
  `#REF!` with a warning. The reader cannot tell a rename from a removed
  plus an added column. This is tested.
- **With `columns`:** the ref stays pinned; the column attaches by position
  with a warning, and formulas keep working.
- **Our editor:** safe. Yjs keeps formulas by column id, and the writer
  writes the new name into every formula. Proposal: always do this, so a
  file reads the same with and without frontmatter.
- **Outside tool renames:** like hand-editing. Proposal: when exactly one
  header changed at the same position since the last version the editor
  saw, offer to rename the ref in the formulas; never do it unasked.

## 7. Decisions of 2026-11-27

Wouter went through the proposals one by one. The spec copy
(`upstream/ycsv-spec-v1.md`) now has every decision written into the
sections it touches, with a one-line "Spike 11 decision" note under each,
and the decision record in Appendix D (status per proposal, conflicts,
original texts). `upstream/ycsv-spec-v1-clean.md` is the same text without
the notes and without Appendix D. Neither is on main.

**Accepted explicitly:** P33 and P34 as proposed; P29 in a changed form;
P4 (with `%` as postfix percent, `-2^2` = 4, left-associative `^`,
case-insensitive text comparison); P5; P6 ("percentage is puur een rendering
ding": the file holds the fraction, `%` is display only, `10%` typed in a
source cell is read as 0.1); P22 (writers quote any cell containing a `---`
line). **Accepted in bulk:** every other proposal, unless it conflicts with a
decision. Earlier decisions stand: P1 rejected; P2/P27, P30, P31, P32
accepted.

### P29 in its changed form

Frontmatter addresses (`cells`, `merges`, `notes`, validation `at`) use
exactly the formula ref grammar: header names plus YCSV row numbers, header
row = row 0. `product0:totaal0`, not `A0:D0`. Letters only where a column
has no ref (P33 H6). No separate `header:` style key. Example 9.3 now styles
its header with `product0:totaal0`.

**YAML check** (`interop/csv/yaml-keys.test.ts`, 15 cases, `yaml` 2.x with
`version: "1.2"`):
- valid as plain keys: `product0:totaal0`, `prijs3`, `$prijs$3`,
  `prijs$1:$totaal$3`, `totaal:totaal`, `categorieën1:categorieën3`,
  `Größe1`, `producten!totaal1:totaal5`, `on`, `null3`;
- invalid YAML when written bare: `'Prijs incl. BTW'3:` and
  `'kw1'2:'kw2'4:`; the parser reports an error, so a reader can say which
  key, not miss it silently;
- the whole key double-quoted (`"'Prijs incl. BTW'3":`) works, and
  `YAML.stringify` writes exactly that by itself, while it leaves plain
  refs unquoted;
- flow style (`{ style: { bold: true } }`) reads as normal YAML.

**Code:** the importer writes addresses in the ref grammar
(`a1ToYcsv` per address); the exporters resolve them through `ycsvToA1`
into a per-cell index, and an address that names no cell throws an error
naming the key. Validation rules use `at` + `range` (K7). All checks are
unchanged: 37/37 formulas round-trip as text, 135/135 identical values in
LibreOffice from the exceljs export, and the same number of re-import line
differences per file as before (their content changed: `at:` instead of
`range:`, refs instead of letters).

### Conflicts

"Old §" is the section numbering before this round; "Where" is the new numbering.

| # | Conflict | Resolved as (direction of the decisions) | Where |
|---|---|---|---|
| K1 | P12/P28: refs are identifiers, case-sensitive, duplicates are an error — vs P33 (any text, quoted; case-insensitive; duplicate headers lose their name with a warning) | P33 wins. Refs are any text, case-insensitive, unique case-insensitively. Duplicate header texts in a file from elsewhere: no name, letter fallback, warning. | §4.4, §8.2 |
| K2 | Product decision 10 renames a duplicate to header `omzet 2` with ref `omzet_2` — vs P33 (the ref is the header text) and P34 (no frontmatter unless needed) | The rename stays (`omzet 2`, then the first free number; the later column by column id), but its ref is the header text: `'omzet 2'3`. A ref `omzet_2` would need `columns.ref` in frontmatter only for this. **Wouter to confirm.** | §4.4 |
| K3 | P2/P27 "writers always write `header`" — vs P34 "frontmatter only when needed" | `header` is written whenever frontmatter is written; frontmatter is written for `header` only when detection would be wrong. | §3.1, §4.1 |
| K4 | Old §3 / A.3 / A.10: `ycsv_version` required, missing = hard error — vs P34 (frontmatter optional) | A file without `ycsv_version` (with or without frontmatter) is version 1. Writers write it whenever they write frontmatter. | §3.1, §14, A.10 |
| K5 | P9, P10, P14, P15, P21 and the old §3.5 use A1 addresses (`cells.<A1>`, `merges: [A1:D1]`, `notes: {A1: …}`, `range: B2:B6`, `cells.<A1>.source_formula`) — vs P29 as decided (formula ref grammar) | Every frontmatter address uses the ref grammar (`product0:totaal0`, `prijs3`); letters only for columns without a ref. | §3.6–§3.8 |
| K6 | Old §3.5: a bare column ref as a `cells` key (`totaalwaarde`) = the whole column — vs P29 "exactly the formula grammar", where a bare ref means the same row (P4) | In an address a bare ref is accepted as the whole column (an address has no "same row"); writers write the formula form `totaalwaarde:totaalwaarde`. | §3.6 |
| K7 | P15: sheet-level rules put the address in `range` and bounds in `range_value` — vs old §3.1.2, where `range` already means numeric bounds | Sheet rules use `at` for the address and the column-rule fields for the rule; `range` gains `integer`; `range_value` is dropped. Spike importer/exporter changed to match. | §3.3.2 |
| K8 | P8 "a value outside the number grammar is text" — vs P6 "readers may accept `10%` typed in a source cell" | The number grammar accepts a trailing `%` on read (`10%` → 0.1). Writers write the fraction. | §6.3, §7 |
| K9 | P24 (writers never write a BOM), P23 (writers emit LF), P8 (writers use `.`) — vs P32 detail "keep the CSV dialect" | Those writer rules are for `.ycsv`; a `.csv` written back keeps its dialect, BOM and line endings included. | §2.2–§2.4 |
| K10 | Old §8.2 "letters and names may be mixed" (`=A1*B1` next to `=aantal1*prijs1`), and the §8.5 example `prijzen!A1:B10` — vs P33/H6 and P29 (letters only where a column has no ref) | Letters are refs only for columns without a ref. Example 8.5 rewritten with refs. | §4.2, §8.2, §8.5 |
| K11 | Old §13: column widths and frozen panes live in the `.ycsv.ui` sidecar — vs P11 and the editor decision "frozen rows are shared and live in the file" | Widths, hidden columns and freeze are in the file; the sidecar keeps only per-user view state. | §3.8, §13 |
| K12 | Old §3.2: `ref` is "lowercase, no spaces" — vs P12/P33 | Any text (§8.2). | §3.3 |
| K13 | C1 (bulk-accepted: `name` is ignored under a header, writers do not write it) + C3 (warn when header ≠ ref) — vs example 9.3 (display names through `name`) and D2 (header detection already matches `name`) | C2 matches a definition by `ref` **or** `name`; under a header, `name` is the expected header text, and writers write it when the header text differs from the ref. Display is still the header text. Without this, every file with display-name headers warns. | §3.3, §4.3, §9.3 |
| K14 | Old §3.3: column refs take precedence over defs of the same name — vs P33 (any header becomes a ref, so a header can silently shadow a def) | Precedence kept; readers warn when a def and a column ref of a sheet share a name. | §3.4 |
| K15 | P11 "row heights are not stored" — vs the editor decision "fixed row height in v1, with room in the format for a per-row height later" | v1 stores none; `row_heights` is reserved and ignored by v1 readers. | §3.8, §14 |
| K16 | Old §11.1 example `SUM(producten!totaal1:producten!totaal10)` — vs P4 "cross-sheet ranges name the sheet once" | Writers write the sheet once; readers accept the repeated prefix when both name the same sheet. | §8.3, §11.1 |
| K17 | Old A.6 resolves `./<file>.ycsv!<ref><row>` — vs §2/§11 "cross-file references are not supported" (an old inconsistency, not from a proposal) | Removed from A.6. | A.6 |
| K18 | Examples in P4, P13 and P15 use A1 row numbers (`$id$2:$korting$4`, `totaal2:totaal6`) — vs §7.1 (P1 rejected) | Rewritten with YCSV rows (`$id$1:$korting$3`, `totaal1:totaal5`). | §3.3.2, §3.4, §8.3 |
| K19 | Old §2.4 "a file without frontmatter has no formulas" — vs P34 (a `.ycsv` without frontmatter may hold formulas) | The extension decides: a `.csv` has no formulas (`=` is text); a `.ycsv` without frontmatter may hold them. | §2, §2.4 |
| K20 | A.10 "unknown frontmatter field: ignore silently" — vs P29 "readers give a clear error, not a silent miss" and B.7 "no silent loss" | Unknown fields are still ignored (forward compatibility, §14); a bad address in a known field is an error naming the key, the entry is skipped and the file still opens. | §3.6, A.10 |
| K21 | Old §8.7, §11.2, A.6, A.10: circular and unknown-sheet references are hard errors — vs B.5 "errors, not aborts" (bulk) | Per-cell `#REF!` / `#CIRC!`. | §8.7, §11.2, A.10 |
| K22 | Old §8.6 `%` is modulo; §5/§6.3 percent stored as 50 — vs P4 and P6 (accepted) | `%` is postfix percent; percent is a fraction. (Direct replacements, listed for completeness.) | §5, §6.3, §8.6 |

**K2 needs Wouter.** Product decision 10 says the renamed duplicate gets ref
`omzet_2`. Under P33 the ref is the header text, so the renamed column `omzet
2` has the ref `omzet 2` (`'omzet 2'3` in formulas). Keeping `omzet_2` would
mean writing `columns.ref` (and `name`) in the frontmatter for that column
only, which goes against P34. I wrote the P33 form into the spec. If the
underscore form matters (shorter formulas), the alternative is to rename the
header itself to `omzet_2`.

**K13 is a real change to C1.** As bulk-accepted, C1 ignored `name` under a
header and C3 warned whenever a header text differed from its ref. Then every
file with display-name headers ("Prijs ex. BTW") would warn on every read,
and spec example 9.3 could not be written without warnings. Letting C2 match
`name` too fixes both and reuses what D2 (header detection) already does.

### Editor decisions that touch the format

| Decision (Wouter) | What it means for the file | Spec |
|---|---|---|
| Formulas shift column names on fill and paste right; `$` locks | Writers write the shifted ref (`prijs1` → `aantal1`); `$` markers are stored (P4) | §8.2, §8.9 |
| Cut + paste rewrites references to the moved cells | Formulas **and** frontmatter addresses are rewritten | §3.6, §8.9 |
| Frozen rows are shared and live in the file | `freeze` per sheet; not in the UI sidecar (K11) | §3.8, §13 |
| Fixed row height in v1, room for a per-row height later | No row heights stored; `row_heights` reserved, ignored by v1 readers (K15) | §3.8, §14 |
| Formula input and display follow the browser locale (`=ROUND(3,27;1)` in nl-NL); the file stays canonical; function names stay English | B.6 as written; the converter is `interop/notation/notation.ts` | §8.8 |

### Clean spec and version

`upstream/ycsv-spec-v1-clean.md`: the spec without proposal markers, spike
notes, P-ids or Appendix D. Its own appendices: A (parser algorithm,
updated), B (writer rules in one place, new), C (import and export, from
B.7).

**Version: v1.0, not v1.1.** v1 has not been released; the only v1 files are
test fixtures. Several decisions are not backward compatible (percent as a
fraction, `%` as percent instead of modulo, empty rows numbered, addresses
in the ref grammar, refs case-insensitive). A minor bump to 1.1 would tell
readers that v1.0 files still mean the same thing, which they would not. If
v1.0 had shipped, these changes would need `ycsv_version: 2`.

**Added by me, not decided** (marked in the spec copy):
- §12: a ref with `.`, `[` or `]` must be escaped in a Vega-Lite `field`
  (`"Prijs incl\\. BTW"`), because Vega-Lite reads `.` as a nested field.
  A consequence of P33.
- Appendix B (writers) only collects rules that are elsewhere.
- The "edge semantics" in §4 of this report (text inside ranges, booleans in
  SUM, comparing at 15 significant digits) are **not** in the spec; only
  blank cells and case-insensitive comparison are, because P4 and P30
  cover them.

### Conformance after the decisions

The cases the decisions settle now carry a "decided 2026-11-27" note and an
expectation (`interop/conformance/cases.ts`): P4 grammar (`x01`–`x06`,
`x16`, `s06`), per-cell errors (`s07`, `x08`), P5 (`t08`), P6 (`t02`, `t04`),
P7 (`t05`), P12/P33 (`c05`, `c07`), P23 (`e04`), P24 (`e03`), P25 (`f07`),
P34 (`f01`, `f03`), invalid YAML (`f05`), D2 (`c08`), blank cells (`x09`).
Result: the spec decides 57 of 70 cases; core passes 16 (33 with the row
shift), the prototype 24. Still silent: surplus CSV blocks (`s08`, `s09`),
quote in mid-field (`q03`), ragged rows (`q04`), spaces around values
(`q06`), `a0` and refs past the end (`r02`, `r03`), time zones (`t06`),
currency without a code (`t07`), duplicate `columns` refs (`c06`), float
precision (`x11`). The "spec" column of the corpus still names the old
section numbers.

## Open questions

1. ~~Should empty rows keep their row number (P30)?~~ **Decided: yes**
   (Wouter: "A!"). See [Row numbering decision](#row-numbering-decision).
   The example he compared, now the rule:

   ```
   post,bedrag
   Huur,1250
   Stroom,90
   ,
   Totaal,=SUM(bedrag1:bedrag3)
   ```

   The blank line is row 3 and the total is row 4 (`bedrag4`), as Excel
   numbers it minus the header. `SUM` over the blank row ignores it.
2. **How does the grid label the header row?** Wouter's decision mentions
   that the visible numbering "can start at 2". That works only if formulas
   also say 2 for that row, which is P1, now rejected. With §7.1, a grid that
   shows 2 next to the row that formulas call `prijs1` breaks the one
   constraint: `totaal3` would point at the row labelled 4.

   Recommendation: no number on the header row, as Numbers does it, and 1 on
   the first data row. If the header must show a number, it is 0 and not 1.
   This needs Wouter's confirmation, because it is visible UI.
3. **K2: ref of a renamed duplicate column.** `'omzet 2'3` (the header
   text, as written into the spec) or `omzet_2` (product decision 10, needs
   frontmatter for that column)? See [Conflicts](#conflicts).

## Not verified

- **No real Excel or real Google Sheets.** All fixtures were written by
  exceljs or converted by LibreOffice. `google-shape.xlsx` imitates the
  DUMMYFUNCTION shape; it is not a real Google export. Excel's own
  behaviour (its CSV, its recalculation, its reading of our exports) was not
  checked.
- **Apple Numbers:**
  - Our own XLSX export was not opened in Numbers (automation failed; see
    "Export to Apple Numbers"). The claim that Numbers opens it well rests on
    the same-shape exceljs file.
  - The Numbers fixtures are small. Numbers features outside them were not
    tried: charts, pop-up menus, sliders, steppers, ratings, durations,
    categories, pivot tables, and mixed-content tables.
  - The `.numbers` reader crash seen once was not reproduced or explained.
  - Only Numbers 15.1 was checked. Numbers 14.5 is also installed on this
    Mac and was not compared.
- **Real Dutch Excel CSV:** the CSV case was built to match what Excel nl-NL
  writes (`;`, decimal comma, `dd-mm-yyyy`), not taken from Excel itself.
- **LibreOffice headless:**
  - it did not write frozen panes when converting to XLSX and ODS, so freeze
    could only be tested on the exceljs file;
  - it writes booleans as `TRUE()`.
- **Not built:**
  - conditional formatting (import or export);
  - charts, images, pivots, comments threads;
  - tab colour on export;
  - writing back `source_formula`.
- **No browser or Web Worker run:** sizes and timings are from Node. Bundle
  size in the app, and parsing 10 MB files without blocking the UI, are
  untested.
- **No editor UI** for the notation converter.
- **Nothing in the engine was fixed.** The function misses are measured, not
  repaired.
- **Arrays in formulas:** array constants (`{1,2;3,4}`) and their nl-NL
  form are not handled by the notation converter. The nl-NL array separators
  were not checked against Excel.

## Files

| Path | What |
|---|---|
| `upstream/` | Spec and `spreadsheet-core` snapshot (spec now has Appendix B) |
| `interop/adapters/` | Runs both parsers on the same input |
| `interop/conformance/` | 65-case corpus, round-trip properties, large files |
| `interop/fixtures/` | Fixture generator, fixtures (`files/`), exports (`out/`) |
| `interop/xlsx/` | Probe, A1 ↔ YCSV translator, importer, evaluator, exporter, end-to-end test |
| `interop/formulas/` | v1 function set vs LibreOffice; formulajs direct calls |
| `interop/notation/` | Canonical ↔ locale formula converter and tests |
| `interop/csv/` | Header detection (rules D1–D7), `columns` matching (C1–C5), refs from header text (H1–H6), tests |
| `interop/fixtures/files/numbers/` | Numbers 15.1 fixtures: `.numbers`, Numbers' XLSX and CSV exports |
| `interop/xlsx/numbers.test.ts` | Numbers values vs LibreOffice, `.numbers` read/write; opening in Numbers is opt-in (`NUMBERS_E2E=1`) |

Run (from `prototypes/ycsv`, LibreOffice must be installed):

```bash
pnpm install --ignore-workspace && node interop/fixtures/gen-fixtures.ts && npx vitest run interop
```
