# Spike 11 — YCSV interop with Excel, Google Sheets and LibreOffice

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
   - **The core engine counts the header as row 1**, Excel-style. With its
     row numbers shifted to match, it passes 20.

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
6. **Spec.** 28 proposals, P1–P28, in Appendix B. The ones that matter most:
   - **P1**: grid row numbering, so the header is row 1.
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
| Spec-decided cases passed (of 35) | 12 (20 with rows shifted +1) | 15 |
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

Import log per fixture: `interop/xlsx/results.json`. Imported YCSV:
`interop/fixtures/out/*.ycsv`.

| Feature | XLSX (exceljs-made) | XLSX (LibreOffice-made) | ODS (LibreOffice) | Google shape | YCSV field |
|---|---|---|---|---|---|
| Values, text, numbers, booleans | survives | survives | survives | survives | body |
| Dates / times | survives (ISO) | survives | survives | — | body, P7 |
| Header row → refs + names | survives | survives | survives | survives | `columns`, P2 |
| Formulas (text) | 36/36 | 37/37 | 37/37 | 2/2 | body, P4 |
| Formulas (value, core engine vs cached) | no cached values | 29/37 | 29/37 | 2/2 | — |
| Postfix `%` | degrades (needs P4) | degrades | degrades | — | P4 |
| Named ranges | survives | survives | survives | — | `defs`, P13 |
| Number formats → type | survives | survives | percent display lost | survives | `type`, P9 |
| Exact format code | `excel_format` | `excel_format` | `m/d/yy` (SheetJS) | — | P9 |
| Per-cell formats in report sheets | survives | survives | survives | — | `cells`, P9 |
| Bold | survives (raw XML) | survives (raw XML) | **lost** | — | `style.bold` |
| Fill colour | survives | survives | lost | — | `style.fill` |
| Italic, font size, alignment, borders | lost | lost | lost | lost | P16 |
| Rich text runs | degrades (plain text) | degrades | degrades | — | — |
| Merged cells | survives | survives | survives | — | P10 |
| Frozen panes | survives | lost (LibreOffice did not write them) | lost | — | P11 |
| Column widths / hidden columns | survives | survives | lost | survives | P11 |
| Row heights | lost (decision 6) | lost | lost | — | — |
| Hidden sheets | survives | survives | lost | — | P17 |
| Tab colour | survives | survives | lost | — | P17 |
| Data validation (list from range, whole numbers) | survives | survives | lost | — | P15 |
| Conditional formatting | lost (not built) | lost | lost | lost | — |
| Notes | survives (author dropped) | survives | survives | survives | P14 |
| Hyperlinks | survives as `=HYPERLINK()` | survives | survives | — | P18 |
| Error values | survives as `=NA()` | survives | survives | — | P20 |
| Autofilter / print areas | — | lost | — | — | — |
| Google-only functions | — | — | — | degrades: cached value + `source_formula` | P21 |
| Charts, images, pivots | not in fixtures | | | | — |

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
| `C2` (header in row 1, column C = `prijs`) | `prijs2` |
| `$C$2`, `$C2`, `C$2` | `$prijs$2`, `$prijs2`, `prijs$2` |
| `C2:C6` | `prijs2:prijs6` |
| `A2:C4` | `id2:korting4` (rectangular, P4) |
| `E:E` | `totaal:totaal` |
| `'Q1 overzicht'!B4` | `q1_overzicht!B4` (no header → A-Z refs) |
| `Producten!E2:E6` | `producten!totaal2:totaal6` |
| a column whose name ends in a digit or has spaces | `'kw1'2`, `'Zo Doen'2` (P12) |
| `BTW_TARIEF` (named range) | `btw_tarief` (def, P13) |
| `_xlfn.XLOOKUP(…)` | `XLOOKUP(…)` (prefix added back on export) |
| `Table1[Prijs]` (structured ref) | flagged, not translated |

The mapping depends on P1: with grid numbering, the digits never change.
With the spec as written (first data row = 1), every import and export must
subtract or add one, and every row number in a formula a user copies from
Excel is off by one.

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
| P1 | Grid row numbering: header = row 1, empty rows keep their number | Excel/LO/Sheets; example 9.3; core engine already does it; A1 mapping stays digit-for-digit |
| P2 / P27 | Explicit `header: true\|false` | A-Z files misread by proto; detection guesses |
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

The decision that matters most is P1, because it changes the meaning of
existing files. Today the prototype model (`src/ycsv-model`) uses the spec's
numbering and the core engine does not. This needs a decision before either
one ships.

## Not verified

- **No real Excel or real Google Sheets.** All fixtures were written by
  exceljs or converted by LibreOffice. `google-shape.xlsx` imitates the
  DUMMYFUNCTION shape; it is not a real Google export. Excel's own
  behaviour (its CSV, its recalculation, its reading of our exports) was not
  checked.
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

Run (from `prototypes/ycsv`, LibreOffice must be installed):

```bash
pnpm install --ignore-workspace && node interop/fixtures/gen-fixtures.ts && npx vitest run interop
```
