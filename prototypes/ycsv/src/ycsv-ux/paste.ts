import { r1c1ToIdForm, tileSize, type Incoming } from "./clipboard";
import { shiftFormula, type ShiftCtx } from "./shift";

export type PasteCtx = ShiftCtx & {
  docId: string;
  /** File form → id form for formulas typed as text (`=SUM(A1:A3)`). */
  toId: (fileForm: string) => string;
  /** Id-form ref for a position, null when off the sheet. */
  refAt: (r: number, c: number, absRow: boolean, absCol: boolean) => string | null;
};

export type PastePlan = {
  /** Row-major id-form raw values, already tiled. */
  block: string[][];
  at: { r: number; c: number };
  /** Source range to clear after a cut from this document. */
  clearSource?: { r1: number; c1: number; r2: number; c2: number };
  wholeRows: boolean;
  wholeCols: boolean;
};

/**
 * Text from outside: a number with a thousands separator or currency sign becomes
 * a plain number when that is unambiguous. "1.234,50" (nl) and "1,234.50" (en)
 * both read as 1234.5; "2,5" reads as 2.5 only in a comma-decimal locale.
 */
export function looseNumber(text: string, commaDecimal: boolean): string {
  const t = text.replace(/[\s €$£%]/g, "");
  if (t === "" || !/^[-+]?[\d.,]+$/.test(t)) return text;
  if (/^[-+]?\d+$/.test(t)) return String(Number(t));
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  let normal: string;
  if (lastDot >= 0 && lastComma >= 0) {
    normal = lastComma > lastDot ? t.replaceAll(".", "").replace(",", ".") : t.replaceAll(",", "");
  } else if (lastComma >= 0) {
    normal = commaDecimal ? t.replace(",", ".") : t.replaceAll(",", "");
    if ((t.match(/,/g) ?? []).length > 1) normal = t.replaceAll(",", "");
  } else {
    normal = (t.match(/\./g) ?? []).length > 1 ? t.replaceAll(".", "") : t;
  }
  const n = Number(normal);
  return Number.isFinite(n) && /^[-+]?\d+(\.\d+)?$/.test(normal) ? String(n) : text;
}

export function planPaste(
  incoming: Incoming,
  target: { r1: number; c1: number; r2: number; c2: number },
  ctx: PasteCtx,
  opts: { valuesOnly: boolean; commaDecimal: boolean },
): PastePlan | null {
  let block: string[][];
  let clearSource: PastePlan["clearSource"];
  let wholeRows = false;
  let wholeCols = false;
  const at = { r: target.r1, c: target.c1 };

  if (incoming.kind === "ycsv") {
    const { clip } = incoming;
    wholeRows = !!clip.wholeRows;
    wholeCols = !!clip.wholeCols;
    const sameDoc = clip.doc === ctx.docId;
    const values = clip.values;
    if (opts.valuesOnly || !sameDoc) {
      // Row ids from another document mean nothing here: paste what the cells showed.
      block = values ?? clip.cells;
    } else if (clip.cut) {
      block = clip.cells;
      const h = clip.cells.length;
      const w = clip.cells[0]?.length ?? 0;
      clearSource = { r1: clip.origin.r, c1: clip.origin.c, r2: clip.origin.r + h - 1, c2: clip.origin.c + w - 1 };
    } else {
      block = clip.cells;
    }
  } else {
    block = incoming.rows.map((row, i) =>
      row.map((cell, j) => {
        if (!opts.valuesOnly && cell.r1c1) return r1c1ToIdForm(cell.r1c1, { r: at.r + i, c: at.c + j }, ctx.refAt);
        if (cell.num !== undefined) return String(cell.num);
        if (!opts.valuesOnly && cell.text.startsWith("=")) return ctx.toId(cell.text);
        return looseNumber(cell.text, opts.commaDecimal);
      }),
    );
  }

  const h = block.length;
  const w = Math.max(0, ...block.map((row) => row.length));
  if (h === 0 || w === 0) return null;
  const size = tileSize(h, w, target.r2 - target.r1 + 1, target.c2 - target.c1 + 1);
  const ycsvSame = incoming.kind === "ycsv" && incoming.clip.doc === ctx.docId && !opts.valuesOnly && !incoming.clip.cut;
  const origin = incoming.kind === "ycsv" ? incoming.clip.origin : at;
  const out: string[][] = [];
  for (let i = 0; i < size.rows; i += 1) {
    const row: string[] = [];
    for (let j = 0; j < size.cols; j += 1) {
      const si = i % h;
      const sj = j % w;
      const v = block[si]?.[sj] ?? "";
      if (ycsvSame && v.startsWith("=")) {
        // Move the formula from its source cell to this target cell.
        row.push(shiftFormula(v, at.r + i - (origin.r + si), at.c + j - (origin.c + sj), ctx));
      } else row.push(v);
    }
    out.push(row);
  }
  return { block: out, at, clearSource, wholeRows, wholeCols };
}
