# YCSV Specification v1.0

> **Spike 11 working copy.** This is the spec with every decision of spike 11
> written in, plus a short decision note under each section it touched and
> the decision record in Appendix D. The same text without notes is
> `ycsv-spec-v1-clean.md`. Evidence: `prototypes/ycsv/docs/spike-11-interop.md`
> and `prototypes/ycsv/docs/spike-11-conformance-results.md`.

> **YCSV** is a plain-text tabular data format: a CSV body, optionally led by
> a YAML frontmatter block. It adds column types, display formatting,
> styling, validation and spreadsheet formulas to CSV, without giving up
> human readability or compatibility with standard tooling.

---

## 1. Motivation

CSV is the universal language of tabular data. Every tool speaks it. But CSV
has no concept of column types, number formatting, or computed values. XLSX
solves this but is a binary format, hostile to version control and plain-text
workflows. YCSV adds exactly what CSV is missing — nothing more.

A plain CSV file with a header row is already a YCSV sheet. Its header names
can be used in formulas right away. Frontmatter is only needed for what CSV
cannot say: types, formats, styles, validation, more sheets, charts.

---

## 2. File format

> **Spike 11 decision:** **P34** (frontmatter optional, also in `.ycsv`) and **P22** (split only outside quoted fields; writers quote `---` lines) accepted. K19.

A YCSV file is either a single CSV body, or a YAML frontmatter block followed
by one or more CSV bodies, all separated by `---` lines.

**Without frontmatter** (one sheet):

```
product,prijs,aantal,totaal
Appels,0.45,6,=prijs1*aantal1
Brood,2.99,2,=prijs2*aantal2
```

**Single sheet with frontmatter:**

```
---
<frontmatter>
---
<CSV body>
```

**Multi-sheet:**

```
---
<frontmatter with sheets array>
---
<CSV body — sheet 1>
---
<CSV body — sheet 2>
```

**Frontmatter or not.** A file has frontmatter when its first line, after an
optional BOM, is exactly `---` (trailing spaces or tabs allowed, LF or CRLF).
The frontmatter ends at the next `---` line. Otherwise the whole file is one
CSV body:

- the file is a single sheet;
- whether the first row is a header is detected (§4.1);
- column refs come from the header text (§4.4), or are letters (§4.2);
- formulas are allowed.

In a file without frontmatter, a `---` line is data (a one-cell row), not a
separator. A second sheet needs frontmatter.

**Splitting bodies.** After the frontmatter, each further `---` line starts
the next CSV body, in the order of the `sheets` array. Only a `---` line
that is outside a quoted CSV field separates bodies; inside a quoted field it
is part of the value. Writers quote every cell whose value contains a line
that is exactly `---`, so readers that split naively still split correctly.

Cross-file references are not supported. All sheets must be in the same
file.

### 2.1 File extension

`.ycsv`. A `.csv` file is read as a YCSV file without frontmatter; see §2.4
for how editors write it.

### 2.2 Encoding

> **Spike 11 decision:** **P24** accepted (bulk). The no-BOM rule is for `.ycsv` only (K9).

