// YCSV v1 conformance corpus (spike 11).
//
// Each case is a file plus what the spec (prototypes/ycsv/upstream/ycsv-spec-v1.md, unamended)
// says should happen. `expect.status`:
//   ok        — the spec says this parses; `values`/`refs`/`rows` pin the result
//   error     — the spec says this is a hard error
//   silent    — the spec does not say; `note` explains the question
// Values use spec row numbering (row 1 = first data row, §7.1) and `sheetref!key` for
// sheets other than the first. `run-conformance.ts` writes every case to `corpus/<id>.ycsv`.

export type Expect = {
  status: "ok" | "error" | "silent";
  refs?: string[];
  dataRows?: number;
  sheets?: number;
  values?: Record<string, string>;
  /** The spec requires a warning. */
  warns?: boolean;
  note?: string;
};

export type Case = { id: string; area: string; spec: string; title: string; text: string; expect: Expect };

const fm = (body: string) => `---\n${body.trim()}\n---\n`;
const V1 = "ycsv_version: 1";
/** One CSV line with RFC 4180 quoting (formulas with `,` or `"` must be quoted). */
const line = (...cells: string[]) =>
  cells.map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(",") + "\n";

export const CASES: Case[] = [
  // --- structure -------------------------------------------------------------------------
  {
    id: "s01-minimal-az",
    area: "structure",
    spec: "§9.1",
    title: "Minimal file, no header, A-Z refs",
    text: `${fm(V1)}Appels,6,0.45,=A1*B1*C1\nBrood,2,2.99,=B2*C2\nMelk,3,1.19,=B3*C3\n`,
    expect: { status: "ok", refs: ["A", "B", "C", "D"], dataRows: 3, values: { D2: "5.98", D3: "3.57" } },
  },
  {
    id: "s02-header-no-columns",
    area: "structure",
    spec: "§9.2",
    title: "Header row, no column definitions",
    text: `${fm(V1)}product,aantal,prijs,totaal\nAppels,6,0.45,=prijs1*aantal1\nBrood,2,2.99,=prijs2*aantal2\nMelk,3,1.19,=prijs3*aantal3\n`,
    expect: { status: "ok", refs: ["product", "aantal", "prijs", "totaal"], dataRows: 3, values: { totaal1: "2.7", totaal2: "5.98", totaal3: "3.57" } },
  },
  {
    id: "s03-typed-defs",
    area: "structure",
    spec: "§9.3",
    title: "Spec example 9.3: typed, defs, SUM over a column",
    text: `${fm(`${V1}
defs:
  btw: 0.21
  min_voorraad: 5
columns:
  - ref: product
    type: string
  - ref: aantal
    type: number
  - ref: prijs
    type: currency
    currency: EUR
    locale: nl-NL
  - ref: totaal
    type: currency
    currency: EUR
    locale: nl-NL`)}product,aantal,prijs,totaal\nAppels,6,0.45,=prijs1*aantal1*(1+btw)\nBrood,2,2.99,=prijs2*aantal2*(1+btw)\nMelk,3,1.19,=prijs3*aantal3*(1+btw)\n,,Totaal,=SUM(totaal1:totaal3)\n`,
    expect: { status: "ok", dataRows: 4, values: { totaal1: "3.267", totaal2: "7.2358", totaal3: "4.3197", totaal4: "14.8225" } },
  },
  {
    id: "s04-multisheet-unicode-ref",
    area: "multi-sheet",
    spec: "§9.4, §11.1",
    title: "Spec example 9.4: two sheets, sheet ref `categorieën`, cross-sheet ref",
    text: `${fm(`${V1}
defs:
  btw: 0.21
sheets:
  - ref: producten
    columns:
      - ref: product
      - ref: categorie
      - ref: prijs
        type: currency
        currency: EUR
      - ref: label
  - ref: categorieën
    columns:
      - ref: id
      - ref: label`)}product,categorie,prijs,label\nAppels,fruit,0.45,=categorieën!label1\nBrood,bakkerij,2.99,=categorieën!label2\n---\nid,label\nfruit,Fruit\nbakkerij,Bakkerij\n`,
    expect: { status: "ok", sheets: 2, values: { label1: "Fruit", label2: "Bakkerij", "categorieën!label1": "Fruit" } },
  },
  {
    id: "s05-multisheet-cross-range",
    area: "multi-sheet",
    spec: "§11.1",
    title: "Cross-sheet range in spec form `SUM(a!x1:a!x3)`",
    text: `${fm(`${V1}
sheets:
  - ref: totaal
  - ref: data`)}som\n=SUM(data!n1:data!n3)\n---\nn\n1\n2\n3\n`,
    expect: { status: "ok", sheets: 2, values: { som1: "6" } },
  },
  {
    id: "s06-multisheet-excel-range",
    area: "multi-sheet",
    spec: "§11.1",
    title: "Cross-sheet range in Excel form `SUM(a!x1:x3)`",
    text: `${fm(`${V1}
sheets:
  - ref: totaal
  - ref: data`)}som\n=SUM(data!n1:n3)\n---\nn\n1\n2\n3\n`,
    expect: { status: "silent", sheets: 2, values: { som1: "6" }, note: "Spec only shows the repeated-prefix form; Excel, Sheets and LibreOffice write `data!n1:n3`. Import needs this form." },
  },
  {
    id: "s07-multisheet-missing-sheet",
    area: "multi-sheet",
    spec: "§A.10",
    title: "Cross-sheet ref to an unknown sheet",
    text: `${fm(`${V1}
sheets:
  - ref: a`)}x\n=nope!x1\n`,
    expect: { status: "error", note: "A.10 makes this a hard (file-level) error; both spreadsheets show #REF! in the one cell instead." },
  },
  {
    id: "s08-multisheet-block-count",
    area: "multi-sheet",
    spec: "§2, §3.1",
    title: "More CSV blocks than `sheets` entries",
    text: `${fm(`${V1}
sheets:
  - ref: a`)}x\n1\n---\ny\n2\n`,
    expect: { status: "silent", note: "Spec does not say whether surplus blocks are an error, dropped, or new sheets." },
  },
  {
    id: "s09-multisheet-no-sheets-array",
    area: "multi-sheet",
    spec: "§2",
    title: "Two CSV blocks without a `sheets` array",
    text: `${fm(V1)}x\n1\n---\ny\n2\n`,
    expect: { status: "silent", note: "§2 implies sheets must be declared; core infers sheet1/sheet2 with a warning." },
  },
  {
    id: "s10-empty-body",
    area: "structure",
    spec: "§2",
    title: "Frontmatter only, empty body",
    text: `${fm(V1)}`,
    expect: { status: "ok", dataRows: 0 },
  },
  {
    id: "s11-no-trailing-newline",
    area: "structure",
    spec: "§7",
    title: "No trailing newline after the last row",
    text: `${fm(V1)}a,b\n1,2`,
    expect: { status: "ok", dataRows: 1, values: { a1: "1", b1: "2" } },
  },
  // --- encoding / line endings -----------------------------------------------------------
  {
    id: "e01-crlf",
    area: "encoding",
    spec: "§2.3",
    title: "CRLF everywhere, including the `---` markers",
    text: `---\r\n${V1}\r\n---\r\na,b\r\n1,=a1*2\r\n`,
    expect: { status: "ok", dataRows: 1, values: { b1: "2" } },
  },
  {
    id: "e02-crlf-multisheet",
    area: "encoding",
    spec: "§2.3",
    title: "CRLF in a multi-sheet file",
    text: `---\r\n${V1}\r\nsheets:\r\n  - ref: a\r\n  - ref: b\r\n---\r\nx\r\n1\r\n---\r\ny\r\n=a!x1+1\r\n`,
    expect: { status: "ok", sheets: 2, values: { "b!y1": "2" } },
  },
  {
    id: "e03-bom",
    area: "encoding",
    spec: "§2.2",
    title: "UTF-8 BOM before the first `---`",
    text: `﻿${fm(V1)}a\n1\n`,
    expect: { status: "silent", note: "§2.2 says 'No BOM' for writers but not what readers do. Excel writes a BOM in 'CSV UTF-8'; readers should strip it." },
  },
  {
    id: "e04-quoted-crlf-in-cell",
    area: "encoding",
    spec: "§2.3, §7",
    title: "CRLF inside a quoted cell",
    text: `${fm(V1)}a,b\n"line1\r\nline2",x\n`,
    expect: { status: "silent", note: "Both parsers drop every \\r, so the cell value changes. RFC 4180 keeps it. Spec does not say whether line endings inside cells are normalised." },
  },
  {
    id: "e05-unicode",
    area: "encoding",
    spec: "§2.2",
    title: "Non-ASCII text, emoji, RTL, combining marks",
    text: `${fm(V1)}naam,stad\nZoë,Den Haag\n😀,القاهرة\né,Ærø\n`,
    expect: { status: "ok", dataRows: 3, values: { naam1: "Zoë", naam2: "😀", stad2: "القاهرة" } },
  },
  // --- CSV quoting -----------------------------------------------------------------------
  {
    id: "q01-quotes",
    area: "quoting",
    spec: "§7",
    title: "Comma, doubled quote and newline inside quoted cells",
    text: `${fm(V1)}a,b,c\n"x, y","say ""hi""","two\nlines"\n`,
    expect: { status: "ok", dataRows: 1, values: { a1: "x, y", b1: 'say "hi"', c1: "two\nlines" } },
  },
  {
    id: "q02-separator-in-cell",
    area: "quoting",
    spec: "§2, §A.2",
    title: "A quoted multi-line cell with a line that is exactly `---`",
    text: `${fm(V1)}notes,n\n"before\n---\nafter",1\n`,
    expect: { status: "ok", dataRows: 1, values: { notes1: "before\n---\nafter", n1: "1" }, note: "Valid RFC 4180, but A.2 splits on every `\\n---\\n`, so a sheet body is cut in two." },
  },
  {
    id: "q03-quote-mid-field",
    area: "quoting",
    spec: "§7",
    title: "A quote in the middle of an unquoted field",
    text: `${fm(V1)}a,b\n5'11\",x\n`,
    expect: { status: "silent", note: "RFC 4180 forbids it; Excel and LibreOffice keep it literally. Spec does not choose lenient or strict." },
  },
  {
    id: "q04-ragged-rows",
    area: "quoting",
    spec: "§7",
    title: "Short and long rows",
    text: `${fm(V1)}a,b,c\n1\n1,2,3,4\n`,
    expect: { status: "silent", note: "Spec does not say whether short rows pad and long rows are cut, kept as extra columns, or an error." },
  },
  {
    id: "q05-trailing-comma",
    area: "quoting",
    spec: "§7",
    title: "Trailing comma = empty last cell",
    text: `${fm(V1)}a,b\n1,\n`,
    expect: { status: "ok", dataRows: 1, values: { a1: "1", b1: "" } },
  },
  {
    id: "q06-whitespace",
    area: "quoting",
    spec: "§7",
    title: "Spaces around values",
    text: `${fm(V1)}a,b\n 1 , x \n`,
    expect: { status: "silent", note: "RFC 4180 keeps spaces. Spec does not say whether ` 1 ` is the number 1 or the text ' 1 '." },
  },
  // --- empty rows / numbering ------------------------------------------------------------
  {
    id: "r01-empty-row-numbering",
    area: "rows",
    spec: "§7.2",
    title: "An empty separator row gets no row number",
    text: `${fm(V1)}a,b\n1,\n,\n2,=a2*10\n`,
    expect: { status: "ok", dataRows: 2, values: { b2: "20" }, note: "§7.2: the empty row has no number, so the row after it is row 2." },
  },
  {
    id: "r02-row-zero",
    area: "rows",
    spec: "§7.1",
    title: "Ref to row 0 (the header)",
    text: `${fm(V1)}a,b\n1,=a0\n`,
    expect: { status: "silent", note: "Row 0 is the header, but the spec does not say whether `a0` is #REF! or the header text." },
  },
  {
    id: "r03-row-out-of-range",
    area: "rows",
    spec: "§8.2",
    title: "Ref past the last row",
    text: `${fm(V1)}a,b\n1,=a9+1\n`,
    expect: { status: "silent", note: "Excel treats an empty cell as blank (=1). Spec does not say whether rows past the end are blank or #REF!." },
  },
  // --- frontmatter -----------------------------------------------------------------------
  {
    id: "f01-missing-version",
    area: "frontmatter",
    spec: "§3, §A.3",
    title: "No `ycsv_version`",
    text: `${fm("name: x")}a\n1\n`,
    expect: { status: "error" },
  },
  {
    id: "f02-higher-version",
    area: "frontmatter",
    spec: "§14",
    title: "`ycsv_version: 2`",
    text: `${fm("ycsv_version: 2")}a\n1\n`,
    expect: { status: "ok", warns: true, dataRows: 1 },
  },
  {
    id: "f03-no-frontmatter",
    area: "frontmatter",
    spec: "§A.2",
    title: "Plain CSV, no frontmatter",
    text: `a,b\n1,2\n`,
    expect: { status: "error", note: "A.2 says error. Core reads it as a sheet without a warning; for import that is the friendlier choice, but then it is not YCSV." },
  },
  {
    id: "f04-unterminated",
    area: "frontmatter",
    spec: "§A.2",
    title: "Frontmatter never closed",
    text: `---\n${V1}\na,b\n1,2\n`,
    expect: { status: "error" },
  },
  {
    id: "f05-bad-yaml",
    area: "frontmatter",
    spec: "§A.3",
    title: "Frontmatter is not valid YAML",
    text: `---\n${V1}\ncolumns: [\n---\na\n1\n`,
    expect: { status: "silent", note: "A.3 says 'parse as YAML' but not what a YAML error does. Core ignores the frontmatter, the prototype throws." },
  },
  {
    id: "f06-unknown-fields",
    area: "frontmatter",
    spec: "§14",
    title: "Unknown fields are ignored",
    text: `${fm(`${V1}\nfuture_thing: 3\ncolumns:\n  - ref: a\n    future_col: x`)}a\n1\n`,
    expect: { status: "ok", dataRows: 1, values: { a1: "1" } },
  },
  {
    id: "f07-yaml-coercion",
    area: "frontmatter",
    spec: "§3",
    title: "YAML 1.1 surprises: `ref: no`, `ref: 1e3`, `name: 2024-01-01`",
    text: `${fm(`${V1}\ncolumns:\n  - ref: no\n  - ref: on\n    name: 2024-01-01`)}no,on\n1,2\n`,
    expect: { status: "silent", note: "js-yaml (YAML 1.1 core) and `yaml` (1.2) read `no`/`on`/dates differently. The spec does not name a YAML version." },
  },
  // --- column identity -------------------------------------------------------------------
  {
    id: "c01-header-reordered",
    area: "columns",
    spec: "§4, §4.1",
    title: "Header order differs from `columns` order",
    text: `${fm(`${V1}\ncolumns:\n  - ref: product\n  - ref: prijs\n    type: number`)}prijs,product\n2.5,Appels\n`,
    expect: { status: "ok", refs: ["product", "prijs"], values: { prijs1: "2.5", product1: "Appels" }, note: "§4.1: header matched by name, 'making column reordering safe'." },
  },
  {
    id: "c02-columns-no-header",
    area: "columns",
    spec: "§4",
    title: "`columns` with refs, no header row",
    text: `${fm(`${V1}\ncolumns:\n  - ref: a\n  - ref: b`)}1,=a1+1\n`,
    expect: { status: "ok", refs: ["a", "b"], dataRows: 1, values: { b1: "2" } },
  },
  {
    id: "c03-numeric-header",
    area: "columns",
    spec: "§4.1",
    title: "First row has a number, no `columns`",
    text: `${fm(V1)}jaar,2024,2025\nomzet,10,12\n`,
    expect: { status: "ok", refs: ["A", "B", "C"], dataRows: 2, note: "A header needs ALL values non-numeric, so this is data and refs fall back to A-Z." },
  },
  {
    id: "c04-data-looks-like-header",
    area: "columns",
    spec: "§4.1",
    title: "Text-only data with no header (a list of names)",
    text: `${fm(V1)}Alice,Amsterdam\nBob,Utrecht\n`,
    expect: { status: "ok", refs: ["alice", "amsterdam"], dataRows: 1, note: "The heuristic eats the first data row as a header. Exports from other apps hit this often. See amendment P2 (explicit `header`)." },
  },
  {
    id: "c05-header-with-spaces",
    area: "columns",
    spec: "§3.2, §4",
    title: "Header values with spaces and capitals, no `columns`",
    text: `${fm(V1)}Unit Price,Qty\n2,3\n`,
    expect: { status: "silent", note: "Refs must be 'lowercase, no spaces' (§3.2), but §4 uses header values as refs. Core makes `unit_price`; the prototype keeps `Unit Price` and quotes it in formulas." },
  },
  {
    id: "c06-duplicate-refs",
    area: "columns",
    spec: "§3.2",
    title: "Two columns with the same ref",
    text: `${fm(`${V1}\ncolumns:\n  - ref: a\n  - ref: a`)}a,a\n1,2\n`,
    expect: { status: "silent", note: "Spec does not forbid duplicates. The prototype rejects them; core keeps both and resolves to the first." },
  },
  {
    id: "c07-ref-digit-suffix",
    area: "columns",
    spec: "§8.2",
    title: "Columns `q` and `q1`: what is `q12`?",
    text: `${fm(`${V1}\ncolumns:\n  - ref: q\n  - ref: q1\n  - ref: r`)}q,q1,r\n1,10,0\n2,20,=q12\n`,
    expect: { status: "silent", note: "`q12` is q row 12 or q1 row 2. Spec does not forbid refs that end in digits nor give a rule." },
  },
  {
    id: "c08-header-mismatch",
    area: "columns",
    spec: "§4",
    title: "Header has an unknown name next to known refs",
    text: `${fm(`${V1}\ncolumns:\n  - ref: a\n  - ref: b`)}a,x\n1,2\n`,
    expect: { status: "silent", note: "Not all values match refs, so per A.5 it is a data row (text 'a','x' in row 1). Probably not what the author meant." },
  },
  {
    id: "c09-az-beyond-z",
    area: "columns",
    spec: "§4.2",
    title: "28 columns, no header: AA and AB",
    text: `${fm(V1)}${Array.from({ length: 28 }, (_, i) => String(i + 1)).join(",")},=AA1+AB1\n`,
    expect: { status: "ok", values: { AC1: "55" } },
  },
  // --- types -----------------------------------------------------------------------------
  {
    id: "t01-numbers",
    area: "types",
    spec: "§5, §7.3",
    title: "Number spellings: `1e3`, `.5`, `+5`, `(9.99)`, `-0`, `007`",
    text: `${fm(`${V1}\ncolumns:\n  - ref: n\n    type: number\n  - ref: x`)}n,x\n1e3,=n1+0\n.5,=n2+0\n+5,=n3+0\n(9.99),=n4+0\n-0,=n5+0\n007,=n6+0\n`,
    expect: { status: "ok", values: { x4: "-9.99", x6: "7" }, note: "Only `-9.99` and `(9.99)` are defined. `1e3`, `.5` and `+5` are not mentioned." },
  },
  {
    id: "t02-locale-number-in-file",
    area: "types",
    spec: "§5, §6",
    title: "Locale-formatted numbers in the file (`1.234,56`, `€ 3,27`, `50%`)",
    text: `${fm(`${V1}\ncolumns:\n  - ref: n\n    type: number\n  - ref: x`)}n,x\n"1.234,56",=n1+0\n"€ 3,27",=n2+0\n50%,=n3+0\n`,
    expect: { status: "ok", values: { x1: "#VALUE!", x2: "#VALUE!", x3: "#VALUE!" }, note: "§5: not parseable as the type → string + warning. Canonical storage is `.`-decimal without symbols." },
  },
  {
    id: "t03-booleans",
    area: "types",
    spec: "§7.4",
    title: "`true`, `TRUE`, `True`, `1` in a boolean column",
    text: `${fm(`${V1}\ncolumns:\n  - ref: b\n    type: boolean\n  - ref: x`)}b,x\n${line("true", "=IF(b1,1,0)")}${line("TRUE", "=IF(b2,1,0)")}${line("True", "=IF(b3,1,0)")}`,
    expect: { status: "ok", values: { x1: "1", x2: "1" }, note: "Lowercase is canonical, uppercase is accepted by A.6. `True` is not defined." },
  },
  {
    id: "t04-percent",
    area: "types",
    spec: "§5, §6.3",
    title: "Percent stored as 50 = 50%, used in a formula",
    text: `${fm(`${V1}\ncolumns:\n  - ref: p\n    type: percent\n  - ref: x`)}p,x\n50,=200*p1\n`,
    expect: { status: "silent", note: "Display divides by 100, but the spec does not say what `p1` is in a formula: 50 or 0.5. Excel stores 0.5. This makes `=200*p1` 10000 vs 100 — a format-level decision." },
  },
  {
    id: "t05-dates",
    area: "types",
    spec: "§5, §8.1",
    title: "Date arithmetic: difference, +1 day, invalid date",
    text: `${fm(`${V1}\ncolumns:\n  - ref: d\n    type: date\n  - ref: x`)}d,x\n2024-01-31,=d2-d1\n2024-03-01,=d1+1\n2024-02-30,=YEAR(d3)\n`,
    expect: { status: "silent", values: { x1: "30" }, note: "§8.1 warns that formulajs returns Date objects, but the spec does not define date values in formulas (serial number? ISO text?) nor what `d1+1` returns." },
  },
  {
    id: "t06-time-datetime",
    area: "types",
    spec: "§5",
    title: "Time and datetime values with zones and fractions",
    text: `${fm(`${V1}\ncolumns:\n  - ref: t\n    type: time\n  - ref: dt\n    type: datetime`)}t,dt\n09:30:00,2024-01-31T09:30:00\n24:00:00,2024-01-31T09:30:00Z\n09:30,2024-01-31T09:30:00.250+01:00\n`,
    expect: { status: "silent", note: "No time zone rule: is `2024-01-31T09:30:00` local or UTC? `Z` and offsets are ISO 8601 but not listed." },
  },
  {
    id: "t07-currency-no-code",
    area: "types",
    spec: "§6.1",
    title: "`type: currency` without `currency`",
    text: `${fm(`${V1}\ncolumns:\n  - ref: c\n    type: currency`)}c\n3.5\n`,
    expect: { status: "silent", note: "§6.1 says `currency` is required, but not what a reader does without it. Core falls back to USD." },
  },
  {
    id: "t08-literal-equals",
    area: "types",
    spec: "§8",
    title: "A text value that starts with `=`",
    text: `${fm(V1)}a\n"=not a formula"\n`,
    expect: { status: "silent", note: "Every value that starts with `=` is a formula, quoted or not. There is no way to store the text `=x` (Excel uses a leading `'`)." },
  },
  // --- formulas --------------------------------------------------------------------------
  {
    id: "x01-precedence",
    area: "formulas",
    spec: "§8.6",
    title: "Operator precedence: `-2^2`, `2^3^2`, `2+3*4`",
    text: `${fm(V1)}a,b,c\n=-2^2,=2^3^2,=2+3*4\n`,
    expect: { status: "silent", values: { c1: "14" }, note: "Excel: -2^2 = 4 and 2^3^2 = 64 (left-assoc). Sheets: 4 and 64. LibreOffice: 4 and 64. Spec gives no precedence." },
  },
  {
    id: "x02-percent-operator",
    area: "formulas",
    spec: "§8.6",
    title: "`%`: modulo in the spec, postfix percent in Excel",
    text: `${fm(V1)}a,b\n=7%3,=50%\n`,
    expect: { status: "ok", values: { a1: "1" }, note: "Spec: `%` is modulo. Excel/Sheets/LibreOffice: `50%` = 0.5 and `7%3` is a syntax error. Imported formulas with `%` change meaning." },
  },
  {
    id: "x03-concat",
    area: "formulas",
    spec: "§8.6",
    title: "`&` string concatenation",
    text: `${fm(V1)}a,b\n${line("x", '=a1&"y"')}`,
    expect: { status: "silent", values: { b1: "xy" }, note: "`&` is not in §8.6 but is one of the most used operators in real workbooks." },
  },
  {
    id: "x04-absolute-refs",
    area: "formulas",
    spec: "§8.2",
    title: "Absolute refs `$a$1`",
    text: `${fm(V1)}a,b\n2,=a1*$a$1\n3,=a2*$a$1\n`,
    expect: { status: "silent", values: { b1: "4", b2: "6" }, note: "No `$` in the spec. Imported workbooks are full of them; fill/copy needs them." },
  },
  {
    id: "x05-rect-range",
    area: "formulas",
    spec: "§8.3",
    title: "Rectangular range `a1:b2`",
    text: `${fm(V1)}a,b,c\n1,2,=SUM(a1:b2)\n3,4,\n`,
    expect: { status: "error", values: { c1: "10" }, note: "§8.3: start and end must share the same ref, so this is invalid; Excel ranges are rectangles (VLOOKUP tables, SUMPRODUCT)." },
  },
  {
    id: "x06-same-row-ref",
    area: "formulas",
    spec: "§8.2",
    title: "Bare same-row ref `=aantal*prijs` (prototype extension)",
    text: `${fm(V1)}aantal,prijs,totaal\n2,3,=aantal*prijs\n`,
    expect: { status: "silent", values: { totaal1: "6" }, note: "Not in the spec; spike 4–6 recommend it (one shared formula per column). Spec would read `aantal` as a def name → error." },
  },
  {
    id: "x07-defs",
    area: "formulas",
    spec: "§3.3",
    title: "Scalar, mapping `.key` and a def shadowed by a column",
    text: `${fm(`${V1}\ndefs:\n  btw: 0.21\n  cat:\n    z: Zuivel\n  a: 99`)}a,b,c\n100,=a1*(1+btw),=cat.z\n`,
    expect: { status: "ok", values: { b1: "121", c1: "Zuivel" } },
  },
  {
    id: "x08-circular",
    area: "formulas",
    spec: "§8.7, §A.10",
    title: "Circular refs, including a self-ref",
    text: `${fm(V1)}a,b,c\n=b1,=a1,=c1\n`,
    expect: { status: "error", note: "A.10: hard error. Excel and Sheets show a per-cell circular error and keep the file open." },
  },
  {
    id: "x09-blank-semantics",
    area: "formulas",
    spec: "§8",
    title: "Blank vs 0 vs empty string",
    text: `${fm(V1)}a,b,c,d,e\n,=a1+1,=a1=0,"=a1=""""",=COUNTA(a1:a1)\n`,
    expect: { status: "silent", values: { b1: "1", c1: "TRUE", d1: "TRUE", e1: "0" }, note: "Excel values shown. Spec does not define blank." },
  },
  {
    id: "x10-text-to-number",
    area: "formulas",
    spec: "§8",
    title: "Text that looks like a number: `=\"3\"+1`, SUM over text cells",
    text: `${fm(V1)}a,b,c\n${line("3", '=""&a1+1', "=SUM(a1:a2)")}${line('=""&4', '="3"+1', "")}`,
    expect: { status: "silent", values: { b2: "4", c1: "3" }, note: "Excel: `=\"3\"+1` is 4, SUM skips text (here a1 is the number 3, a2 the text \"4\"), so 3. Also: CSV quoting cannot mark `3` as text in an untyped column — there is no way to store the text \"007\" except a `string` column type." },
  },
  {
    id: "x11-float",
    area: "formulas",
    spec: "§8",
    title: "Floating point: `=0.1+0.2`, `=ROUND(2.675,2)`",
    text: `${fm(V1)}a,b\n${line("=0.1+0.2", "=ROUND(2.675,2)")}`,
    expect: { status: "silent", values: { a1: "0.3", b1: "2.68" }, note: "Excel shows 0.3 (15 significant digits) and ROUND gives 2.68. Spec does not define precision." },
  },
  {
    id: "x12-string-compare",
    area: "formulas",
    spec: "§8.6",
    title: "Case-insensitive text compare `\"a\"=\"A\"`",
    text: `${fm(V1)}a\n${line('="a"="A"')}`,
    expect: { status: "silent", values: { a1: "TRUE" }, note: "Excel, Sheets and LibreOffice compare text case-insensitively." },
  },
  {
    id: "x13-errors-propagate",
    area: "formulas",
    spec: "§8.5",
    title: "Division by zero and IFERROR",
    text: `${fm(V1)}a,b,c\n${line("0", "=1/a1", '=IFERROR(b1,"x")')}`,
    expect: { status: "ok", values: { b1: "#DIV/0!", c1: "x" } },
  },
  {
    id: "x14-unknown-function",
    area: "formulas",
    spec: "§8.1",
    title: "Unknown function",
    text: `${fm(V1)}a\n=NOPE(1)\n`,
    expect: { status: "ok", values: { a1: "#NAME?" } },
  },
  {
    id: "x15-xlookup-sumifs",
    area: "formulas",
    spec: "§8.1",
    title: "SUMIFS / COUNTIF / XLOOKUP over columns",
    text: `${fm(V1)}k,v,out\n${line("a", "1", '=SUMIF(k1:k3,"a",v1:v3)')}${line("b", "2", '=COUNTIF(k1:k3,"a")')}${line("a", "3", '=XLOOKUP("b",k1:k3,v1:v3)')}`,
    expect: { status: "ok", values: { out1: "4", out2: "2", out3: "2" } },
  },
  {
    id: "x16-whole-column",
    area: "formulas",
    spec: "§8.3",
    title: "Whole-column range `SUM(v:v)`",
    text: `${fm(V1)}v,s\n1,=SUM(v:v)\n2,\n`,
    expect: { status: "silent", values: { s1: "3" }, note: "Very common in imported workbooks (`SUM(B:B)`), not in the spec." },
  },
];
