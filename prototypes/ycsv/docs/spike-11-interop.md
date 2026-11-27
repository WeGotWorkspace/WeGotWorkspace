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

1. **Conformance.** The spec decides 35 of the 65 corpus cases.
   `spreadsheet-core` passes 12 of them and the prototype passes 15. The two
   parsers agree on only 16 of the 65. The largest single cause is row
   numbering:
   - **The prototype follows the spec**: the first data row is row 1.
   - **The core engine counts the header as row 1.** That is a bug against
     §7.1 (Wouter's decision, see [Row numbering](#row-numbering-decision)).
     With that bug simulated as fixed (refs shifted by one), it passes 20.

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
   row 1 under a header; §7.2 empty rows shift further). All checks still
   hold: 37/37 formulas round-trip as identical text, 29/37 engine values
   match, and the exceljs export gives 135/135 in LibreOffice. The constraint
   that matters: the grid shows the same number as the formulas use, so the
   header row is unnumbered. Two open questions for Wouter: should empty
   rows keep their number (P30), and how is the header row labelled in the
   grid? See [Open questions](#open-questions).
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
11. **Spec.** 32 proposals in Appendix B (P1 rejected; P2/P27, P31, P32
    accepted). The ones that matter
   most:
   - **P29**: frontmatter addresses (`cells`, `merges`, `notes`) use the same
     row numbers as formulas, with the header as row 0.
   - **P6**: percent stored as a fraction.
   - **P4**: Excel formula grammar: `$`, ranges, `&`, postfix `%`, precedence.
   - **P5**: a leading `'` marks literal text.
   - **P22**: split sheets only on a `---` line outside quoted fields.

## 1. Conformance corpus and round trips

The full table is in [spike-11-conformance-results.md](spike-11-conformance-results.md).
- **Corpus:** `interop/conformance/corpus/`.
- **Cases:** `interop/conformance/cases.ts`.
- **Runner:** `interop/conformance/run.test.ts`.

| | core (`spreadsheet-core`) | proto (`prototypes/ycsv`) |
|---|---|---|
| Spec-decided cases passed (of 35) | 12 (20 with its header-as-row-1 bug simulated as fixed) | 15 |
| Agree with each other | 16 of 65 | |
| Spec example 9.4 (`categorieën`) | fails: ASCII-only refs | fails: single-sheet only |
| `---` line inside a quoted cell | splits the sheet | splits the sheet |
| Empty-row numbering (§7.2) | not followed | not followed |
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
| A trailing fully empty row survives | **fail** (dropped) | **fail** (dropped) |
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
| `'Q1 overzicht'!B4` (no header, row 2 empty) | `q1_overzicht!B3` (A-Z refs; §7.2: the empty row has no number) |
| `Producten!E2:E6` | `producten!totaal1:totaal5` |
| `C1` (the header cell itself) | `prijs0` |
| a ref to a fully empty row | `#REF!`, logged (§7.2 gives it no number) |
| a column whose name ends in a digit or has spaces | `'kw1'1`, `'Zo Doen'1` (P12) |
| `BTW_TARIEF` (named range) | `btw_tarief` (def, P13) |
| `_xlfn.XLOOKUP(…)` | `XLOOKUP(…)` (prefix added back on export) |
| `Table1[Prijs]` (structured ref) | flagged, not translated |

### Row numbering decision

P1 (header = row 1, as in Excel) is **rejected**. Wouter's words: rows count
from 1 in the spec; in the CSV source the header can be line 1, and the grid
can start its visible numbering at the data. So:

- **The spec stands.** The first data row is row 1, the header is row 0
  (§7.1), and fully empty rows get no number (§7.2).
- **`spreadsheet-core` has a bug.** Its engine counts the header as row 1,
  against §7.1. It is not an alternative numbering, and it must be fixed
  before it ships. Its corpus score with that bug simulated as fixed is 20 of
  35.
- **Import and export map row numbers per sheet** (`rows` in
  `interop/xlsx/translate.ts`, `rowNumbers` / `toYRow` / `toA1Row`):
  - With a header in source row 1, Excel row 2 = YCSV row 1.
  - Each fully empty row above a ref lowers it by one more (Q1 sheet: Excel
    `B4` → `B3`).
  - On an empty row, a range start moves to the next row and a range end to
    the previous one. A single ref to an empty row becomes `#REF!` and is
    logged.
  - Export applies the inverse.
- **The checks still hold with the mapping:**
  - 37/37 formulas round-trip A1 → YCSV → A1 as identical text;
  - the engine matches the cached values in 29/37, as before;
  - the exceljs export gives 135/135 identical values after LibreOffice
    recalculates;
  - re-import is line-identical apart from tab colour;
  - the Numbers fixtures keep the same scores.
- **Frontmatter addresses (P29)** follow the same numbering. Header cells are
  row 0 (`cells: A0: …`). Styles on a fully empty row have no address; they
  are dropped and logged.

**The one constraint that matters.** The number the grid shows next to a row
must be the number a formula uses for it. Otherwise `totaal3` points at a
different row than the one labelled 3.

**Recommendation for the renderer:**
- Show the header row with **no row number**, like Numbers' header rows (and
  like the column header band in Excel). Number data rows from 1. The
  formula bar, the name box (`prijs3`) and error messages use the same
  number.