UTF-8. Readers strip a leading UTF-8 BOM (Excel writes one in its "CSV
UTF-8" output). Writers of `.ycsv` files never write one.

### 2.3 Line endings

> **Spike 11 decision:** **P23** accepted (bulk). LF on write is for `.ycsv` only (K9).

LF (`\n`) preferred. CRLF (`\r\n`) tolerated, including on the `---` lines.
A CR or CRLF inside a quoted field is normalised to LF on read. Writers of
`.ycsv` files emit LF.

### 2.4 Plain CSV

> **Spike 11 decision:** **P32** accepted, with its details (keep the dialect; `=` is text in a `.csv`) accepted in bulk. K9, K19.

- **A plain CSV is a valid YCSV sheet:** one sheet, no frontmatter, header
  detected (§4.1).
- **A `.csv` stays a plain CSV while only values change.** An editor that
  opens a `.csv` writes it back as plain CSV, as long as the user only edits
  values, adds or removes rows and columns, or edits the header.
- **It becomes `.ycsv` only when a YCSV-only feature is used:** a formula, a
  type or format, a style, validation, a note, a merge, a def, a second
  sheet, a chart, or a header choice that differs from what detection would
  guess (a plain CSV cannot store `header`). At that moment the editor asks
  the user first. The answer is either "save as .ycsv" (a new file next to
  the CSV, or a rename) or "keep CSV" (the feature is not applied).
- **Keep the dialect.** A `.csv` written back keeps the separator (`,` or
  `;`), line endings, BOM, quoting style and number format it was read with,
  so the tools that made it can read it again. The `.ycsv` writing rules
  (§2.2, §2.3, §7) do not apply to it.
- **No formulas in a `.csv`.** A value starting with `=` in a `.csv` is text,
  because CSV has no formulas. Typing a formula is the trigger above. A
  `.ycsv` file without frontmatter may hold formulas.

### 2.5 YAML

> **Spike 11 decision:** **P25** accepted (bulk). Wouter: the editor writes block style; readers accept flow style as normal YAML.

The frontmatter is YAML 1.2, core schema: `no`, `on` and `yes` are strings,
and `010` is the decimal number 10, not octal. Readers accept any valid YAML,
including flow style (`style: { bold: true }`). Writers write block style
(indented mappings and lists).

---

## 3. YAML frontmatter

### 3.1 Fields

> **Spike 11 decision:** `ycsv_version` no longer required (K4); when writers write frontmatter (P34, K3). Section numbers in §3 changed: old §3.1 is §3.2, old §3.2 is §3.3, old §3.3 is §3.4, old §3.5 is §3.7.

All fields are optional.

| Field          | Type    | Description                                                                 |
| -------------- | ------- | --------------------------------------------------------------------------- |
| `ycsv_version` | integer | Spec version, `1`. A file without it is read as version 1. Writers write it. |
| `name`         | string  | Human-readable sheet name.                                                  |
| `description`  | string  | Free-text description.                                                      |
| `created`      | date    | ISO 8601 date.                                                              |
| `author`       | string  | Author name.                                                                |
| `defs`         | mapping | Named values referenceable in formulas and validation. See §3.4.            |
| `sheets`       | array   | Sheets of a multi-sheet file. See §3.2.                                     |

A single-sheet file may also carry every sheet field of §3.2 (except `ref`,
`hidden` and `tab_color`) at the top level: `header`, `columns`, `cells`,
`merges`, `notes`, `validate`, `freeze` and `charts`.

**When writers write frontmatter.** Only when something needs it: a type,
format, style, validation, note, merge, def, freeze, chart, a second sheet,
or a `header` value that detection (§4.1) would not guess. Whenever a writer
writes frontmatter, it includes `ycsv_version` and, per sheet, `header`.

### 3.2 Sheets

> **Spike 11 decision:** **P2/P27** (`header`), **P3/P17** (`hidden`, `tab_color`, sheet ref grammar), **P10**, **P11**, **P14**, **P15** accepted.

When a file contains multiple sheets, they are defined in a `sheets` array.
The order of the array is the order of the sheets and of the CSV bodies.

| Field       | Type    | Description                                                                                        |
| ----------- | ------- | -------------------------------------------------------------------------------------------------- |
| `ref`       | string  | Sheet identifier, used in cross-sheet references. Defaults to `sheet1`, `sheet2`, etc.             |
| `name`      | string  | Display name. Defaults to `ref`.                                                                   |
| `header`    | boolean | Whether the first CSV row is a header (row 0). See §4.1.                                           |
| `hidden`    | boolean | Hidden sheet (Excel "hidden" and "very hidden" both map here).                                     |
| `tab_color` | string  | Hex colour of the sheet tab.                                                                       |
| `columns`   | array   | Column definitions. See §3.3.                                                                      |
| `defs`      | mapping | Sheet-local defs. Merged with top-level defs; sheet-level takes precedence.                        |
| `cells`     | mapping | Cell overrides. See §3.7.                                                                          |
| `merges`    | array   | Merged ranges. See §3.8.                                                                           |
| `notes`     | mapping | Cell notes. See §3.8.                                                                              |
| `validate`  | array   | Validation rules for cell ranges. See §3.3.2.                                                      |
| `freeze`    | mapping | Frozen rows and columns. See §3.8.                                                                 |
| `charts`    | array   | Chart definitions. See §12.                                                                        |

A sheet `ref` follows the same rules as a column ref (§8.2): any text,
quoted in formulas when it is not an identifier, unique per file
case-insensitively.

```yaml
---
ycsv_version: 1
defs:
  btw: 0.21
sheets:
  - ref: producten
    name: Productenoverzicht
    header: true
    columns:
      - ref: product
        type: string
      - ref: prijs
        type: currency
        currency: EUR
        locale: nl-NL
  - ref: categorieën
    header: true
---
product,prijs
Appels,0.45
Brood,2.99
---
id,label
zuivel,Zuivel
groente,Groente
```

Top-level `defs` are shared across all sheets. Sheet-level `defs` are local
to that sheet.

### 3.3 Column definitions

> **Spike 11 decision:** **P9** (`excel_format`), **P11** (`width`, `hidden`), **P31** accepted. `ref` grammar K12; `name` under a header K13.

`columns` is optional, an enrichment of the CSV columns. A CSV with a header
row is a complete sheet without it; `columns` adds a ref, a type, formats,
styles and validation. How definitions attach to CSV columns is in §4.3.

| Field          | Type    | Description                                                                                         |
| -------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `ref`          | string  | Identifier used in formulas (§8.2). Defaults to the header text (§4.4), else the column letter.     |
| `name`         | string  | Without a header: the display name. With a header: the expected header text, used for matching.     |
| `type`         | string  | See §5. Defaults to `string`.                                                                       |
| `style`        | mapping | Column-level styling. See §3.3.1.                                                                   |
| `validate`     | mapping | Input validation rules. See §3.3.2.                                                                 |
| `width`        | number  | Column width in CSS pixels.                                                                         |
| `hidden`       | boolean | Hidden column.                                                                                      |
| `excel_format` | string  | Original Excel or ODF number format code. Renderers ignore it; exporters write it back.             |

Additional Intl formatting fields may be present depending on `type` (§6).

#### 3.3.1 Styling

> **Spike 11 decision:** **P16** accepted (bulk): `italic`, `underline`, `align`, `wrap`.

Style properties live under a `style` key on a column definition or a cell
override (§3.7). `fill`, `color` and `bold` accept either a static value or
a conditional formula. In a styling formula, `IF` takes an implicit
left-hand operand — the value of the current cell. `AND`, `OR`, and `NOT`
are supported, and `IF` may be nested.

| Style field | Type                          | Description                                   |
| ----------- | ----------------------------- | --------------------------------------------- |
| `fill`      | string                        | Background colour. Hex or conditional formula. |
| `color`     | string                        | Text colour. Hex or conditional formula.       |
| `bold`      | boolean or conditional string | Bold text. Accepts `IF(...)` formula.          |
| `italic`    | boolean                       | Italic text.                                   |
| `underline` | boolean                       | Underlined text.                               |
| `align`     | string                        | `left`, `center` or `right`.                   |
| `wrap`      | boolean                       | Wrap text in the cell.                         |
| `border`    | boolean                       | Apply border. Renderer controls thickness.     |

```yaml
columns:
  - ref: voorraad
    style:
      fill: IF(voorraad < min_voorraad, "#fff3cd", "#ffffff")
      color: IF(AND(voorraad < min_voorraad, voorraad > 0), "#856404")

  - ref: score
    style:
      fill: IF(OR(score < 0, score > 100), "#fce4e4")

  - ref: notitie
    style:
      fill: "#f9f9f9"
      bold: true
      wrap: true
```

#### 3.3.2 Validation

> **Spike 11 decision:** **P15** accepted (bulk), with K7 (`at` for the address, `range` with `integer`, no `range_value`) and K18 (rows).

`validate` on a column defines input rules for that column. All fields are
optional and may be combined.

| Field      | Type            | Description                                                                                          |
| ---------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `required` | boolean         | Cell must not be empty.                                                                              |
| `range`    | mapping         | Numeric bounds: optional `min`, `max`, and `integer: true` for whole numbers only.                   |
| `list`     | string or array | A mapping def name (§3.4), a range formula (`=categorieën!id1:id3`), or an array of values. Renders as a dropdown. |
| `pattern`  | string          | ECMAScript regex the value must match.                                                               |

```yaml
columns:
  - ref: categorie
    validate:
      required: true
      list: categorieën # a mapping def

  - ref: score
    validate:
      range:
        min: 0
        max: 100
        integer: true

  - ref: status
    validate:
      list: [actief, inactief]

  - ref: postcode
    validate:
      pattern: "^[0-9]{4}[A-Z]{2}$"
```

**Rules for cell ranges.** A sheet's `validate` is a list of rules that
apply to an address (§3.6) instead of a whole column. Each rule has `at` and
the same fields as above:

```yaml
validate:
  - at: categorie1:categorie5
    list: =categorieën!$id$1:$id$3
  - at: aantal1:aantal5
    range:
      min: 0
      max: 1000
      integer: true
```

Validation is enforced by the renderer on user input. Error presentation
(inline warning, blocking input, etc.) is renderer-defined.

### 3.4 Defs

> **Spike 11 decision:** **P13** accepted (bulk), rows fixed (K18). Name collisions K14.

`defs` is a YAML mapping of named values. Defs may be referenced by name in
any formula or validation rule, without a row number.

Scalar defs:

```yaml
defs:
  btw: 0.21
  min_voorraad: 10
  label: "incl. BTW"
```

Mapping defs (key/label pairs, usable as dropdown sources):

```yaml
defs:
  categorieën:
    zuivel: Zuivel
    groente: Groente
    fruit: Fruit
```

Range defs: a def value may be a formula that yields a range. This is how
Excel named ranges import.

```yaml
defs:
  cats: =categorieën!$id$1:$korting$3
```

Types are inferred from the YAML value.

```
=prijs1*(1+btw)
=IF(categorie1=categorieën.zuivel,"ja","nee")
=VLOOKUP("fruit",cats,3,FALSE)
```

In a mapping def, `.key` notation accesses the key's label:
`categorieën.zuivel` evaluates to `"Zuivel"`.

**Names.** Column refs take precedence over defs with the same name
(compared case-insensitively). Because header texts become refs (§4.4), a
header can shadow a def; readers warn when a def and a column ref of the same
sheet share a name.

### 3.5 Cross-sheet constants

Defs may also be scoped per sheet (§3.2). Sheet-level defs take precedence
over top-level defs with the same name. A def may be a list:

```yaml
defs:
  statussen:
    - Actief
    - Inactief
    - Archief
```

### 3.6 Addresses

> **Spike 11 decision:** **P29** accepted in Wouter's changed form: the formula ref grammar, header row = row 0, no `header:` style key. YAML quoting checked with the `yaml` package in `prototypes/ycsv/interop/csv/yaml-keys.test.ts` (15 cases). K5, K6, K20.

The keys of `cells` and `notes`, the entries of `merges`, and `at` in sheet
`validate` rules are **addresses**. An address uses exactly the formula ref
grammar of §8.2 and §8.3, with the same row numbers (§7.1):

| Address              | Means                                                     |
| -------------------- | --------------------------------------------------------- |
| `prijs3`             | the cell in column `prijs`, data row 3                    |
| `product0:totaal0`   | the header cells from `product` to `totaal` (header = row 0) |
| `prijs1:aantal5`     | a rectangle                                               |
| `totaal:totaal`      | the whole `totaal` column                                 |
| `"'Prijs incl. BTW'3"` | a quoted ref (§8.2); the whole YAML key is double-quoted |
| `B4`                 | column B, row 4 — only when column B has no ref (§4.2)    |

- `$` markers are allowed and ignored.
- A bare ref without a row (`totaalwaarde`) is accepted as the whole column,
  the same as `totaalwaarde:totaalwaarde`. Writers write the range form.
- **YAML quoting.** A key that contains a quoted ref is invalid YAML when
  written bare (`'Prijs incl. BTW'3:`), so writers double-quote the whole key:
  `"'Prijs incl. BTW'3":`. Plain refs and ranges (`product0:totaal0`,
  `$prijs$3`, `categorieën1:categorieën3`) are valid plain YAML keys.
- **No silent misses.** An address that does not name a cell of the sheet (an
  unknown ref, invalid YAML) is an error that names the key. The entry is not
  applied; the rest of the file still loads.
- When a column is renamed or moved in an editor, the editor rewrites the
  addresses together with the formulas.

### 3.7 Cell overrides

> **Spike 11 decision:** **P9** and **P21** (`source_formula`) accepted; addresses per P29 (K5). Example uses `product0:totaal0`.

`cells` is a mapping of addresses (§3.6) to overrides. Cell overrides take
precedence over column definitions; later keys win over earlier ones.

| Field            | Description                                                                          |
| ---------------- | ------------------------------------------------------------------------------------ |
| `style`          | Style fields of §3.3.1.                                                              |
| `type`           | A type of §5 for this cell, with the format options of §6. Report sheets mix types in one column. |
| `excel_format`   | Original number format code, as on a column.                                         |
| `source_formula` | The original formula of a cell whose function is not supported (§8.1). The cell holds the last value. |

```yaml
cells:
  product0:totaal0:
    style:
      bold: true
      fill: "#f5f5f5"
  totaal4:
    type: currency
    currency: EUR
    style:
      bold: true
      border: true
  totaalwaarde:totaalwaarde:
    style:
      bold: IF(totaalwaarde > 200)
      color: IF(totaalwaarde > 200, "#2e7d32")
```

### 3.8 Merges, notes, freeze and sizes

> **Spike 11 decision:** **P10**, **P14**, **P11** accepted. Editor decisions: frozen rows are shared and live in the file; fixed row height in v1 with room for a per-row height later (K15).

- **`merges`:** a list of ranges (`- product0:totaal0`). The top-left cell
  holds the value; the other cells must be empty.
- **`notes`:** a mapping of addresses to plain text
  (`prijs1: Prijs per stuk`). Comment authors and threads are not kept.
- **`freeze`:** `{rows: n, columns: n}`, the number of frozen rows and
  columns from the top left. The header row counts as a row. Freezing is part
  of the document, shared by everyone who opens it.
- **Sizes:** column `width` and `hidden` are on the column definition
  (§3.3). v1 has a fixed row height and stores no row heights. The key
  `row_heights` (a mapping of row numbers to CSS pixels) is reserved for a
  later version; v1 readers ignore it (§14).

---

## 4. Column identity

> **Spike 11 decision:** **P31** accepted (header in the body, `columns` as enrichment).

The header row stays in the CSV body. `columns` is an optional enrichment.

| Situation                         | Column identity                                                 |
| --------------------------------- | --------------------------------------------------------------- |
| Header row, no `columns`          | refs from the header text (§4.4), no types                      |
| Header row and `columns`          | definitions attach by ref or name, then by position (§4.3)      |
| No header row, `columns`          | by position; refs from `columns`, letters where missing         |
| No header row, no `columns`       | by position, letters (`A`, `B`, `C`…)                           |

### 4.1 Header row

> **Spike 11 decision:** **P2/P27** accepted; when the flag is written follows P34 (K3).

Whether the first CSV row is a header is stated by the `header` field:
`header: true` or `header: false`, at the top level of a single-sheet file
and on each entry of `sheets`.

- **The flag wins.** When `header` is present, readers use it and never
  guess.
- **Detection only when it is missing,** for example in a file without
  frontmatter. Readers apply the rules below.
- **Writers write the flag whenever they write frontmatter** (§3.1), and
  write frontmatter for it when detection would give the wrong answer, for
  example `header: false` for a first row of plain words that are data.
- **A header row is row 0** (§7.1). It holds column names, not data.

**Detection rules.** Apply them in order; the first rule that decides wins.
"Row 1" is the first line of the CSV body.

| Rule | When | Result |
| ---- | ---- | ------ |
| D1 | Row 1 is missing or fully empty | no header |
| D2 | `columns` is defined: every non-empty value in row 1 matches a column `ref` or `name` (trimmed, case-insensitive) | header; otherwise no header |
| D3 | Fewer than two non-empty rows | no header |
| D4 | A value in row 1 is empty, a number (§7), an ISO date or time, `true`/`false`, a formula (`=`) or a literal (`'`) | no header |
| D5 | Two values in row 1 are equal (trimmed, case-insensitive) | no header |
| D6 | Some column has a number, date, boolean or formula below row 1 | header |
| D7 | All text: header unless a row-1 value occurs again in its own column below | header / no header |

D7 is the weakest guess. A list of names with a header ("Naam,Plaats")
gives a header; a list whose first row repeats further down does not.

**Toggling.** Users can switch "first row is header" on and off. That
changes how the file numbers its rows:
- **On:** the former data row 1 becomes the header and every other row moves
  up by one.
- **Off:** the header becomes data row 1 and the other rows move down by one.

Editors that keep formulas by row identity rewrite only the row numbers when
they write the file; what each formula points at does not change. When the
header is switched off, the writer keeps the refs in `columns` (with the
former header text as `name`), so formulas such as `prijs3` keep working and
do not fall back to letters.

### 4.2 Letter fallback

> **Spike 11 decision:** Letters only for columns without a ref (P33 H6, K10).

A column without a ref gets a letter: `A` for the first column, `B` for the
second, and so on (up to `Z`, then `AA`, `AB`, etc.). Letters are refs only
for columns without a ref: in a sheet whose column B has the header
`prijs`, `B3` is not that column. When a column's letter is the ref of
another column (a header `A`), the column has no ref until it gets a header
or a `columns` ref.

### 4.3 Matching `columns` to the CSV columns

> **Spike 11 decision:** **C1–C5** accepted (bulk), with C2 also matching `name` (K13).

With a header row:

- **C1 — The header text is the display name.** When `name` is given and
  differs from the header text, the header text is shown and the reader
  warns.
- **C2 — Match by ref or name first.** A definition whose `ref` or `name`
  equals a header text (compared as in §4.4: NFC, trimmed, whitespace
  folded, case-insensitive) attaches to that column, wherever it is in the
  CSV. When a hand-typed or tool-edited CSV moves columns, they keep their
  type and their formulas.
- **C3 — Then by position.** Definitions that matched nothing attach to the
  remaining columns in order, with a warning (the header text matches
  neither `ref` nor `name`).
- **C4 — Count differences.**
  - More CSV columns than definitions: the extra columns are untyped, and
    their ref is the header text (§4.4).
  - More definitions than CSV columns: the extra definitions are unused and
    the reader warns. Formulas that use their refs give `#REF!`.
- **Writers keep C2 working.** A column's ref is its header text, and then a
  writer need not write `ref` at all. When the ref differs from the header
  text (an imported or renamed column), the writer writes both `ref` and
  `name` (the header text).

Without a header row:

- **C5 — Position only.** `name` is the display name, and the letter
  fallback (§4.2) fills missing refs.

### 4.4 Refs from the header text

> **Spike 11 decision:** **P33** accepted as proposed. Duplicate handling for writers is product decision 10 (K2: ref follows the renamed header text; Wouter to confirm).

A sheet with a header has a ref for every named column even without
frontmatter. The ref follows from the header text alone, by a fixed rule that
every reader applies the same way:

- **H1 — The ref is the header text,** in Unicode NFC, trimmed, with every
  run of whitespace replaced by one space. `  BTW   tarief ` gives
  `BTW tarief`.
- **H2 — Bare or quoted in formulas.** The ref is written bare when it is an
  identifier (`[\p{L}_][\p{L}\p{N}_]*`) that does not end in a digit, and
  quoted otherwise, with `'` doubled inside:

  | Header | Formula, row 3 | Why |
  | ------ | -------------- | --- |
  | `prijs` | `prijs3` | identifier |
  | `categorieën`, `Größe`, `数量` | `categorieën3` … | Unicode letters are identifier letters |
  | `Prijs incl. BTW` | `'Prijs incl. BTW'3` | space and dot |
  | `kw1` | `'kw1'3` | ends in a digit: `kw13` would read as `kw` row 13 |
  | `Q1` | `'Q1'3` | ends in a digit (and looks like A1) |
  | `Jan's uren` | `'Jan''s uren'3` | apostrophe doubled |

- **H3 — Case-insensitive.** Refs compare case-insensitively (Unicode lower
  case): `prijs3` finds the header `Prijs`. Writers keep the header's own
  spelling.
- **H4 — An empty header cell gives no ref.**
- **H5 — Duplicate header texts give no ref,** all of them, compared after
  H1 and H3 (`naam`, `Naam`). Not "the first one wins", and not a suffix by
  position: when a column moves, a positional suffix would make formulas
  point at another column without any sign.
- **H6 — Columns without a ref use their letter** (§4.2), unless that letter
  is the ref of another column; then the column has no ref.
- **Never silent.** Each column that loses its name under H4–H6 is a reader
  warning, and a formula that uses a name with no column gives `#REF!` with a
  warning.

**Writers never write duplicate header texts.** When a user, a concurrent
edit or an import produces a second column with an existing header text, the
editor renames the later column: `omzet` becomes `omzet 2` (then `omzet 3`,
the first free number), and its ref is the new header text (`'omzet 2'3`).
Which column is "later" is decided by a stable column identity (in our
editor, the column id), never by position, so every client renames the same
column. H5 only applies to files written by other tools or by hand.

**Renaming a header.**
- **In a hand-edited file it breaks formulas.** The ref is the text, so after
  renaming `prijs` to `stukprijs` in the source, `=prijs3` gives `#REF!` with
  a warning. A reader cannot tell a rename from a removed column plus a new
  one. People who type source rename the header and the formulas together.
- **In a file with `columns`,** the ref can stay pinned: a definition with
  `ref: prijs` and header `stukprijs` attaches by position (C3, with a
  warning), and `=prijs3` keeps working.
- **In an editor that keeps formulas by column identity** a rename is safe:
  the editor writes formulas and addresses with the new ref (`=stukprijs3`).
- **When another tool renames a header,** formulas with the old name give
  `#REF!` with a warning on the next read. An editor may offer to rename the
  ref in the formulas when exactly one header changed at the same position;
  it must not do that by itself.

---

## 5. Column types

> **Spike 11 decision:** **P6** (percent is a fraction) and **P5** (literal text) accepted.

| Type       | Stored as             | Description                                 |
| ---------- | --------------------- | ------------------------------------------- |
| `string`   | plain text            | Default.                                    |
| `number`   | number (§7)           |                                             |
| `currency` | number (§7)           | Rendered as monetary value.                 |
| `percent`  | fraction              | `0.21` is 21%. `%` is display only (§6.3).   |
| `date`     | `YYYY-MM-DD`          | ISO 8601 date.                              |
| `time`     | `HH:MM:SS`            | ISO 8601 time.                              |
| `datetime` | `YYYY-MM-DDTHH:MM:SS` | ISO 8601 combined, floating local time.     |
| `boolean`  | `true` / `false`      |                                             |

Renderers use `type` for parsing and display. A cell value that cannot be
parsed as the declared type is treated as a string and flagged as an error.
A cell override (§3.7) may give one cell another type.

A value starting with `'` is literal text in every type (§7.5).

---

## 6. Display formatting

Formatting is delegated to the platform's `Intl` library. Column definitions
and cell overrides may include `Intl`-compatible options alongside `type`.
Formatting never changes the stored value.

### 6.1 Numbers and currency

Uses `Intl.NumberFormat`. Relevant options:

| Field                   | Example | Description                                             |
| ----------------------- | ------- | ------------------------------------------------------- |
| `currency`              | `EUR`   | ISO 4217 currency code. Required when `type: currency`. |
| `locale`                | `nl-NL` | BCP 47 locale. Defaults to renderer's system locale.    |
| `minimumFractionDigits` | `2`     | Passed directly to `Intl.NumberFormat`.                 |
| `maximumFractionDigits` | `2`     | Passed directly to `Intl.NumberFormat`.                 |

```js
new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
```

### 6.2 Dates, times, and datetimes

All three temporal types use `Intl.DateTimeFormat`. Relevant options:

| Field       | Example | Description                                                           |
| ----------- | ------- | --------------------------------------------------------------------- |
| `locale`    | `nl-NL` | BCP 47 locale. Defaults to renderer's system locale.                  |
| `dateStyle` | `short` | `full`, `long`, `medium`, or `short`. Used for `date` and `datetime`. |
| `timeStyle` | `short` | `full`, `long`, `medium`, or `short`. Used for `time` and `datetime`. |

```js
// type: date
new Intl.DateTimeFormat(locale, { dateStyle: "short" });

// type: time
new Intl.DateTimeFormat(locale, { timeStyle: "short" });

// type: datetime
new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
```

If neither `dateStyle` nor `timeStyle` is specified, the renderer uses the
`Intl.DateTimeFormat` defaults for the locale.

### 6.3 Percent

> **Spike 11 decision:** **P6** accepted. Wouter: "percentage is puur een rendering ding". Reading `10%` K8.

The file always holds the fraction: `0.1` is 10%, as in every spreadsheet
application. `%` is display only: the renderer passes the value unchanged to
`Intl.NumberFormat` with `style: 'percent'`. Formulas see the fraction
(`=200*marge2` is 100 for a 50% margin).

Readers also accept a percent typed in a source cell: `10%` (a number of §7
followed by `%`) is read as `0.1`. Writers write `0.1`.

### 6.4 Locale

`locale` may be specified per column. If omitted, the renderer uses the
user's locale. Formula notation follows the user's locale in the editor and
is canonical in the file (§8.8).

---

## 7. CSV body

> **Spike 11 decision:** **P8** accepted (bulk), with the trailing `%` (K8).

The CSV body follows the frontmatter, or is the whole file. Standard
RFC 4180 rules apply:

- Values are comma-separated. Quoted values may contain commas, quotes
  (doubled) and newlines.
- Empty cell: `,` (two adjacent commas, or a trailing comma).

**Numbers** use `.` as the decimal mark and no grouping:
`-?\d+(\.\d+)?([eE][+-]?\d+)?`. Accounting notation `(9.99)` (§7.3) and a
trailing `%` (§6.3) are accepted on read. A value outside this grammar is
text.

### 7.1 Row numbering

> **Spike 11 decision:** **P1** rejected: this section stands. Wouter's constraint: the grid number equals the formula number.

Rows are numbered starting at **1** for the first data row. The header row,
if present, is row 0 and is not counted as a data row. Addresses in the
frontmatter use the same numbers (§3.6).

The row number a grid shows and the row number typed in formulas are the
same number. A renderer shows no number on the header row, or 0, and 1 on
the first data row. Converting to and from A1 spreadsheets maps the numbers:
with a header in A1 row 1, A1 row 2 is YCSV row 1.

### 7.2 Empty rows

> **Spike 11 decision:** **P30** accepted (Wouter: "A!"). Replaces the old text (empty rows had no number and were "skipped during formula evaluation").

A fully empty row is valid and has no data meaning; it usually separates
sections. It is numbered like any other row:

- **What counts as an empty row.** A line in the CSV body that is empty, that
  holds only spaces or tabs, or that holds only separators (`,,`). All its
  cells are blank.
- **It keeps its number.** The row number is the line number in the body
  minus the header offset: with a header, body line 2 is row 1; without
  one, body line 1 is row 1. Numbers never jump, and typing into an empty
  row does not renumber the rows below it.
- **Readers must not skip blank lines.** Many CSV libraries do so by default
  (an option such as `skipEmptyLines`); that must be off.
- **A blank line inside a quoted field is part of the value,** not a row.
- **The final newline of the file is not a row.** Trailing empty rows carry
  no meaning, writers drop them, and readers must not rely on them.
- **In formulas, cells of an empty row are blank cells,** like any other
  empty cell (§8.7).
- **Charts skip empty rows** (§12.5), so a separator is not a data point.

### 7.3 Negative numbers

| Format              | Example  | Notes                                            |
| ------------------- | -------- | ------------------------------------------------ |
| Prefixed minus      | `-9.99`  | Standard. Writers use this form.                 |
| Accounting notation | `(9.99)` | Accepted on read. Renderers may display either.  |

The `currency` renderer may display negative values in accounting notation
depending on the user's locale.

### 7.4 Booleans

Boolean values are stored as `true` or `false` (lowercase). In formulas,
`TRUE` and `FALSE` are also valid and follow Excel: they are `1` and `0` in
arithmetic.

```
=IF(actief1=TRUE,prijs1,0)
```

### 7.5 Literal text

> **Spike 11 decision:** **P5** accepted, with `''` for a real leading apostrophe.

A cell value starting with `'` is text, and the `'` is not part of the
value. This is the only way to store text that starts with `=`, or text that
looks like a number or date: `'007`, `'2026-01-05`, `'=niet rekenen`. A
real leading apostrophe is written `''`: `''t Hart` is the text `'t Hart`.
Tools that do not know YCSV show the apostrophe.

### 7.6 Dates and times

> **Spike 11 decision:** **P7** accepted (bulk).

Date, time and datetime cells keep their ISO text in the file
(`2026-01-05`, `09:30:00`, `2026-01-05T09:30:00`). In formulas they evaluate
to spreadsheet serial numbers: days since 1899-12-30, with the time of day
as the fraction. Datetimes are floating local times: no time zone, no DST
shift. Functions such as `TODAY()` and `EOMONTH()` return serial numbers.

### 7.7 Error values

> **Spike 11 decision:** **P20** accepted (bulk).

An error value is stored as a formula (`=NA()`, `=1/0`), never as the
literal text `#N/A`.

---

## 8. Formulas

A cell value starting with `=` is a formula (in a `.ycsv` file; see §2.4 for
`.csv`). Formulas follow Excel's grammar, with one change: **columns are
named by their ref** instead of a letter.

### 8.1 Function set

> **Spike 11 decision:** **P21** accepted (bulk): an explicit list instead of "whatever formulajs supports".

v1 supports these functions:

| Group | Functions |
|---|---|
| Math | SUM, SUMIF, SUMIFS, SUMPRODUCT, ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, PRODUCT, POWER, SQRT, CEILING, FLOOR |
| Statistics | AVERAGE, AVERAGEIF, COUNT, COUNTA, COUNTBLANK, COUNTIF, COUNTIFS, MIN, MAX, MEDIAN, MAXIFS, MINIFS |
| Logic | IF, IFS, AND, OR, NOT, IFERROR, IFNA, SWITCH |
| Lookup | VLOOKUP, HLOOKUP, XLOOKUP, INDEX, MATCH, XMATCH, CHOOSE, ROW, COLUMN |
| Text | CONCAT, CONCATENATE, TEXTJOIN, LEFT, RIGHT, MID, LEN, UPPER, LOWER, PROPER, TRIM, SUBSTITUTE, FIND, SEARCH, TEXT, VALUE, REPT, EXACT |
| Date | DATE, YEAR, MONTH, DAY, WEEKDAY, WEEKNUM, ISOWEEKNUM, EDATE, EOMONTH, DATEDIF, NETWORKDAYS, WORKDAY, DAYS, TIME, HOUR, DATEVALUE, TODAY, NOW |
| Info | ISBLANK, ISNUMBER, ISTEXT, ISERROR, ISNA, NA |
| Finance | PMT |
| Other | HYPERLINK |

Each function behaves as in Excel. Implementations may support more and
document it. Function names are English in the file and in every locale.

**Import rules.**
- `_xlfn.` and `_xlws.` prefixes are removed on read and added back on write.
- A function outside the list keeps the cell's last value as a plain value,
  and the original formula is stored in `cells.<address>.source_formula`
  (§3.7). The import report says so. Google `__xludf.DUMMYFUNCTION` wrappers
  (functions such as `GOOGLEFINANCE` that Excel does not know) follow this
  rule.

### 8.2 References

> **Spike 11 decision:** **P4** and **P12/P28** accepted, P12/P28 as amended by **P33** (K1). Letters K10.

A reference is a column ref followed by a row number:

```
=aantal1*prijs1
='Prijs incl. BTW'3*2
=A1*B1          (only in a sheet whose columns have no refs)
```

- **Refs** are any non-empty text. A ref is written bare when it is an
  identifier (`[\p{L}_][\p{L}\p{N}_]*`) that does not end in a digit;
  otherwise it is quoted with `'`, and `'` inside is doubled (§4.4, H2).
- **Case-insensitive.** Refs, sheet refs and def names compare
  case-insensitively, and must be unique case-insensitively within a sheet.
- **Letters** are refs only for columns without a ref (§4.2).
- **Absolute markers:** `$prijs$2`, `$prijs2`, `prijs$2`. `$` has no effect on
  evaluation; it matters when a formula is filled or pasted (§8.9).
- **Same row:** a bare ref without a row number (`prijs`) means the cell in
  the same row as the formula.
- **Cross-sheet:** the sheet ref and `!` go before the ref; the sheet ref is
  quoted by the same rule: `categorieën!label1`, `'Q1 overzicht'!B4`.

### 8.3 Ranges

> **Spike 11 decision:** **P4** accepted. K16, K18.

```
=SUM(totaal1:totaal4)
=SUMPRODUCT(prijs1:prijs5,aantal1:aantal5)
=VLOOKUP("fruit",categorieën!$id$1:$korting$3,3,FALSE)
=SUM(totaal:totaal)
=SUM(producten!totaal1:totaal5)
```

- A range `start:end` is a rectangle; start and end may name different
  columns (`id1:korting3`).
- `ref:ref` is a whole column.
- A cross-sheet range names the sheet once: `producten!totaal1:totaal5`.
  Readers also accept the sheet repeated on the end
  (`producten!totaal1:producten!totaal5`) when both name the same sheet.
  Writers write it once.
- Cells of empty rows inside a range are blank cells (§8.7).

### 8.4 Conditional: IF

```
=IF(condition, value_if_true, value_if_false)
=IF(AND(voorraad1<10,actief1=TRUE),"laag","ok")
=IF(OR(score1<0,score1>100),"ongeldig",score1)
=IF(aantal1=0,"uitverkocht",IF(aantal1<5,"beperkt","op voorraad"))
```

### 8.5 Error handling: IFERROR

> **Spike 11 decision:** Example rewritten with refs (K10).

`IFERROR` catches formula errors and returns a fallback value:

```
=IFERROR(totaal1/aantal1,0)
=IFERROR(VLOOKUP(product1,prijzen!product1:prijs10,2,FALSE),"niet gevonden")
```

### 8.6 Operators

> **Spike 11 decision:** **P4** accepted: `%` postfix percent, `&`, Excel precedence, case-insensitive text comparison (K22).

| Operator | Meaning |
| -------- | ------- |
| `+` `-` `*` `/` | arithmetic |
| `^` | power |
| `%` | postfix percent: `50%` is `0.5`. Modulo is only `MOD()`. |
| `&` | text concatenation |
| `=` `<>` `<` `>` `<=` `>=` | comparison |
| `-` (unary) | negation |

Precedence follows Excel: unary minus binds tighter than `^` (`-2^2` = 4),
`^` is left-associative (`2^3^2` = 64), then `%`, `*` and `/`, `+` and `-`,
`&`, comparison. Text comparison is case-insensitive (`"a"="A"` is TRUE).

### 8.7 Evaluation

> **Spike 11 decision:** "Errors, not aborts" (B.5) accepted (bulk), K21. Blank cells per P30.

Formulas are evaluated in dependency order. These cases are errors in the
one cell, never in the whole file, so one broken formula does not make the
rest of a workbook unreadable:

| Case | Cell value |
| ---- | ---------- |
| Unknown column ref or sheet ref | `#REF!` |
| Circular reference | `#CIRC!` (Excel and Sheets show their own circular error) |
| Errors in arguments | propagate; `IFERROR`, `IFNA`, `ISERROR` and `ISNA` catch them |

A **blank cell** (an empty cell, or a cell of an empty row) is `0` in
arithmetic and `""` in text, as in Excel. `SUM`, `AVERAGE`, `COUNT`,
`COUNTA`, `MIN` and `MAX` ignore blank cells, so a range across an empty row
gives the same result as without it. `COUNTBLANK` and `ROWS` do count them.
A reference to a blank cell is not an error.

### 8.8 Notation and locale

> **Spike 11 decision:** B.6 accepted (bulk), and Wouter's editor decision: input and display follow the browser locale (`=ROUND(3,27;1)` in nl-NL), the file stays canonical, function names stay English.

The file always holds the canonical notation: `.` as the decimal mark and
`,` between arguments (`=ROUND(3.27,1)`). The formula editor shows and
accepts the user's locale notation: in a locale whose decimal mark is `,`
(nl-NL, de-DE, fr-FR) that is `=ROUND(3,27;1)`. Function names stay English.
Strings and quoted refs are never changed. Excel and LibreOffice work the
same way.

### 8.9 Filling, pasting and moving

> **Spike 11 decision:** New section: Wouter's editor decisions (fill and paste shift refs, `$` locks; cut + paste rewrites references to the moved cells). They decide what writers write.

The file format is the same before and after these editor operations; they
are here because they decide which refs a writer writes.

- **Fill and paste** shift refs like Excel: a formula filled or pasted one
  column to the right refers to the next column's ref (`prijs1` becomes
  `aantal1` when `aantal` is the next column), and one row down to the next
  row. A `$` marker locks the column or the row.
