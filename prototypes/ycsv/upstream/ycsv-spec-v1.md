# YCSV Specification v1.0

> **YCSV** is a plain-text tabular data format combining a YAML frontmatter
> header with a CSV body. It adds column types, display formatting, styling,
> validation, and spreadsheet-style formulas to CSV — without sacrificing human
> readability or compatibility with standard tooling.

---

## 1. Motivation

CSV is the universal language of tabular data. Every tool speaks it. But CSV
has no concept of column types, number formatting, or computed values. XLSX
solves this but is a binary format, hostile to version control and plain-text
workflows. YCSV adds exactly what CSV is missing — nothing more.

---

## 2. File format

A YCSV file consists of one frontmatter block followed by one or more CSV
blocks, all separated by `---`.

**Single-sheet:**

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

The first `---`...`---` block is always YAML frontmatter. Every subsequent
`---`-separated block is a CSV body, in the same order as the `sheets` array.
Cross-file references are not supported — all sheets must be in the same file.

### 2.1 File extension

`.ycsv`

### 2.2 Encoding

UTF-8. No BOM.

### 2.3 Line endings

LF (`\n`) preferred. CRLF (`\r\n`) tolerated.

---

## 3. YAML frontmatter

### Required fields

| Field          | Type    | Description                  |
| -------------- | ------- | ---------------------------- |
| `ycsv_version` | integer | Spec version. Currently `1`. |

### Optional fields

| Field         | Type    | Description                                                                            |
| ------------- | ------- | -------------------------------------------------------------------------------------- |
| `name`        | string  | Human-readable sheet name.                                                             |
| `description` | string  | Free-text description.                                                                 |
| `created`     | date    | ISO 8601 date.                                                                         |
| `author`      | string  | Author name.                                                                           |
| `columns`     | array   | Ordered list of column definitions. See §3.1.                                          |
| `defs`        | mapping | Named values (scalars or mappings) referenceable in formulas and validation. See §3.3. |
| `cells`       | mapping | Cell-specific formatting overrides. See §3.5.                                          |
| `charts`      | array   | Vega-Lite chart definitions. See §12.                                                  |

### 3.1 Multi-sheet files

When a file contains multiple sheets, define them in a `sheets` array in the
frontmatter. Each entry has a `ref` (required) and may include all the fields
that would otherwise appear at the top level: `columns`, `defs`, `cells`,
and `charts`.

| Field     | Required | Type    | Description                                                                                                |
| --------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `ref`     | no       | string  | Sheet identifier. Used in cross-sheet formula references. Defaults to `sheet1`, `sheet2`, etc. if omitted. |
| `name`    | no       | string  | Display name. Defaults to `ref` if omitted.                                                                |
| `columns` | no       | array   | Column definitions. See §3.2.                                                                              |
| `defs`    | no       | mapping | Sheet-local defs. Merged with top-level defs; sheet-level takes precedence.                                |
| `cells`   | no       | mapping | Cell-specific overrides. See §3.5.                                                                         |
| `charts`  | no       | array   | Chart definitions. See §12.                                                                                |

```yaml
---
ycsv_version: 1
defs:
  btw: 0.21
sheets:
  - ref: producten
    name: Productenoverzicht
    columns:
      - ref: product
        type: string
      - ref: prijs
        type: currency
        currency: EUR
        locale: nl-NL
  - ref: categorieën
    columns:
      - ref: id
        type: string
      - ref: label
        type: string
---
product,prijs
Appels,0.45
Brood,2.99
---
id,label
zuivel,Zuivel
groente,Groente
```

Top-level `defs` are shared across all sheets. Sheet-level `defs`
are local to that sheet.

### 3.2 Column definitions

`columns` is optional. When omitted, all columns fall back to A-Z identifiers
(see §4).

Each entry in `columns` is a YAML block mapping. Column order must match CSV
column order.

