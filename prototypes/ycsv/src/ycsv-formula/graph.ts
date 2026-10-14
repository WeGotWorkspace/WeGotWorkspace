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

export function resetAstCache(): void {
  astCache.clear();
  astMisses = 0;
  depCache.clear();
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

export type AstDeps = {
  sameRowCols: string[];
  absolute: { col: string; row: string }[];
  ranges: { col: string; from: string; to: string }[];
};

const depCache = new Map<string, { columnsKey: string; deps: AstDeps }>();

export function astDeps(node: Node, isColumn: (path: string) => boolean): AstDeps {
  const out: AstDeps = { sameRowCols: [], absolute: [], ranges: [] };
  walkAst(node, isColumn, out);
  return out;
}

function walkAst(node: Node, isColumn: (path: string) => boolean, out: AstDeps): void {
  switch (node.k) {
    case "ref":
      out.absolute.push({ col: node.col, row: node.row });
      break;
    case "range":
      out.ranges.push({ col: node.col, from: node.from, to: node.to });
      break;
    case "name":
      if (!node.path.includes(".") && node.path !== "#REF!" && isColumn(node.path)) out.sameRowCols.push(node.path);
      break;
    case "call":
      for (const arg of node.args) walkAst(arg, isColumn, out);
      break;
    case "unary":
      walkAst(node.arg, isColumn, out);
      break;
    case "bin":
      walkAst(node.l, isColumn, out);
      walkAst(node.r, isColumn, out);
      break;
    default:
      break;
  }
}

export function cellDeps(
  deps: AstDeps,
  currentRow: string,
  rowOrder: string[],
  rowIndex: ReadonlyMap<string, number>,
): string[] {
  const keys: string[] = [];
  for (const col of deps.sameRowCols) keys.push(`${col}@${currentRow}`);
  for (const ref of deps.absolute) keys.push(`${ref.col}@${ref.row}`);
  for (const range of deps.ranges) {
    const start = rowIndex.get(range.from);
    const end = rowIndex.get(range.to);
    if (start === undefined || end === undefined) continue;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    for (let i = lo; i <= hi; i += 1) {
      const row = rowOrder[i];
      if (row) keys.push(`${range.col}@${row}`);
    }
  }
  return keys;
}

function cachedAstDeps(src: string, ast: Node, isColumn: (path: string) => boolean, columnsKey: string): AstDeps {
  const hit = depCache.get(src);
  if (hit && hit.columnsKey === columnsKey) return hit.deps;
  const deps = astDeps(ast, isColumn);
  depCache.set(src, { columnsKey, deps });
  return deps;
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

export function evaluateAll(
  raw: RawCells,
  rowOrder: string[],
  defs: Record<string, unknown>,
  columnRefs: readonly string[],
): Values {
  const rowIndex = new Map<string, number>();
  rowOrder.forEach((id, i) => rowIndex.set(id, i));
  const columnRefSet = new Set(columnRefs);
  const columnsKey = [...columnRefSet].sort().join("\0");
  const isColumn = (path: string) => columnRefSet.has(path);

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
    rowIndex,
    rowOrder,
    currentRow: "",
    isColumn,
  };

  const visit = (key: string, stack: string[]) => {
    const item = items.get(key);
    if (!item) return;
    color.set(key, "grey");
    stack.push(key);
    if (item.ast) {
      const { row } = splitKey(key);
      const deps = cellDeps(cachedAstDeps(raw.get(key) ?? "", item.ast, isColumn, columnsKey), row, rowOrder, rowIndex);
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
    ctx.currentRow = splitKey(key).row;
    values.set(key, evalNode(item.ast, ctx));
  };

  for (const key of items.keys()) {
    if ((color.get(key) ?? "white") === "white") visit(key, []);
  }
  return values;
}