- **Cut and paste** moves cells, and every formula and address that referred
  to the moved cells is rewritten to their new place.

### 8.10 Hyperlinks

> **Spike 11 decision:** **P18** accepted (bulk).

A hyperlink cell is a formula: `=HYPERLINK("https://example.org/","label")`.

---

## 9. Examples

> **Spike 11 decision:** 9.1 without frontmatter (P34); 9.2 without frontmatter (P34); 9.3 header styled with `product0:totaal0` (P29) and display names matched by `name` (K13); 9.4 validation list from a range (P15); 9.5 new (P33 quoting, YAML key quoting).

### 9.1 Minimal file, no header

```
Appels,6,0.45,=A1*B1
Brood,2,2.99,=A2*B2
Melk,3,1.19,=A3*B3
```

The first row has numbers, so there is no header (§4.1, D4); columns are
`A`–`D`.

### 9.2 Header row, no frontmatter

```
product,aantal,prijs,totaal
Appels,6,0.45,=prijs1*aantal1
Brood,2,2.99,=prijs2*aantal2
Melk,3,1.19,=prijs3*aantal3
```

The header names are the refs (§4.4).

### 9.3 Fully typed with defs and styling

```
---
ycsv_version: 1
header: true
defs:
  btw: 0.21
  min_voorraad: 5
columns:
  - ref: product
    type: string
  - ref: aantal
    type: number
    style:
      fill: IF(aantal < min_voorraad, "#fff3cd")
      color: IF(aantal < min_voorraad, "#856404")
    validate:
      range:
        min: 0
  - ref: prijs
    name: Prijs ex. BTW
    type: currency
    currency: EUR
    locale: nl-NL
  - ref: totaal
    name: Prijs incl. BTW
    type: currency
    currency: EUR
    locale: nl-NL
cells:
  product0:totaal0:
    style:
      bold: true
      fill: "#f5f5f5"
---
product,aantal,Prijs ex. BTW,Prijs incl. BTW
Appels,6,0.45,=prijs1*aantal1*(1+btw)
Brood,2,2.99,=prijs2*aantal2*(1+btw)
Melk,3,1.19,=prijs3*aantal3*(1+btw)
,,Totaal,=SUM(totaal1:totaal3)
```

