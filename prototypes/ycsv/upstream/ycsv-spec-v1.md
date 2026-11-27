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

> **Proposal (spike 11):** split only on a `---` line outside quoted fields (P22). See Appendix B.

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

> **Proposal (spike 11):** readers strip a leading BOM; writers never write one (P24).

UTF-8. No BOM.

### 2.3 Line endings

> **Proposal (spike 11):** CR/CRLF inside a quoted cell is normalised to LF (P23).

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

> **Proposal (spike 11):** add `header`, `hidden`, `tab_color`, `freeze`, `merges`, `notes`, `validate` per sheet; Unicode ref grammar (P2, P3, P10, P11, P14, P15, P17).

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

> **Proposal (spike 11):** cells may carry `type`, format options and `excel_format`; add `italic`, `underline`, `align`, `wrap` (P9, P16).

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

> **Proposal (spike 11):** an explicit `header: true|false` per sheet overrides detection (P2).

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

> **Proposal (spike 11):** store percent as a fraction, 0.21 = 21% (P6).

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

> **Proposal (spike 11):** grid numbering: the header is row 1, the first data row is row 2 (P1).

Rows are numbered starting at **1** for the first data row. The header row
(if present) is row 0 and is not counted as a data row.

### 7.2 Empty rows

> **Proposal (spike 11):** empty rows keep their row number; trailing empty rows carry no meaning (P1, P26).

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

> **Proposal (spike 11):** an explicit v1 function list; `_xlfn.` handling; `source_formula` for unsupported functions (P21).

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

> **Proposal (spike 11):** Unicode refs, quoted refs (`'Zo Doen'2`), `$` absolute refs, same-row bare refs (P4, P12).

Formulas reference columns by their `ref` identifier (or A-Z fallback),
suffixed with a row number:

```
=aantal1*prijs1
=A1*B1
```

Both styles are valid and may be mixed. Named refs are preferred for
readability.

### 8.3 Aggregate functions

> **Proposal (spike 11):** rectangular ranges across columns and whole columns (`totaal:totaal`) (P4).

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

> **Proposal (spike 11):** `%` is postfix percent, `&` concatenates, Excel precedence (`-2^2` = 4, `2^3^2` = 64), case-insensitive text comparison (P4).

`+` `-` `*` `/` `^` (power) `%` (modulo)

Comparison: `=` `<>` `<` `>` `<=` `>=`

### 8.7 Formula evaluation order

> **Proposal (spike 11):** circular references are a per-cell error, not a file error (B.5).

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

> **Proposal (spike 11):** unknown sheet refs and circular references become per-cell errors (B.5).

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

---

## Appendix B: Proposed amendments (spike 11)

> **Status: Proposal (spike 11).** Nothing in this appendix is part of v1 yet.
> These proposals come from the interop spike (Excel, Google Sheets,
> LibreOffice). Evidence for each one is in
> `prototypes/ycsv/docs/spike-11-interop.md` and the conformance results in
> `prototypes/ycsv/docs/spike-11-conformance-results.md`. The sections they
> would change carry a short "Proposal (spike 11)" note.

Each proposal has an id (P1…P28). The ids match the spike report.

### B.1 Rows, header and body

**P1 — Grid row numbering.** Row numbers are the line numbers of the CSV
body. When a header row is present, it is row 1 and the first data row is
row 2. Empty rows keep their number. This replaces §7.1 and the "assigned no
row number" rule in §7.2.

- Why: Excel, LibreOffice and Google Sheets all number this way, so an
  imported `=C2*D2` becomes `=prijs2*aantal2` with the same digits, and an
  export needs no renumbering. Example 9.3 (`cells: A1:H1` for the header)
  already assumes it. The upstream engine (`spreadsheet-core`) already counts
  this way; the `prototypes/ycsv` model does not.
- Change for existing files: refs shift by one. A one-off rewrite at load is
  possible only if the file states which numbering it uses, so the
  alternative is to fold this into `ycsv_version: 2`.

**P2 / P27 — Explicit `header`.** A sheet may say `header: true` or
`header: false`. When it is missing, the §4.1 detection applies. Importers
always write it. This stops a first row such as `Totaal,2026,…` from being
taken for data, or a data row of text from being taken for a header.

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

### B.2 Sheets

**P3 / P17 — Sheet fields.** A `ref` follows the same grammar as a column
`ref` (B.4, P12). Sheet entries gain:

| Field       | Type    | Description                                   |
| ----------- | ------- | --------------------------------------------- |
| `header`    | boolean | See P2.                                       |
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

### B.3 Values

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

### B.4 Columns, cells and formats

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

**P13 — Range defs.** A def value may be a formula that yields a range:
`cats: =categorieën!$id$2:$korting$4`. This is how Excel named ranges
import.

**P15 — Validation.** A `list` rule may point to a range
(`list: =categorieën!$id$2:$id$4`) or give an array. A new `range_value`
rule covers Excel's whole-number and decimal limits:
`range_value: {min: 0, max: 1000, integer: true}`. Rules apply to a `range`
of cells as well as to a column.

### B.5 Formulas

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

### B.6 Formula notation and locale

**Canonical in the file, locale in the editor.** The file always uses `.`
as the decimal mark and `,` between arguments (`=ROUND(3.27,1)`). The formula
editor shows and accepts the user's locale notation: in a locale whose
decimal mark is `,` (nl-NL, de-DE, fr-FR) that is `=ROUND(3,27;1)`. Strings
and quoted refs are never changed. Excel and LibreOffice work this way.

### B.7 Import and export

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
