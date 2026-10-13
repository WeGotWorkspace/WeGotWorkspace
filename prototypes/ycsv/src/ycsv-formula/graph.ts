import type { Node } from "./ast";
import { evalNode, isCellError, type CellError, type EvalCtx, type Value } from "./eval";
import { parseFormula } from "./parser";

export type RawCells = Map<string, string>;
export type Values = Map<string, Value>;

const AST_CACHE_LIMIT = 10_000;
const astCache = new Map<string, Node | CellError>();
let astMisses = 0;

function astFor(src: string): Node | CellError {
  const hit = astCache.get(src);
  if (hit !== undefined) return hit;
  if (astCache.size >= AST_CACHE_LIMIT) astCache.clear();
  astMisses += 1;
  let n: Node | CellError;
  try {
    n = parseFormula(src.slice(1));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    n = isCellError(message) ? message : "#SYNTAX";
  }
  astCache.set(src, n);
  return n;
}

export function astCacheStats(): { entries: number; misses: number } {
  return { entries: astCache.size, misses: astMisses };
}

type Item = { ast: Node | null; literal?: Value };

function literal(raw: string): Value {
  if (raw === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function splitKey(key: string): { col: string; row: string } {
  const at = key.indexOf("@");
  return { col: key.slice(0, at), row: key.slice(at + 1) };
}

function orderedKeys(raw: RawCells, rowOrder: string[]): string[] {
  const byRow = new Map<string, string[]>();
  for (const key of raw.keys()) {
    const { col, row } = splitKey(key);
    const cols = byRow.get(row);
    if (cols) cols.push(col);
    else byRow.set(row, [col]);
  }
  for (const cols of byRow.values()) cols.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const keys: string[] = [];
  const seen = new Set<string>();
  const pushRow = (row: string) => {
    seen.add(row);
    for (const col of byRow.get(row) ?? []) keys.push(`${col}@${row}`);
  };
  for (const row of rowOrder) pushRow(row);
  for (const row of [...byRow.keys()].filter((row) => !seen.has(row)).sort()) pushRow(row);
  return keys;
}

function rangeRows(rowOrder: string[], rowIndex: ReadonlyMap<string, number>, from: string, to: string): string[] {
  const start = rowIndex.get(from);
  const end = rowIndex.get(to);
  if (start === undefined || end === undefined) return [];
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return rowOrder.slice(lo, hi + 1);
}

function dependencies(node: Node, rowOrder: string[], rowIndex: ReadonlyMap<string, number>, out: string[]) {
  switch (node.k) {
    case "ref":
      out.push(`${node.col}@${node.row}`);
      break;
    case "range":
      for (const row of rangeRows(rowOrder, rowIndex, node.from, node.to)) out.push(`${node.col}@${row}`);
      break;
    case "call":
      for (const arg of node.args) dependencies(arg, rowOrder, rowIndex, out);
      break;
    case "unary":
      dependencies(node.arg, rowOrder, rowIndex, out);
      break;
    case "bin":
      dependencies(node.l, rowOrder, rowIndex, out);
      dependencies(node.r, rowOrder, rowIndex, out);
      break;
    default:
      break;
  }
}

function lookupDef(defs: Record<string, unknown>, path: string): Value | undefined {
  let current: unknown = defs;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === "number" || typeof current === "string" || typeof current === "boolean") {
    if (typeof current === "string" && isCellError(current)) return current;
    return current;
  }
  return undefined;
}

export function evaluateAll(raw: RawCells, rowOrder: string[], defs: Record<string, unknown>): Values {
  const rowIndex = new Map<string, number>();
  rowOrder.forEach((id, i) => rowIndex.set(id, i));

  const items = new Map<string, Item>();
  for (const key of orderedKeys(raw, rowOrder)) {
    const text = raw.get(key) ?? "";
    if (!text.startsWith("=")) {
      items.set(key, { ast: null, literal: literal(text) });
      continue;
    }
    const parsed = astFor(text);
    if (typeof parsed === "string") items.set(key, { ast: null, literal: parsed });
    else items.set(key, { ast: parsed });
  }

  const values: Values = new Map();
  const color = new Map<string, "white" | "grey" | "black">();
  const cycle = new Set<string>();
  const ctx: EvalCtx = {
    cell: (col, row) => {
      if (!rowIndex.has(row)) return "#REF";
      const key = `${col}@${row}`;
      return values.has(key) ? (values.get(key) as Value) : "";
    },
    def: (path) => lookupDef(defs, path),
    rowOrder,
    rowIndex,
  };

  const visit = (key: string, stack: string[]) => {
    const item = items.get(key);
    if (!item) return;
    color.set(key, "grey");
    stack.push(key);
    if (item.ast) {
      const deps: string[] = [];
      dependencies(item.ast, rowOrder, rowIndex, deps);
      for (const dep of deps) {
        const state = color.get(dep) ?? "white";
        if (state === "grey") {
          for (const stacked of stack) cycle.add(stacked);
          cycle.add(dep);
        } else if (state === "white" && items.has(dep)) {
          visit(dep, stack);
        }
      }
    }
    stack.pop();
    color.set(key, "black");
    if (cycle.has(key)) {
      values.set(key, "#CYCLE");
      return;
    }
    if (!item.ast) {
      values.set(key, item.literal ?? "");
      return;
    }
    values.set(key, evalNode(item.ast, ctx));
  };

  for (const key of items.keys()) {
    if ((color.get(key) ?? "white") === "white") visit(key, []);
  }
  return values;
}