| Field      | Required | Type    | Description                                                                      |
| ---------- | -------- | ------- | -------------------------------------------------------------------------------- |
| `ref`      | no       | string  | Identifier used in formulas. Lowercase, no spaces. Falls back to A-Z if omitted. |
| `name`     | no       | string  | Display name. Defaults to `ref` (or A-Z fallback) if omitted.                    |
| `type`     | no       | string  | See §5. Defaults to `string`.                                                    |
| `style`    | no       | mapping | Column-level styling. See §3.1.1.                                                |
| `validate` | no       | mapping | Input validation rules. See §3.1.2.                                              |

Additional Intl formatting fields may be present depending on `type` (see §6).

#### 3.1.1 Conditional styling

Style properties live under a `style` key on the column definition. `fill` and
`color` accept either a static hex value or a conditional formula. In a styling
formula, `IF` takes an implicit left-hand operand — the value of the current
cell in the current row. `AND`, `OR`, and `NOT` are supported.

| Style field | Type                          | Description                                   |
| ----------- | ----------------------------- | --------------------------------------------- |
| `fill`      | string                        | Background color. Hex or conditional formula. |
| `color`     | string                        | Text color. Hex or conditional formula.       |
| `bold`      | boolean or conditional string | Bold text. Accepts `IF(...)` formula.         |
| `border`    | boolean                       | Apply border. Renderer controls thickness.    |

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
```

Nested `IF` is supported.

#### 3.1.2 Validation

`validate` defines input rules for a column. All fields are optional and may
be combined.

| Field      | Type              | Description                                                                            |
| ---------- | ----------------- | -------------------------------------------------------------------------------------- |
| `required` | boolean           | Cell must not be empty.                                                                |
| `range`    | mapping           | Numeric bounds with optional `min` and/or `max`.                                       |
| `list`     | string or mapping | Name of a mapping def, or a cross-sheet def reference (see §3.4). Renders as dropdown. |
| `pattern`  | string            | ECMAScript regex the value must match.                                                 |

```yaml
columns:
  - ref: categorie
    validate:
      required: true
      list: categorieën # refers to constants.categorieën

  - ref: score
    validate:
      range:
        min: 0
        max: 100

  - ref: postcode
    validate:
      pattern: "^[0-9]{4}[A-Z]{2}$"

  - ref: email
    validate:
      pattern: "^[^@]+@[^@]+\\.[^@]+$"

  - ref: bedrag
    validate:
      required: true
      range:
        min: 0
```

Validation is enforced by the renderer on user input. Error presentation
(inline warning, blocking input, etc.) is renderer-defined.

### 3.3 Defs

`defs` is an optional YAML mapping of named values. Defs may be
referenced by name in any formula or validation rule, without a row number
suffix.

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
  btw: 0.21
  categorieën:
    zuivel: Zuivel
    groente: Groente
    fruit: Fruit
  status:
    actief: Actief
    inactief: Inactief
```

Types are inferred from the YAML value. No explicit `type` declaration is
needed.

Defs are referenced by name in formulas. The parser resolves names by
looking up `columns` first, then `defs` — so column refs take precedence
over defs with the same name.

```
=prijs1*(1+btw)
=IF(categorie1=categorieën.zuivel,"ja","nee")
=IF(aantal1>=min_voorraad,prijs1*0.9,prijs1)
```

In a mapping def, `.key` notation accesses the key's label:
`categorieën.zuivel` evaluates to `"Zuivel"`.

### 3.4 Cross-sheet constants

Defs may also be scoped per sheet (see §3.1). Sheet-level defs take precedence
over top-level defs with the same name.

```yaml
# cross-sheet example — categorieën defined in stamdata.ycsv
defs:
  categorieën:
    - Zuivel
    - Groente
    - Fruit
    - Bakkerij
    - Dranken
  statussen:
    - Actief
    - Inactief
    - Archief
```

### 3.5 Cell overrides

`cells` is a YAML mapping of cell references to style objects. Keys may be
single cells (`A1`), ranges (`A1:H1`), or column refs (`totaalwaarde`).
Cell-level overrides take precedence over column-level styling.

| Style field | Type                          | Description                                   |
| ----------- | ----------------------------- | --------------------------------------------- |
| `bold`      | boolean or conditional string | Bold text. Accepts `IF(...)` formula.         |
| `fill`      | string                        | Background color. Hex or conditional formula. |
| `color`     | string                        | Text color. Hex or conditional formula.       |
| `border`    | boolean                       | Apply border. Renderer controls thickness.    |