`prijs` and `totaal` attach to their columns by `name` (§4.3, C2), so the
headers can be display text while formulas use short refs.

Rendered output:

| product | aantal | Prijs ex. BTW | Prijs incl. BTW |
| ------- | ------ | ------------- | --------------- |
| Appels  | 6      | €0,45         | €3,27           |
| Brood   | 2      | €2,99         | €7,24           |
| Melk    | 3      | €1,19         | €4,32           |
|         |        | Totaal        | €14,83          |

### 9.4 Multi-sheet file

```
---
ycsv_version: 1
defs:
  btw: 0.21
sheets:
  - ref: producten
    name: Productenoverzicht
    header: true
    columns:
      - ref: product
        type: string
      - ref: categorie
        type: string
        validate:
          required: true
          list: =categorieën!id1:id3
      - ref: prijs
        type: currency
        currency: EUR
        locale: nl-NL
      - ref: totaal_incl
        type: currency
        currency: EUR
        locale: nl-NL
  - ref: categorieën
    header: true
---
product,categorie,prijs,totaal_incl
Appels,fruit,0.45,=prijs1*(1+btw)
Brood,bakkerij,2.99,=prijs2*(1+btw)
Melk,zuivel,1.19,=prijs3*(1+btw)
---
id,label
fruit,Fruit
bakkerij,Bakkerij
zuivel,Zuivel
```