- Empty separator rows, while §7.2 stands, show no number either. The next
  data row continues the count.
- Copying cells to Excel or exporting is where the numbers change (Excel
  adds the header row). That is expected, and the export does the mapping.

**Open question 1 (Wouter): should empty rows keep their number?** §7.2
costs a lot for little:
- every Excel import with a blank row renumbers formulas; even the label
  text "50%*B4" in the studio sheet now sits next to `=50%*B3`;
- the grid skips numbers;
- typing a value into an empty row renumbers every row below it, and every
  formula pointing there must be rewritten.

Both parsers ignore §7.2 today. I recommend numbering empty rows like any
other row (P30). This is separate from the rejected header part of P1.

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

All of them are in `upstream/ycsv-spec-v1.md`, Appendix B, marked
**Proposal (spike 11)**.

| Id | Proposal | Why (evidence) |
|---|---|---|
| P1 | ~~Grid row numbering: header = row 1~~ **Rejected** (Wouter): spec §7.1 stands | Import/export map rows instead; `spreadsheet-core` row counting is a bug |
| P29 | Frontmatter addresses use YCSV rows; header = row 0 (`A0:D0`) | `B3` must mean one cell in `cells` and in formulas; changes example 9.3 |
| P31 | Header in the CSV body; `columns` is enrichment — **accepted**. Matching rule C1–C5 is a proposal | Wouter; see "CSV first" |
| P32 | `.csv` stays CSV until a YCSV-only feature; editor asks — **accepted**. Dialect kept, `=` is text in CSV: proposals | Wouter; needs collab for `.csv` |
| P30 | Empty rows keep their number (**open question 1**) | §7.2 renumbers formulas on every Excel import with blank rows; neither parser follows it |
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
| P15 | Validation: `list` from a range, `range_value` | Fixtures |
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

Row numbering is decided: P1 is rejected and §7.1 stands. What is still open:
- **Open question 1:** P30, whether empty rows keep their number;
- **P29:** confirming that frontmatter addresses use the same numbering,
  which changes example 9.3 to `A0:D0`;
- **fixing `spreadsheet-core`**, whose engine counts rows against §7.1.

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
  [CSV first](#csv-first-header-in-the-body-csv-stays-csv). P30 is still
  open.

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
| Outside tool adds a column | the new column takes the next definition if it sits in the middle (wrong) | untyped new column, ref = slug(header) |
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

Writers give a new column `ref` = slug(header text) so that C2 keeps
working; renaming a header later keeps the ref.

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

## Open questions

1. **Should empty rows keep their row number (P30)?** Recommended: yes.
   Details are under [Row numbering decision](#row-numbering-decision).

   What a blank row looks like in the source: a line with only commas
   (`,,`), or an empty line. Both are a fully empty row. An example with a
   header and one blank separator line:

   ```
   post,bedrag
   Huur,1250
   Stroom,90
   ,
   Totaal,=SUM(bedrag1:bedrag2)
   ```

   | Line in the source | §7.2 as written | P30 (blank rows numbered) |
   |---|---|---|
   | `post,bedrag` | header (row 0) | header (row 0) |
   | `Huur,1250` | row 1 | row 1 |
   | `Stroom,90` | row 2 | row 2 |
   | `,` | no number | row 3 |
   | `Totaal,…` | row 3: `bedrag3` is the total | row 4: `bedrag4` is the total |

   - **Under §7.2:** the grid shows 1, 2, (blank), 3.
     - Typing anything into the blank line turns it into row 3, and every
       row below it, and every formula that points there, moves up by one.
     - An Excel import with blank rows needs renumbering: Excel calls the
       total row 5.
   - **Under P30:** the numbering is the line number minus the header line,
     and it never jumps.
2. **How does the grid label the header row?** Wouter's decision mentions
   that the visible numbering "can start at 2". That works only if formulas
   also say 2 for that row, which is P1, now rejected. With §7.1, a grid that
   shows 2 next to the row that formulas call `prijs1` breaks the one
   constraint: `totaal3` would point at the row labelled 4.

   Recommendation: no number on the header row, as Numbers does it, and 1 on
   the first data row. If the header must show a number, it is 0 and not 1.
   This needs Wouter's confirmation, because it is visible UI.

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
| `interop/csv/` | Header detection (rules D1–D7), `columns` matching (C1–C5), tests |
| `interop/fixtures/files/numbers/` | Numbers 15.1 fixtures: `.numbers`, Numbers' XLSX and CSV exports |
| `interop/xlsx/numbers.test.ts` | Numbers values vs LibreOffice, `.numbers` read/write; opening in Numbers is opt-in (`NUMBERS_E2E=1`) |

Run (from `prototypes/ycsv`, LibreOffice must be installed):

```bash
pnpm install --ignore-workspace && node interop/fixtures/gen-fixtures.ts && npx vitest run interop
```