```yaml
cells:
  A1:H1:
    style:
      bold: true
      fill: "#f5f5f5"
  D8:
    style:
      bold: true
      border: true
  totaalwaarde:
    style:
      bold: IF(totaalwaarde > 200)
      color: IF(totaalwaarde > 200, "#2e7d32")
```

---

## 4. Column identity and fallback

YCSV resolves column identity in the following order:

| Situation                                | Column identity                           |
| ---------------------------------------- | ----------------------------------------- |
| `columns` with `ref` + header row in CSV | `ref` names, matched by name              |
| `columns` with `ref`, no header row      | position, `ref` from frontmatter          |
| No `columns`, header row present         | header values used as refs, no types      |
| No `columns`, no header row              | position, A-Z fallback (`A`, `B`, `C`...) |

### 4.1 Header row

A header row is the first CSV row where all values are non-numeric strings
matching known `ref` names (or any strings when no `columns` is defined).
Parsers use the header row to match columns by name rather than position,
making column reordering safe.

### 4.2 A-Z fallback

When no `ref` is defined for a column, it is assigned a letter identifier:
`A` for the first column, `B` for the second, and so on (up to `Z`, then
`AA`, `AB`, etc. following spreadsheet convention). These identifiers may be
used in formulas.

---

## 5. Column types

| Type       | Stored as             | Description                 |
| ---------- | --------------------- | --------------------------- |
| `string`   | plain text            | Default.                    |
| `number`   | integer or decimal    |                             |
| `currency` | decimal               | Rendered as monetary value. |
| `percent`  | display value         | 50 = 50%, not 0.5.          |
| `date`     | `YYYY-MM-DD`          | ISO 8601 date.              |
| `time`     | `HH:MM:SS`            | ISO 8601 time.              |
| `datetime` | `YYYY-MM-DDTHH:MM:SS` | ISO 8601 combined.          |
| `boolean`  | `true` / `false`      |                             |

Renderers should use `type` for parsing and display. A cell value that cannot
be parsed as the declared type is treated as a string and flagged as an error.

---

## 6. Display formatting

Formatting is delegated to the platform's `Intl` library. Column definitions
may include `Intl`-compatible options alongside `type`.

### 6.1 Numbers and currency

Uses `Intl.NumberFormat`. Relevant options:

| Field                   | Example | Description                                             |
| ----------------------- | ------- | ------------------------------------------------------- |
| `currency`              | `EUR`   | ISO 4217 currency code. Required when `type: currency`. |
| `locale`                | `nl-NL` | BCP 47 locale. Defaults to renderer's system locale.    |
| `minimumFractionDigits` | `2`     | Passed directly to `Intl.NumberFormat`.                 |
| `maximumFractionDigits` | `2`     | Passed directly to `Intl.NumberFormat`.                 |

Example renderer call:

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

Example renderer calls:

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

Stored as display value (50 = 50%). Renderer divides by 100 before passing
to `Intl.NumberFormat` with `style: 'percent'`.

### 6.4 Locale

`locale` may be specified per column. If omitted, the renderer uses the user's
system locale.

---

## 7. CSV body

The CSV body follows the YAML frontmatter. Standard RFC 4180 rules apply:

- Values are comma-separated. Quoted values may contain commas and newlines.
- Empty cell: `,` (two adjacent commas, or trailing comma).

### 7.1 Row numbering

Rows are numbered starting at **1** for the first data row. The header row
(if present) is row 0 and is not counted as a data row.

### 7.2 Empty rows

A fully empty row (all cells empty) is valid and has no data meaning. It
serves as a visual separator between sections. Empty rows are skipped during
formula evaluation and chart data injection. They are assigned no row number.

### 7.3 Negative numbers

Negative numbers may be stored in two formats:

| Format              | Example  | Notes                                                 |
| ------------------- | -------- | ----------------------------------------------------- |
| Prefixed minus      | `-9.99`  | Standard. Preferred for machine-generated files.      |
| Accounting notation | `(9.99)` | Accepted on input. Renderers may display either form. |