Cross-sheet ref example — the category label from the `categorieën` sheet:

```
=categorieën!label1
```

### 9.5 Header names that need quoting

```
Omschrijving,Prijs incl. BTW,kw1,kw2
Huur,1512.50,3,4
Stroom,108.90,5,6
Totaal,=SUM('Prijs incl. BTW'1:'Prijs incl. BTW'2),=SUM('kw1'1:'kw1'2),=SUM('kw2'1:'kw2'2)
```

With frontmatter, a style on the first total uses the same ref as a
double-quoted YAML key:

```yaml
cells:
  "'Prijs incl. BTW'3":
    style:
      bold: true
```

---

## 10. Compatibility

A YCSV body is valid CSV. Tools that do not understand YCSV can read the
data rows of a file without frontmatter directly, and of any other file
after removing the frontmatter (everything up to and including the second
`---` line). They see formulas as text and literal-text cells with their
leading `'`.

This is intentional. YCSV degrades gracefully.

---

## 11. Multi-sheet files

Multiple sheets live in a single `.ycsv` file. The `sheets` array in the
frontmatter defines all sheets; each `---`-separated block after it is the
CSV body of the corresponding sheet, in order. See §3.2.

Cross-file references are not supported.

### 11.1 Cross-sheet references

Use `sheetref!` before a reference or range (§8.2, §8.3):

```
=categorieën!label1
=SUM(producten!totaal1:totaal10)
```

### 11.2 Circular references

A circular reference, within a sheet or across sheets, is an error in each
cell of the cycle (`#CIRC!`, §8.7). The rest of the file evaluates.

---

## 12. Charts

> **Spike 11 decision:** Added by the spike, not decided: Vega-Lite field-name escaping for refs with `.`, `[` or `]` (a consequence of P33). Empty rows skipped (P30).

