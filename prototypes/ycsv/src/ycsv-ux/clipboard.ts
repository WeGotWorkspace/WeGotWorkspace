/**
 * Clipboard formats.
 *
 * Out: text/plain is TSV of what the cells show (what Excel, Sheets and Numbers
 * all read). text/html is a <table> with the same text, plus the raw cells in a
 * `data-ycsv` attribute on the table. That private payload rides inside HTML on
 * purpose: Safari and Firefox drop custom MIME types on the system clipboard, but
 * every browser keeps text/html. Google Sheets uses the same trick.
 *
 * In: our own payload first, then an HTML table (Excel, Sheets, Numbers, web
 * pages), then TSV.
 */
export type YcsvClip = {
  v: 1;
  /** Id-form raw cells, row-major. */
  cells: string[][];
  /** Computed values, unformatted (for paste values-only and other documents). */
  values: string[][];
  /** Where the block came from, for shifting formulas. */
  origin: { r: number; c: number };
  /** Source document, so a paste into another document does not reuse row ids. */
  doc: string;
  /** Copied whole rows / whole columns (row or column header selection). */
  wholeRows?: boolean;
  wholeCols?: boolean;
  cut?: boolean;
};

export type IncomingCell = {
  text: string;
  /** A formula from Google Sheets in R1C1 form (`data-sheets-formula`). */
  r1c1?: string;
  /** Raw number Excel or Sheets attached to a formatted cell. */
  num?: number;
};

export type Incoming =
  | { kind: "ycsv"; clip: YcsvClip; grid: string[][] }
  | { kind: "table"; rows: IncomingCell[][]; source: "excel" | "sheets" | "numbers" | "html" }
  | { kind: "text"; rows: IncomingCell[][] };

function tsvField(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toTsv(grid: string[][]): string {
  return grid.map((row) => row.map(tsvField).join("\t")).join("\n");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function toHtml(grid: string[][], clip: YcsvClip): string {
  const body = grid
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell).replaceAll("\n", "<br>")}</td>`).join("")}</tr>`)
    .join("");
  return `<meta charset="utf-8"><table data-ycsv="${escapeHtml(JSON.stringify(clip))}"><tbody>${body}</tbody></table>`;
}

/** RFC-4180-ish TSV parse: quotes may wrap tabs and newlines (Excel does that). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const ch = src[i] ?? "";
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === "\t") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cellText(td: Element): string {
  // <br> is a line break inside the cell; block whitespace is layout noise.
  const clone = td.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return (clone.textContent ?? "").replace(/[ \t\r]*\n[ \t\r]*/g, "\n").replace(/[ \t\r]+/g, " ").replace(/ /g, " ").trim();
}

function sourceOf(html: string, doc: Document): "excel" | "sheets" | "numbers" | "html" {
  if (doc.querySelector("google-sheets-html-origin") || html.includes("data-sheets-")) return "sheets";
  if (html.includes("urn:schemas-microsoft-com:office:excel") || html.includes("mso-")) return "excel";
  if (/Cocoa HTML Writer|Numbers/i.test(html)) return "numbers";
  return "html";
}

export function parseHtmlTable(html: string): Incoming | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const own = table.getAttribute("data-ycsv");
  if (own) {
    try {
      const clip = JSON.parse(own) as YcsvClip;
      if (clip.v === 1 && Array.isArray(clip.cells)) return { kind: "ycsv", clip, grid: clip.cells };
    } catch {
      // Fall through to the visible table.
    }
  }
  const source = sourceOf(html, doc);
  const rows: IncomingCell[][] = [];
  // rowspan bookkeeping: column index → rows still covered.
  const carry = new Map<number, number>();
  table.querySelectorAll("tr").forEach((tr) => {
    const out: IncomingCell[] = [];
    let col = 0;
    const skipCarried = () => {
      while ((carry.get(col) ?? 0) > 0) {
        carry.set(col, (carry.get(col) ?? 0) - 1);
        out.push({ text: "" });
        col += 1;
      }
    };
    tr.querySelectorAll("td, th").forEach((td) => {
      skipCarried();
      const cell: IncomingCell = { text: cellText(td) };
      const formula = td.getAttribute("data-sheets-formula");
      if (formula) cell.r1c1 = formula;
      const sheetsValue = td.getAttribute("data-sheets-value");
      if (sheetsValue) {
        try {
          const parsed = JSON.parse(sheetsValue) as Record<string, unknown>;
          if (typeof parsed["3"] === "number") cell.num = parsed["3"];
        } catch {
          // Ignore a malformed hint; the text still pastes.
        }
      }
      const xnum = td.getAttribute("x:num");
      if (xnum !== null && xnum !== "" && !Number.isNaN(Number(xnum))) cell.num = Number(xnum);
      out.push(cell);
      const span = Math.max(1, Number(td.getAttribute("colspan") ?? 1));
      const rowspan = Math.max(1, Number(td.getAttribute("rowspan") ?? 1));
      for (let k = 0; k < span; k += 1) {
        if (rowspan > 1) carry.set(col + k, rowspan - 1);
        if (k > 0) out.push({ text: "" });
      }
      col += span;
    });
    skipCarried();
    rows.push(out);
  });
  if (rows.length === 0) return null;
  return { kind: "table", rows, source };
}

export function readIncoming(html: string, text: string): Incoming | null {
  if (html) {
    const parsed = parseHtmlTable(html);
    if (parsed) return parsed;
  }
  if (text) return { kind: "text", rows: parseTsv(text).map((row) => row.map((t) => ({ text: t }))) };
  return null;
}

/**
 * A Google Sheets R1C1 formula (`=R[0]C[-2]*R[0]C[-1]`, `=SUM(R[-3]C:R[-1]C)`)
 * turned into positions relative to the paste target. `refAt(r, c)` gives the id-form
 * ref for an absolute position (or null when off-sheet).
 */
export function r1c1ToIdForm(
  formula: string,
  at: { r: number; c: number },
  refAt: (r: number, c: number, absRow: boolean, absCol: boolean) => string | null,
): string {
  return formula.replace(/R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?/g, (_m, rs: string | undefined, cs: string | undefined) => {
    const part = (s: string | undefined, base: number): { v: number; abs: boolean } => {
      if (!s) return { v: base, abs: false };
      if (s.startsWith("[")) return { v: base + Number(s.slice(1, -1)), abs: false };
      return { v: Number(s) - 1, abs: true };
    };
    const r = part(rs, at.r);
    const c = part(cs, at.c);
    return refAt(r.v, c.v, r.abs, c.abs) ?? "#REF!";
  });
}

/** Excel-style tiling: repeat the block when the target is an exact multiple. */
export function tileSize(clipRows: number, clipCols: number, selRows: number, selCols: number): { rows: number; cols: number } {
  const rows = selRows > clipRows && selRows % clipRows === 0 ? selRows : clipRows;
  const cols = selCols > clipCols && selCols % clipCols === 0 ? selCols : clipCols;
  return { rows, cols };
}
