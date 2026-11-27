import type { SheetLayout } from "./types";

/** Sort key compare: numbers numerically, then strings (code-unit order, deterministic), blanks last. */
export function compareCellValues(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  const na = Number(a);
  const nb = Number(b);
  const aNum = a.trim() !== "" && Number.isFinite(na);
  const bNum = b.trim() !== "" && Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : 1;
}

/** The new row order after a stable sort by `colId`. */
export function sortedOrder(
  order: string[],
  valueOf: (rowId: string) => string,
  descending = false,
): string[] {
  const keyed = order.map((id, index) => ({ id, index, v: valueOf(id) }));
  keyed.sort((x, y) => {
    let c = compareCellValues(x.v, y.v);
    if (descending && x.v !== "" && y.v !== "") c = -c;
    return c !== 0 ? c : x.index - y.index;
  });
  return keyed.map((item) => item.id);
}

const REF = String.raw`(?:'(?:[^']|'')*'|[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*)`;
const ID = String.raw`[A-Za-z0-9_-]+`;
const RANGE = new RegExp(`(${REF})@(${ID}):(${REF})@(${ID})`, "g");

/**
 * Sort moves values, not the frame (Excel / Google Sheets semantics): a range
 * `X@a:Y@b` whose endpoints were at positions i and j covers positions i..j
 * again after the sort. Point refs (`X@a`) keep following their row.
 * Returns the rewritten id-form value, or the input when nothing changed.
 */
export function rewriteRangesForSort(
  value: string,
  oldIndex: ReadonlyMap<string, number>,
  newOrder: readonly string[],
): string {
  if (!value.startsWith("=") || !value.includes(":")) return value;
  return value.replace(RANGE, (whole, r1: string, a: string, r2: string, b: string) => {
    const i = oldIndex.get(a);
    const j = oldIndex.get(b);
    if (i === undefined || j === undefined) return whole;
    const na = newOrder[i];
    const nb = newOrder[j];
    if (na === undefined || nb === undefined) return whole;
    return `${r1}@${na}:${r2}@${nb}`;
  });
}

/** Apply `rewriteRangesForSort` to every formula cell; `set` writes inside the caller's transaction. */
export function rewriteAllRangesForSort(
  layout: Pick<SheetLayout, "colOrder" | "cell">,
  doc: Parameters<SheetLayout["cell"]>[0],
  oldOrder: readonly string[],
  newOrder: readonly string[],
  set: (rowId: string, colId: string, value: string) => void,
): void {
  const oldIndex = new Map<string, number>();
  oldOrder.forEach((id, index) => oldIndex.set(id, index));
  const cols = layout.colOrder(doc);
  for (const rowId of newOrder) {
    for (const colId of cols) {
      const value = layout.cell(doc, rowId, colId);
      if (!value || value.charCodeAt(0) !== 61 /* = */) continue;
      const next = rewriteRangesForSort(value, oldIndex, newOrder);
      if (next !== value) set(rowId, colId, next);
    }
  }
}

/** First occurrence wins; returns the deduped list and how many entries were dropped. */
export function dedupe(ids: readonly string[]): { ids: string[]; dropped: number } {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return { ids: out, dropped: ids.length - out.length };
}