Both formats are valid in cell values and formula results. Parsers must
accept both. The `currency` type renderer may display negative values in
accounting notation depending on the user's locale.

### 7.4 Booleans

Boolean values are stored as `true` or `false` (lowercase). In formulas,
`TRUE` and `FALSE` (uppercase) are also valid and follow Excel convention —
they evaluate to `1` and `0` respectively in numeric contexts:

```
=IF(actief1=TRUE,prijs1,0)
=SUM(IF(actief1:actief4,prijs1:prijs4,0))
```

---

## 8. Formulas

A cell value starting with `=` is a formula. Formulas follow standard
spreadsheet syntax with one extension: **named column references**.

### 8.1 Formula library

The YCSV reference implementation uses
[`@formulajs/formulajs`](https://github.com/formulajs/formulajs) (MIT) as
its formula evaluation engine. This library implements the full set of
Microsoft Excel-compatible functions — `CONCAT`, `ROUND`, `FLOOR`, `CEIL`,
`TODAY`, `NOW`, `DATEDIF`, `VLOOKUP`, and hundreds more.

The YCSV spec does not enumerate supported functions. Any function supported
by the formula evaluation library is valid in a YCSV formula. The reference
implementation defines the baseline; other implementations may support a
different subset but should document any deviations.

One caveat: formulajs returns `DATE`, `NOW`, and `TODAY` as plain JS `Date`
objects rather than Excel serial numbers. Implementations must account for
this when evaluating date arithmetic.

### 8.2 Named column references

Formulas reference columns by their `ref` identifier (or A-Z fallback),
suffixed with a row number:

```
=aantal1*prijs1
=A1*B1
```

Both styles are valid and may be mixed. Named refs are preferred for
readability.

### 8.3 Aggregate functions

Standard aggregate functions operating over a column range:

```
=SUM(totaal1:totaal4)
=AVERAGE(prijs1:prijs3)
=COUNT(product1:product10)
=MIN(prijs1:prijs4)
=MAX(prijs1:prijs4)
```

Range syntax: `ref_start:ref_end` where start and end share the same `ref`
and differ only in row number.

### 8.4 Conditional: IF

```
=IF(condition, value_if_true, value_if_false)
```

`AND`, `OR`, and `NOT` are supported:

```
=IF(AND(voorraad1<10,actief1=TRUE),"laag","ok")
=IF(OR(score1<0,score1>100),"ongeldig",score1)
```

`IF` may be nested:

```
=IF(aantal1=0,"uitverkocht",IF(aantal1<5,"beperkt","op voorraad"))
```

### 8.5 Error handling: IFERROR

`IFERROR` catches formula errors and returns a fallback value:

```
=IFERROR(value, value_if_error)
```

Examples:

```
=IFERROR(totaal1/aantal1,0)
=IFERROR(VLOOKUP(product1,prijzen!A1:B10,2,FALSE),"niet gevonden")
```

Useful for division-by-zero, failed lookups, and cross-sheet references that
may be unavailable.

### 8.6 Supported operators

`+` `-` `*` `/` `^` (power) `%` (modulo)

Comparison: `=` `<>` `<` `>` `<=` `>=`

### 8.7 Formula evaluation order

Formulas are evaluated in dependency order (topological sort).
Circular references are an error.

---

## 9. Examples

### 9.1 Minimal valid YCSV

```
---
ycsv_version: 1
---
Appels,6,0.45,=A1*B1
Brood,2,2.99,=A2*B2
Melk,3,1.19,=A3*B3
```

### 9.2 With header row, no column definitions

```
---
ycsv_version: 1
---
product,aantal,prijs,totaal
Appels,6,0.45,=prijs1*aantal1
Brood,2,2.99,=prijs2*aantal2
Melk,3,1.19,=prijs3*aantal3
```

### 9.3 Fully typed with constants and styling

```
---
ycsv_version: 1
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
  A1:D1:
    style:
      bold: true
      fill: "#f5f5f5"
---
product,aantal,prijs,totaal
Appels,6,0.45,=prijs1*aantal1*(1+btw)
Brood,2,2.99,=prijs2*aantal2*(1+btw)
Melk,3,1.19,=prijs3*aantal3*(1+btw)
,,Totaal,=SUM(totaal1:totaal3)
```

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
    columns:
      - ref: product
        type: string
      - ref: categorie
        type: string
        validate:
          required: true
          list: categorieën
      - ref: prijs
        type: currency
        currency: EUR
        locale: nl-NL
      - ref: totaal_incl
        type: currency
        currency: EUR
        locale: nl-NL
  - ref: categorieën
    columns:
      - ref: id
        type: string
      - ref: label
        type: string
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

Cross-sheet ref example — display category label from the categorieën sheet:

```
=categorieën!label1
```

---

## 10. Compatibility

A YCSV file stripped of its frontmatter (everything up to and including the
second `---`) is valid CSV. Tools that do not understand YCSV can still read
the data rows — they will see formula strings as literal text values.

This is intentional. YCSV degrades gracefully.

---

## 11. Multi-sheet files

Multiple sheets live in a single `.ycsv` file. The `sheets` array in the
frontmatter defines all sheets; each subsequent `---`-separated block is the
CSV body for the corresponding sheet, in order. See §3.1.

Cross-file references are not supported.

### 11.1 Cross-sheet references

Use `sheetref!columnrefrow` syntax (see §3.4):

```
=categorieën!label1
=SUM(producten!totaal1:producten!totaal10)
```

### 11.2 Circular references

Circular cross-sheet references are an error.

---

## 12. Charts

Charts are defined in the frontmatter as an optional `charts` array. Each
chart is a [Vega-Lite](https://vega.github.io/vega-lite/) specification
(BSD-3 license) embedded as a YAML block mapping.

Vega-Lite is an open, declarative grammar for interactive visualizations.
YCSV renderers inject the sheet's data automatically — no `data` key is
needed in the chart spec. Column `ref` names map directly to Vega-Lite
`field` values.

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

- Inject the sheet's parsed data as the Vega-Lite `data.values` array.
- Pass the chart spec to the Vega-Lite compiler unchanged, except for the
  injected data.
- Render charts below the table by default. Layout is application-defined.

---

## 13. Sidecar files

UI state (column widths, frozen panes, sort/filter state, scroll position) is
stored in a `.ycsv.ui` sidecar alongside the `.ycsv` file. The sidecar is
renderer-defined and not part of this spec. It should be `.gitignore`d or
treated as non-canonical.

---

## 14. Versioning and forward compatibility

The `ycsv_version` field is an integer. Parsers encountering a version higher
than they support should warn the user and attempt a best-effort parse.

New fields added to column definitions or the frontmatter in future versions
must be ignored by v1 parsers (unknown fields are not an error).

---

## 15. Reference implementations

Reference implementations (parser, renderer, CLI validator) will be published
at a canonical repository under an MIT license. The spec itself is published
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

| Dependency             | License | Purpose            |
| ---------------------- | ------- | ------------------ |
| `@formulajs/formulajs` | MIT     | Formula evaluation |
| `vega-lite`            | BSD-3   | Chart rendering    |

---

_YCSV v1.0 — Draft. Feedback welcome._

---

## Appendix A: Parser algorithm

This appendix defines the normative parsing algorithm for a `.ycsv` file.
Implementations must produce equivalent results.

### A.1 Overview

```
1. Read file as UTF-8
2. Split into frontmatter and CSV body
3. Parse frontmatter
4. Parse CSV body
5. Resolve column identity
6. Evaluate formulas
7. Apply styling
```

### A.2 Step 1 — Split frontmatter and body

```
if file does not start with "---\n":
  error: "missing frontmatter opening marker"

find the second occurrence of "\n---\n" after the first marker
if not found:
  error: "missing frontmatter closing marker"

frontmatter_text = content between first "---\n" and second "\n---\n"
csv_text         = content after second "\n---\n"
```

### A.3 Step 2 — Parse frontmatter

```
parse frontmatter_text as YAML

if ycsv_version is missing:
  error: "ycsv_version is required"

if ycsv_version > known_version:
  warn: "unknown version, attempting best-effort parse"

columns   = frontmatter.columns   or []
defs = frontmatter.defs or {}
cells     = frontmatter.cells     or {}
charts    = frontmatter.charts    or []
```

### A.4 Step 3 — Parse CSV body

```
parse csv_text using RFC 4180 rules
result: list of rows, each row a list of cell strings

for each row:
  if all cells are empty:
    mark as EMPTY_ROW (skip for data, preserve for display)
```

### A.5 Step 4 — Resolve column identity

```
data_rows = non-empty rows

if columns is non-empty:
  assign ref to each column definition position:
    if column has no ref: assign A-Z fallback by position

  check if first data_row is a header row:
    a row is a header row if ALL of its values are strings
    that match known ref names (case-insensitive)

  if header row detected:
    use header row to map CSV columns to refs by name (order-independent)
    first data row index = 1 (header is row 0, not counted)
  else:
    map CSV columns to refs by position
    first data row index = 1

else:
  check if first data_row looks like a header row:
    a row is a header row if ALL values are non-numeric strings

  if header row detected:
    use header values as ref names
    assign type: string, no formatting to all columns
  else:
    assign A-Z fallback refs by position

number data rows from 1 upward, skipping EMPTY_ROWs
```

### A.6 Step 5 — Evaluate formulas

```
build cell graph:
  for each data cell:
    if cell value starts with "=":
      mark as FORMULA cell
      parse formula into AST
      extract dependencies (ref+rownumber pairs, def names,
                            cross-sheet references)

check for circular references in cell graph:
  if found: error: "circular reference at <ref><row>"

evaluate in dependency order (topological sort):
  for each FORMULA cell:
    resolve named refs:
      <ref><row> → value of cell at column ref, row row
      <ref><row>:<ref><row> → range of values
      <name> → defs[name]
      ./<file>.ycsv!<ref><row> → cross-sheet reference (see §A.8)
    evaluate AST using formula library
    store result

for non-formula cells:
  parse value according to column type:
    number / currency / percent → parse as float
      accept "-9.99" and "(9.99)" as negative
    date    → parse as ISO 8601 date
    time    → parse as ISO 8601 time
    datetime → parse as ISO 8601 datetime
    boolean → "true"/"TRUE" → true, "false"/"FALSE" → false
    string  → use as-is
  if parse fails: store as string, emit type warning
```

### A.7 Step 6 — Apply styling

```
for each data cell:
  collect applicable style rules in order (lowest to highest priority):
    1. column-level fill/color/border from columns[]
    2. cell-level overrides from cells{}

  for each style rule:
    if value is a static hex: apply directly
    if value is a conditional formula:
      evaluate formula with implicit LHS = current cell's evaluated value
      apply result

  final style = merged result of all applicable rules
```

### A.8 Cross-sheet references

```
when a formula contains <sheetref>!<columnref><row>:
  look up <sheetref> in the sheets array
  if not found: error
  return evaluated value of <columnref><row> from that sheet
  (all sheets are evaluated before cross-sheet refs are resolved)
```

### A.9 Chart injection

```
for each chart in charts:
  build Vega-Lite data.values array from evaluated data rows:
    each row → object keyed by ref name, value is the evaluated cell value
    skip EMPTY_ROWs
  inject as chart.spec.data = { values: [...] }
  pass completed spec to Vega-Lite compiler
```

### A.10 Error handling summary

| Error                           | Behaviour                                      |
| ------------------------------- | ---------------------------------------------- |
| Missing `ycsv_version`          | Hard error, abort                              |
| Unknown `ycsv_version`          | Warn, attempt parse                            |
| Unknown frontmatter field       | Ignore silently                                |
| Type parse failure              | Store as string, emit warning                  |
| Circular reference              | Hard error                                     |
| Cross-sheet sheet ref not found | Hard error                                     |
| Formula evaluation error        | Cell returns error value; `IFERROR` can handle |
| Validation failure              | Renderer-defined; not a parse error            |