Charts are defined in the frontmatter as an optional `charts` array. Each
chart is a [Vega-Lite](https://vega.github.io/vega-lite/) specification
(BSD-3 license) embedded as a YAML block mapping.

Vega-Lite is an open, declarative grammar for interactive visualizations.
YCSV renderers inject the sheet's data automatically — no `data` key is
needed in the chart spec. Column `ref` names map directly to Vega-Lite
`field` values. In Vega-Lite a `.` or `[` in a field name means a nested
field, so a ref that contains `.`, `[` or `]` is written with a `\` before
those characters: the ref `Prijs incl. BTW` is `field: "Prijs incl\\. BTW"`.

### 12.1 Chart definition fields

| Field   | Required | Type    | Description                                          |
| ------- | -------- | ------- | ---------------------------------------------------- |
| `id`    | no       | string  | Stable identifier.                                   |
| `title` | no       | string  | Display title.                                       |
| `spec`  | yes      | mapping | Full Vega-Lite spec. `data` is injected by renderer. |

Additional Vega-Lite properties (`width`, `height`, `transform`, etc.) are
passed through as-is.

### 12.2 Supported mark types

`bar`, `line`, `point`, `area`, `arc` (pie/donut), `rule`, `tick`, `rect`

### 12.3 Examples

#### Bar chart

```yaml
charts:
  - title: Omzet per maand
    spec:
      schema: https://vega.github.io/schema/vega-lite/v5.json
      mark: bar
      encoding:
        x:
          field: maand
          type: nominal
          axis:
            labelAngle: 0
        y:
          field: omzet
          type: quantitative
          title: Omzet (€)
```

#### Line chart

```yaml
charts:
  - title: Bezoekers over tijd
    spec:
      schema: https://vega.github.io/schema/vega-lite/v5.json
      mark: line
      encoding:
        x:
          field: datum
          type: temporal
        y:
          field: bezoekers
          type: quantitative
```

#### Scatter plot

```yaml
charts:
  - title: Prijs vs. verkopen
    spec:
      schema: https://vega.github.io/schema/vega-lite/v5.json
      mark: point
      encoding:
        x:
          field: prijs
          type: quantitative
        y:
          field: verkopen
          type: quantitative
        color:
          field: categorie
          type: nominal
```

#### Pie chart

```yaml
charts:
  - title: Omzet per categorie
    spec:
      schema: https://vega.github.io/schema/vega-lite/v5.json
      mark: arc
      encoding:
        theta:
          field: omzet
          type: quantitative
        color:
          field: categorie
          type: nominal
```

#### Area chart

```yaml
charts:
  - title: Kosten vs. opbrengsten
    spec:
      schema: https://vega.github.io/schema/vega-lite/v5.json
      mark: area
      encoding:
        x:
          field: maand
          type: temporal
        y:
          field: bedrag
          type: quantitative
        color:
          field: type
          type: nominal
```

### 12.4 Multiple charts

A single `.ycsv` file may define multiple charts:

```yaml
charts:
  - id: bar
    title: Omzet per maand
    spec:
      schema: https://vega.github.io/schema/vega-lite/v5.json
      mark: bar
      encoding:
        x:
          field: maand
          type: nominal
        y:
          field: omzet
          type: quantitative
  - id: trend
    title: Omzet trend
    spec:
      schema: https://vega.github.io/schema/vega-lite/v5.json
      mark: line
      encoding:
        x:
          field: maand
          type: nominal
        y:
          field: omzet
          type: quantitative
```

### 12.5 Renderer responsibilities

- Inject the sheet's evaluated data rows as the Vega-Lite `data.values`
  array, keyed by column ref. Empty rows (§7.2) are skipped.
- Pass the chart spec to the Vega-Lite compiler unchanged, except for the
  injected data.
- Render charts below the table by default. Layout is application-defined.

---

## 13. Sidecar files

> **Spike 11 decision:** Widths and freeze moved into the file (K11). The collaboration sidecar line follows P32's build consequence.

The file holds everything that is shared: data, formulas, formats, column
widths, hidden columns and frozen rows and columns.

- **Per-user view state** (sort and filter state, scroll position,
  selection) may be stored in a `.ycsv.ui` sidecar next to the file. It is
  renderer-defined, not part of this spec, and should be `.gitignore`d or
  treated as non-canonical.
- **Collaboration state** of an editor (for example a CRDT document next to
  the file) is not part of this spec either. The `.ycsv` or `.csv` file is
  the canonical form; an editor rebuilds its state when the file is changed
  by another tool.

---

## 14. Versioning and forward compatibility

> **Spike 11 decision:** Missing version = 1 (K4); `row_heights` reserved (K15).

The `ycsv_version` field is an integer. A file without it is version 1.
Readers that meet a version higher than they support warn the user and
attempt a best-effort parse.

New fields added to column definitions or the frontmatter in future versions
must be ignored by v1 readers (unknown fields are not an error). Reserved for
later: `row_heights` (§3.8).

---

## 15. Reference implementations

Reference implementations (parser, renderer, CLI validator) will be published
at a canonical repository under an MIT license. The spec itself is published
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

| Dependency             | License | Purpose            |
| ---------------------- | ------- | ------------------ |
| `@formulajs/formulajs` | MIT     | Formula evaluation |
| `vega-lite`            | BSD-3   | Chart rendering    |

formulajs returns `DATE`, `NOW` and `TODAY` as JavaScript `Date` objects in
local time; implementations convert them to serial numbers (§7.6).

---

_YCSV v1.0 — Draft. Feedback welcome._

---

## Appendix A: Parser algorithm

> **Spike 11 decision:** Updated for P22, P23, P24, P25, P29, P30, P33, P34 and per-cell errors; cross-file refs removed (K17).

This appendix defines the normative parsing algorithm for a YCSV file.
Implementations must produce equivalent results.

### A.1 Overview

```
1. Read file as UTF-8, strip a leading BOM
2. Split into frontmatter and CSV bodies
3. Parse frontmatter
4. Parse CSV bodies
5. Resolve column identity
6. Evaluate formulas
7. Apply styling
```

### A.2 Step 1 — Split frontmatter and bodies

```
if the first line is not exactly "---" (trailing spaces/tabs allowed):
  frontmatter = {}
  bodies = [ whole file ]            (a "---" line is data here)
  stop

frontmatter_text = lines up to the next "---" line
if there is no such line:
  error: "missing frontmatter closing marker"

split the rest into bodies on "---" lines that are outside a quoted
CSV field (track RFC 4180 quote state while scanning)
```

### A.3 Step 2 — Parse frontmatter

```
parse frontmatter_text as YAML 1.2 (core schema)
if it is not valid YAML: error, naming the line

version = ycsv_version or 1
if version > known_version:
  warn: "unknown version, attempting best-effort parse"

sheets = frontmatter.sheets, or one sheet built from the top-level
         sheet fields (header, columns, cells, merges, notes, validate,
         freeze, charts)
defs   = frontmatter.defs or {}
```

### A.4 Step 3 — Parse CSV bodies

```
for each body:
  parse using RFC 4180 rules; do not skip blank lines
  CR and CRLF inside quoted fields → LF
  result: list of rows, each row a list of cell strings

  for each row:
    if the line is empty, whitespace only, or all cells are empty:
      mark as EMPTY_ROW (it keeps its row number)
  drop trailing EMPTY_ROWs; the final newline is not a row
```

### A.5 Step 4 — Resolve column identity

```
header = sheet.header if present, else detection rules D1–D7 (§4.1)

if header:
  refs = header texts by H1–H6 (§4.4)
  attach columns[] by ref or name, then by position (§4.3, C1–C4)
  row 0 = header row
else:
  attach columns[] by position (C5); letters where no ref (§4.2)

number data rows from 1 upward, EMPTY_ROWs included (§7.2)
resolve every address in cells, merges, notes and validate (§3.6);
  an address that names no cell: error naming the key, entry skipped
```

### A.6 Step 5 — Evaluate formulas

```
for each data cell:
  if value starts with "'": literal text, without the "'" (§7.5)
  if value starts with "=": FORMULA cell (not in a .csv file, §2.4)
    parse into AST (§8.2, §8.3, §8.6)
    dependencies: ref+row pairs, ranges, def names, sheet refs

evaluate in dependency order:
  cells in a cycle → #CIRC!
  unknown column ref or sheet ref → #REF!
  <ref><row>              → value of that cell (blank if empty)
  <ref>                   → same row
  <start>:<end>           → rectangle of values
  <ref>:<ref>             → whole column
  <sheet>!...             → the same in another sheet
  <name>                  → defs[name] (column refs win, §3.4)

for non-formula cells, parse by type (column type, or cell override):
  number / currency / percent → number grammar (§7)
    accept "-9.99", "(9.99)"; "10%" → 0.1
  date / time / datetime → ISO 8601 text; serial number in formulas (§7.6)
  boolean → "true"/"TRUE" → true, "false"/"FALSE" → false
  string  → as-is
  if parsing fails: store as string, emit type warning
```

### A.7 Step 6 — Apply styling

```
for each cell:
  collect style rules, lowest to highest priority:
    1. column-level style from columns[]
    2. cells{} entries whose address covers the cell, in file order
  static value → apply
  conditional formula → evaluate with implicit LHS = the cell's value
```

### A.8 Cross-sheet references

```
for <sheetref>!<ref><row>:
  find <sheetref> in the sheets array (case-insensitive)
  not found → #REF! in this cell
  return the evaluated value of <ref><row> in that sheet
```

### A.9 Chart injection

```
for each chart in charts:
  data.values = one object per data row, keyed by ref,
                with the evaluated cell values; skip EMPTY_ROWs
  inject as chart.spec.data = { values: [...] }
  pass the completed spec to the Vega-Lite compiler
```

### A.10 Error handling summary

| Error                                   | Behaviour                                      |
| --------------------------------------- | ---------------------------------------------- |
| Missing `ycsv_version`                  | Read as version 1                              |
| Unknown `ycsv_version`                  | Warn, attempt parse                            |
| Invalid YAML                            | Error naming the line                          |
| Unknown frontmatter field               | Ignore (§14)                                   |
| Address that names no cell              | Error naming the key; entry skipped            |
| Empty or duplicate header text          | Warning; letter fallback (§4.4)                |
| `columns` and header disagree           | Warning (§4.3)                                 |
| Type parse failure                      | Store as string, emit warning                  |
| Unknown column or sheet ref in a formula | `#REF!` in that cell                          |
| Circular reference                      | `#CIRC!` in each cell of the cycle             |
| Formula evaluation error                | Cell returns error value; `IFERROR` can handle |
| Validation failure                      | Renderer-defined; not a parse error            |

---

## Appendix B: Writers

> **Spike 11 decision:** New: a summary of writer rules spread over the decisions.

What a writer does, in one place:

- Write frontmatter only when something needs it (§3.1); when written,
  include `ycsv_version` and `header` per sheet.
- Write YAML 1.2 in block style; double-quote keys that contain a quoted
  ref (§3.6).
- Write addresses in the ref grammar (§3.6); `ref:ref` for whole columns.
- Quote every CSV cell whose value contains a `---` line (§2), and in a file
  without frontmatter a first cell whose value is `---`.
- Use LF, no BOM, `.` decimals and `-` for negatives in `.ycsv` (§2.2, §2.3,
  §7); keep the dialect of a `.csv` (§2.4).
- Store percent as a fraction (§6.3), errors as formulas (§7.7), and text
  that looks like a number, date or formula with a leading `'` (§7.5).
- Drop trailing empty rows; keep empty rows inside the body (§7.2).
- Never write duplicate header texts; rename the later column `<name> 2`
  (§4.4).
- Write `ref` only when it differs from the header text, and then also
  `name` (§4.3).

## Appendix C: Import and export

> **Spike 11 decision:** B.7 accepted (bulk), with the P30 row mapping.

- **CSV import needs a locale.** Plain CSV import (not YCSV) asks for, or
  detects, the separator and number locale, and parses the raw text with it.
  It must not let a library guess: a Dutch Excel CSV (`;`, `0,45`,
  `05-01-2026`) read with default settings turns `0,45` into 45 and
  `05-01-2026` into 1 May.
- **Import report.** Import may lose features; it must not lose them
  silently. An importer produces a report listing every feature that
  degrades or is lost, with the cells involved. Every formula whose result
  differs from the value the source application cached is listed with both
  values, and the cell is flagged until the user accepts it. A file read
  without formulas says so once, with the way to keep them.
- **Row numbers.** A1 row numbers map to YCSV rows by the header offset only
  (§7.1, §7.2).
- **Cached values on export.** An XLSX or ODS export writes either correct
  cached values for every formula, or none at all plus "recalculate on
  load". It never writes values the engine got wrong, because some
  applications show cached values as they are.

---

## Appendix D: Spike 11 decision record

### D.1 Status per proposal

Wouter went through the proposals one by one (session of 2026-11-27).

| Id | Proposal | Status |
|---|---|---|
| P1 | Header = row 1, as in Excel | **Rejected.** §7.1 stands. |
| P2 / P27 | Explicit `header` flag, detection D1–D7 | Accepted |
| P3 / P17 | Sheet fields `hidden`, `tab_color`; sheet ref grammar | Accepted (bulk) |
| P4 | Excel formula grammar: `$`, ranges, `&`, postfix `%`, `-2^2` = 4, left-associative `^`, case-insensitive text comparison, same-row bare refs | Accepted |
| P5 | Leading `'` = literal text, `''` for a real apostrophe | Accepted |
| P6 | Percent stored as a fraction | Accepted ("percentage is puur een rendering ding") |
| P7 | Dates: ISO in the file, serials in formulas, floating local time | Accepted (bulk) |
| P8 | Number grammar | Accepted (bulk), with trailing `%` on read (K8) |
| P9 | Per-cell type and format, `excel_format` | Accepted (bulk) |
| P10 | Merges | Accepted (bulk), ref-grammar addresses (K5) |
| P11 | Freeze, column widths, hidden columns; no row heights | Accepted (bulk), `row_heights` reserved (K15) |
| P12 / P28 | Ref grammar, quoted refs | Accepted, as amended by P33 (K1) |
| P13 | Range defs | Accepted (bulk) |
| P14 | Notes | Accepted (bulk), ref-grammar addresses (K5) |
| P15 | Validation on ranges, `list` from a range or array, whole-number bounds | Accepted (bulk), with `at` and `range.integer` (K7) |
| P16 | `italic`, `underline`, `align`, `wrap` | Accepted (bulk) |
| P18 | Hyperlinks as `HYPERLINK()` formulas | Accepted (bulk) |
| P19 / P26 | Trailing empty rows carry no meaning | Accepted (bulk) |
| P20 | Errors stored as formulas | Accepted (bulk) |
| P21 | Explicit function list, `_xlfn.`, `source_formula` | Accepted (bulk) |
| P22 | Split only on `---` outside quoted fields; writers quote | Accepted |
| P23 | CR/CRLF in cells → LF | Accepted (bulk) |
| P24 | Strip BOM on read, never write one | Accepted (bulk), `.ycsv` only (K9) |
| P25 | YAML 1.2 core schema | Accepted (bulk); block style written, flow style read |
| P29 | Frontmatter addresses use YCSV rows | Accepted **in changed form**: the formula ref grammar (`product0:totaal0`), no `header:` style key |
| P30 | Empty rows keep their number | Accepted ("A!") |
| P31 | Header in the body, `columns` as enrichment; C1–C5 | Accepted; C1–C5 in bulk, C2 also matches `name` (K13) |
| P32 | `.csv` stays CSV until a YCSV-only feature is used | Accepted, details in bulk |
| P33 | Refs from the header text alone (H1–H6) | Accepted as proposed |
| P34 | Frontmatter optional, also in `.ycsv` | Accepted as proposed |
| B.5 | Per-cell errors instead of aborts | Accepted (bulk) |
| B.6 | Canonical notation in the file, locale in the editor | Accepted (bulk) |
| B.7 | CSV import locale, import report, cached values on export | Accepted (bulk) |

Not in this list and **not** decided: the "edge semantics" in the spike
report beyond blank cells and case-insensitive comparison (text inside
ranges, booleans in SUM, comparing at 15 significant digits). The spec does
not state them yet.

### D.2 Conflicts found and how they were resolved

Every proposal accepted in bulk was checked against the explicit decisions
(P1 rejected; P2/P27, P4, P5, P6, P22, P29 changed, P30, P31, P32, P33, P34
accepted) and against the rest of the spec. Each conflict is resolved in the
direction of the decisions; the report has the reasoning.

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

### D.3 Original proposal texts

The proposals as they were written before the decisions, for reference.
Where they differ from the spec text above, the spec text wins.

Statuses below are as of before the 2026-11-27 decisions; D.1 has the current status. Section numbers (§) refer to the old numbering.

#### D.3.1 Rows, header and body

**P1 — Grid row numbering. Rejected.** Proposed: header = row 1, first data
row = row 2, as in Excel. Decision (Wouter): rows count from 1 in the spec,
so §7.1 stands. In the CSV source the header can be line 1, and the grid may
start its visible numbering at the first data row. Consequences:

- The `spreadsheet-core` engine, which counts the header as row 1, has a bug
  against §7.1. It is not an alternative numbering.
- Import and export map row numbers: with a header in source row 1, Excel
  row 2 = YCSV row 1. Empty rows keep their number (P30, accepted), so this
  one-row offset is the whole mapping.
- **The one constraint:** the row number the grid shows and the row number
  typed in formulas are the same number. The grid shows no number on the
  header row (Numbers shows its header rows the same way), shows 1 on the
  first data row, and numbers empty rows like any other (§7.2, P30).

**P29 — Frontmatter addresses use YCSV rows.** `cells`, `merges`, `notes`
and `validate` ranges use the same row numbers as formulas: the first data
row is row 1 and the header row is row 0 (`A0:D0` styles the header). This
keeps `B3` meaning one cell everywhere. Example 9.3 (`cells: A1:D1` for the
header) changes to `A0:D0`. Alternative: a `header:` style key instead of
row 0 addresses.

**P30 — Empty rows keep their number. Accepted** (Wouter: "A!", after
comparing both options on source examples). Written into §7.2, A.4, A.5 and
A.9. A fully empty line (empty, whitespace only, or only separators) is a
row and keeps its number; row number = body line number minus the header
offset. Parsers must not skip blank lines; a blank line inside a quoted
field is part of the value; the final newline is not a row, and trailing
empty rows are not stored (P26). Cells of an empty row are blank cells
(Excel semantics; aggregates ignore them), and charts still skip empty
rows. Consequences:
- An Excel import needs no renumbering for blank rows; the only mapping is
  the header offset (Excel row 2 = YCSV row 1).
- The grid numbers every row; typing into an empty row changes nothing
  below it.
- Before the decision, §7.2 gave empty rows no number: Excel `B4` in the
  spike's Q1 sheet became YCSV `B3`. Both parsers already numbered empty
  rows; see the conformance cases `r01`, `r04`–`r08` for where they still
  differ (skipped blank lines, stored trailing rows).

**P2 / P27 — Explicit `header`. Accepted** (Wouter: "header true lijkt me
een mooie aanpak"). Every sheet states `header: true|false`. Detection
(rules D1–D7, §4.1) runs only when the flag is missing, for example on a
plain CSV, and its result is written back as the flag. Users can toggle
"first row is header"; that renumbers the file form only (§4.1, Toggling).
Written into §3, §4.1 and A.5.

**P31 — Header in the body, `columns` as enrichment. Accepted** (Wouter).
The matching rule C1–C5 (§4.3) is a proposal: ref-equals-header-text first,
then position. The header text is the display name.

**P32 — A `.csv` stays CSV until a YCSV-only feature is used. Accepted**
(Wouter). The editor asks at that moment (§2.4). Build consequence: a `.csv`
needs real-time collaboration like `.ycsv`, so it needs a Yjs sidecar and
must be on the collab-editable lists:
- client: `DOCS_COLLAB_TEXT_EXTENSIONS` (`packages/apps/src/lib/files/docs-collab-text-files.ts`)
  already lists `csv`, but routes it to the Docs text editor, so routing must
  send `.csv` (and `.ycsv`) to Sheets;
- server: `CollabDocFormats` (`packages/api/app/Services/Drive/CollabDocFormats.php`)
  knows only `md` and `markdown`, so `csv` and `ycsv` need a sheet doc type
  there;
- the external-write detection used for Docs and Notes must cover the CSV
  file.

Dialect preservation and "`=` is text in a plain CSV" are proposals (§2.4).

**P22 — Quote-aware split.** The body splitter (§2, A.2) must only split on a
`---` line that is outside a quoted CSV field. Today a cell value containing
a line `---` cuts the sheet in two in both parsers.

**P23 — Line breaks inside cells.** A CR or CRLF inside a quoted field is
normalised to LF on read. Writers emit LF.

**P24 — BOM.** Readers strip a leading UTF-8 BOM (Excel writes one in its
"CSV UTF-8" output). Writers never write one. §2.2 stays "No BOM" for writers.

**P25 — YAML 1.2.** The frontmatter is YAML 1.2 core schema, so `no`, `on`,
`010` are strings or decimal numbers, not booleans or octal.

**P26 / P19 — Trailing empty rows.** Empty rows at the end of a body carry no
meaning and may be dropped by writers. Readers must not rely on them.

**P34 — Frontmatter is optional, in `.ycsv` too** (§2, A.2, proposal).
Wouter wants named header columns usable in formulas without any YAML. A
file has frontmatter only when its first line (after an optional BOM) is
exactly `---`; otherwise it is one sheet whose whole content is the CSV
body, with `header` detected (§4.1) and refs from the header text (§4.4,
P33). In such a file a `---` line is data, and writers quote it. Writers
add frontmatter only when something needs it. Today §2 and A.2 make
frontmatter mandatory and a missing opening marker an error.

#### D.3.2 Sheets

**P3 / P17 — Sheet fields.** A `ref` follows the same grammar as a column
`ref` (B.4, P12). Sheet entries gain:

| Field       | Type    | Description                                   |
| ----------- | ------- | --------------------------------------------- |
| `header`    | boolean | Accepted (P2/P27); rules in §4.1.             |
| `hidden`    | boolean | Hidden sheet (Excel "hidden" and "very hidden" both map here). |
| `tab_color` | string  | Hex colour of the sheet tab.                  |

Sheet order is the order of the `sheets` array.

**P10 — Merges.** `merges: [A1:D1, …]` per sheet. The top-left cell holds the
value; the others must be empty.

**P11 — Freeze and sizes.** `freeze: {rows, columns}` per sheet. Columns gain
`width` (CSS pixels) and `hidden`. Row heights are not stored (product
decision 6: fixed row height).

**P14 — Notes.** `notes: {A1: "text"}` per sheet, plain text. Comment
authors and threads are not kept.

#### D.3.3 Values

**P5 — Literal text.** A cell value starting with `'` is text, and the `'` is
not part of the value. This is the only way to store text that starts with
`=`, or text that looks like a number or date (`'007`, `'2026-01-05`).
Readers that do not know YCSV will show the apostrophe.

**P6 — Percent is a fraction.** A `percent` cell stores `0.21` for 21%, the
same as every spreadsheet application. This replaces §6.3 ("50 = 50%"). With
§6.3 as written, `=200*marge2` gives 10000 for a 50% margin, and an import or
export has to multiply or divide every value.

**P7 — Dates in formulas.** Date, time and datetime cells keep their ISO text
in the file (`2026-01-05`, `09:30:00`, `2026-01-05T09:30:00`). In formulas
they evaluate to spreadsheet serial numbers (days since 1899-12-30, the
fraction is the time of day). Datetimes are floating local times: no time
zone, no DST shift. `TODAY()` and `EOMONTH()` must not return JS `Date`
objects in local time (an import test showed a one-hour offset).

**P8 — Number grammar.** Numbers in the body use `.` as the decimal mark and
no grouping: `-?\d+(\.\d+)?([eE][+-]?\d+)?`. Accounting notation `(9.99)`
(§7.3) is accepted on read; writers use `-9.99`. A value outside this
grammar is text.

**P20 — Error values.** An error value is stored as a formula (`=NA()`,
`=1/0`), never as the literal text `#N/A`.

#### D.3.4 Columns, cells and formats

**P9 — Per-cell type and format.** `cells.<A1>` may carry `type` and the
format options of §6, not only `style`. Report sheets mix currency, percent
and dates in one column. Any column or cell may carry `excel_format` (the
original Excel or ODF number format code) as a passthrough: renderers ignore
it, exporters write it back.

**P16 — More style fields.** `italic`, `underline`, `align`
(`left`/`center`/`right`) and `wrap` join `bold`, `fill`, `color` and
`border` (§3.5).

**P12 / P28 — Ref grammar.** A `ref` is a Unicode identifier: a letter or
`_`, then letters, digits or `_` (`[\p{L}_][\p{L}\p{N}_]*`). A ref that does
not fit, or ends in a digit, is quoted in formulas: `'Zo Doen'2`,
`'kw1'2`. Refs are case-sensitive in the file and must be unique per sheet;
duplicates are an error, not a silent rename.
*Amended by P33:* a ref may be any non-empty text (it is quoted when it is
not an identifier), refs compare case-insensitively, and they must be
unique per sheet case-insensitively. Refs from header text follow §4.4
(H1–H6); duplicate header texts lose their name with a warning instead of
being an error, since the CSV body must stay readable.

**P33 — Refs from the header text alone** (§4.4, proposal). Needed by P34
and by every sheet with a header and no `columns`. The ref is the header
text (NFC, trimmed, whitespace folded), quoted in formulas when it is not an
identifier or ends in a digit, compared case-insensitively. Empty and
duplicate headers get no name (letter fallback, warning). Renaming a header
in the source breaks formulas that use the old name; the editor is safe
because it rewrites refs from Yjs ids. Prototype:
`prototypes/ycsv/interop/csv/header-refs.ts`; the fixture corpus (every
header row in `interop/fixtures/`) round-trips A1 → YCSV → A1.

**P13 — Range defs.** A def value may be a formula that yields a range:
`cats: =categorieën!$id$2:$korting$4`. This is how Excel named ranges
import.

**P15 — Validation.** A `list` rule may point to a range
(`list: =categorieën!$id$2:$id$4`) or give an array. A new `range_value`
rule covers Excel's whole-number and decimal limits:
`range_value: {min: 0, max: 1000, integer: true}`. Rules apply to a `range`
of cells as well as to a column.

#### D.3.5 Formulas

**P4 — Formula grammar.** v1 formulas follow Excel's grammar, with named
refs in place of column letters:

- Absolute refs: `$prijs$2`, `$prijs2`, `prijs$2`. `$` has no effect on
  evaluation; it matters when a formula is copied or filled.
- Rectangular ranges across columns: `$id$2:$korting$4`, and the start and
  end refs may name different columns (§8.3 now requires the same ref).
- Whole columns: `totaal:totaal`, `producten!totaal:totaal`.
- Cross-sheet ranges: `producten!totaal2:totaal6` (the sheet prefix once).
- Operators: `&` (concatenation), `%` as **postfix percent** (`50%` = 0.5).
  Modulo is only `MOD()`. This replaces §8.6, where `%` is modulo.
- Precedence as Excel: unary minus binds tighter than `^` (`-2^2` = 4), and
  `^` is left-associative (`2^3^2` = 64).
- Text comparison (`=`, `<`, …) is case-insensitive, as in Excel.
- A bare ref without a row number (`prijs`) means the same row.

**P18 — Hyperlinks.** A hyperlink cell is a formula:
`=HYPERLINK("https://…","label")`.

**P21 — Function set.** §8.1 stops deferring to "whatever formulajs
supports". v1 lists its functions (the list in the spike report, 100+ names
across math, statistics, logic, lookup, text, date and info). Import rules:

- `_xlfn.` and `_xlws.` prefixes are stripped on read and added back on
  write.
- A function outside the list keeps the cell's cached value as a plain value
  and stores the original formula in `cells.<A1>.source_formula`. The import
  log says so. Google `__xludf.DUMMYFUNCTION` wrappers (functions such as
  `GOOGLEFINANCE` that Excel does not know) follow this rule.

**Errors, not aborts.** A ref to an unknown sheet and a circular reference
are per-cell errors (`#REF!`, `#CIRC!`), not hard errors that stop the whole
file (A.10, §8.7, §11.2). One broken formula in an imported workbook must not
make the other sheets unreadable.

#### D.3.6 Formula notation and locale

**Canonical in the file, locale in the editor.** The file always uses `.`
as the decimal mark and `,` between arguments (`=ROUND(3.27,1)`). The formula
editor shows and accepts the user's locale notation: in a locale whose
decimal mark is `,` (nl-NL, de-DE, fr-FR) that is `=ROUND(3,27;1)`. Strings
and quoted refs are never changed. Excel and LibreOffice work this way.

#### D.3.7 Import and export

**CSV import needs a locale.** Plain CSV import (not YCSV) asks for, or
detects, the separator and number locale, and parses the raw text with it.
It must not let a library guess: a Dutch Excel CSV (`;`, `0,45`,
`05-01-2026`) read with default settings turned `0,45` into 45 and
`05-01-2026` into 1 May.

**Import report.** Import may lose features; it must not lose them
silently. An importer produces a report listing every feature that degrades
or is lost, with the cells involved. Every formula whose evaluated result
differs from the value the source application cached is listed with both
values, and the cell is flagged until the user accepts it. A file read
without formulas (for example `.numbers` through SheetJS) says so once, with
the way to keep them.

**Cached values on export.** An XLSX or ODS export writes either correct
cached values for every formula, or none at all plus "recalculate on load".
It never writes values the engine got wrong, because LibreOffice (and Excel
in manual-calculation mode) show cached values as they are.
