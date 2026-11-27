import * as Y from "yjs";
import type { Node } from "../../ycsv-formula/ast";
import { columnsBetween, evalNode, isCellError, type EvalCtx, type Value } from "../../ycsv-formula/eval";
import { astDeps, astFor, type AstDeps } from "../../ycsv-formula/graph";
import { resolveOrder } from "../model/order";
import { readColumn } from "../model/view";
import { bookOf, partsOf, sheetsOf, type SheetParts } from "../model/workbook";

/**
 * Spike 4's incremental engine, ported to the integration slice's workbook layout
 * (spike 9 order arrays, several sheets, cross-sheet refs). DOM-free: it runs on the main
 * thread or in a worker on a replica (`worker.ts`).
 *
 * - Yjs events (`observeDeep` on the `sheets` root) are applied to an in-memory model.
 * - Dependency graph: point edges (same-row, absolute and cross-sheet refs) both ways, plus
 *   range owners per `sheet!column`; a range is checked by index at change time.
 * - Dirty set = transitive dependents; evaluation = iterative DFS (no recursion limit),
 *   cycles → #CYCLE. Values column-major per sheet; native SUM/COUNT/MIN/MAX/AVERAGE.
 *
 * Cell keys are `sheetId!ref@rowId` (sheet ids never hold `!`, row ids never hold `@`).
 */
export type EngineColumn = { colId: string; ref: string };

type Range = { sheet: string; cols: string[]; from: string; to: string };
type Parsed = { text: string; ast: Node | string; deps: AstDeps | null };

type SheetState = {
  id: string;
  parts: SheetParts;
  columns: EngineColumn[];
  colRefById: Map<string, string>;
  columnRefSet: Set<string>;
  colOrder: string[];
  rowIds: string[];
  rowIndex: Map<string, number>;
  colVals: Map<string, Value[]>;
  defs: Record<string, unknown>;
  ctx: EvalCtx;
};

export type EngineStats = {
  lastChangeMs: number;
  lastEvaluated: number;
  readMs: number;
  graphMs: number;
  evalMs: number;
};

const FAST_AGGREGATES = new Set(["SUM", "COUNT", "MIN", "MAX", "AVERAGE"]);

export function literal(raw: string): Value {
  if (raw === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

export function cellKey(sheet: string, ref: string, rowId: string): string {
  return `${sheet}!${ref}@${rowId}`;
}

export function splitKey(key: string): { sheet: string; col: string; row: string } {
  const bang = key.indexOf("!");
  const at = key.lastIndexOf("@");
  return { sheet: key.slice(0, bang), col: key.slice(bang + 1, at), row: key.slice(at + 1) };
}

function lookup(defs: Record<string, unknown>, path: string): Value | undefined {
  let current: unknown = defs;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === "number" || typeof current === "string" || typeof current === "boolean") return current;
  return undefined;
}

export class WorkbookEngine {
  readonly doc: Y.Doc;
  sheets = new Map<string, SheetState>();
  raw = new Map<string, string>();
  version = 0;
  /** When true, `lastDirtyKeys` holds the keys the last change re-evaluated (worker deltas). */
  trackDirty = false;
  fastAggregates = true;
  lastDirtyKeys: string[] = [];
  stats: EngineStats = { lastChangeMs: 0, lastEvaluated: 0, readMs: 0, graphMs: 0, evalMs: 0 };

  private readonly listeners = new Set<() => void>();
  private readonly sheetsMap: Y.Map<Y.Map<unknown>>;
  private readonly book: Y.Map<unknown>;
  private cellAst = new Map<string, Parsed>();
  private precedents = new Map<string, string[]>();
  private dependents = new Map<string, Set<string>>();
  private ownerRanges = new Map<string, Range[]>();
  /** `sheet!col` → keys of formulas with a range over that column. */
  private rangeOwnersByCol = new Map<string, Set<string>>();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.sheetsMap = sheetsOf(doc);
    this.book = bookOf(doc);
    this.rebuild();
    this.sheetsMap.observeDeep(this.onSheets);
    this.book.observe(this.onBook);
  }

  destroy(): void {
    this.sheetsMap.unobserveDeep(this.onSheets);
    this.book.unobserve(this.onBook);
    this.listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Value of a cell, or undefined when the sheet, row or column is unknown. */
  value(sheetId: string, ref: string, rowId: string): Value | undefined {
    const sheet = this.sheets.get(sheetId);
    const index = sheet?.rowIndex.get(rowId);
    if (!sheet || index === undefined) return undefined;
    return sheet.colVals.get(ref)?.[index];
  }

  getValue(key: string): Value | undefined {
    const { sheet, col, row } = splitKey(key);
    return this.value(sheet, col, row);
  }

  /** All values as a `sheet!ref@row` map (tests compare a fresh build with an edited one). */
  valuesAsMap(): Map<string, Value> {
    const out = new Map<string, Value>();
    for (const key of this.raw.keys()) {
      const value = this.getValue(key);
      if (value !== undefined) out.set(key, value);
    }
    return out;
  }

  private setValue(key: string, value: Value | undefined): void {
    const { sheet, col, row } = splitKey(key);
    const state = this.sheets.get(sheet);
    const index = state?.rowIndex.get(row);
    const column = state?.colVals.get(col);
    if (index === undefined || !column) return;
    column[index] = value === undefined ? "" : value;
  }

  // ---------------------------------------------------------------- full read

  private bookDefs(): Record<string, unknown> {
    const defs = this.book.get("defs");
    return defs && typeof defs === "object" ? (defs as Record<string, unknown>) : {};
  }

  private readSheet(id: string, map: Y.Map<unknown>): SheetState {
    const parts = partsOf(map);
    const colIds = resolveOrder(parts.colOrder.toArray(), parts.colData);
    const columns = colIds.map((colId) => ({ colId, ref: readColumn(colId, parts.colData.get(colId)).ref }));
    const own = parts.meta.get("defs");
    const state: SheetState = {
      id,
      parts,
      columns,
      colRefById: new Map(columns.map((c) => [c.colId, c.ref])),
      columnRefSet: new Set(columns.map((c) => c.ref)),
      colOrder: columns.map((c) => c.ref),
      rowIds: [],
      rowIndex: new Map(),
      colVals: new Map(),
      defs: { ...this.bookDefs(), ...(own && typeof own === "object" ? (own as Record<string, unknown>) : {}) },
      ctx: null as unknown as EvalCtx,
    };
    state.ctx = {
      cell: (col, row) => {
        const index = state.rowIndex.get(row);
        if (index === undefined) return "#REF";
        const value = state.colVals.get(col)?.[index];
        return value === undefined ? "" : value;
      },
      def: (path) => lookup(state.defs, path),
      rowIndex: state.rowIndex,
      rowOrder: state.rowIds,
      currentRow: "",
      isColumn: (path) => state.columnRefSet.has(path),
      colOrder: state.colOrder,
      sheet: (other) => this.sheets.get(other)?.ctx ?? null,
    };
    const rowIds = resolveOrder(parts.rowOrder.toArray(), parts.rowData);
    for (let i = 0; i < rowIds.length; i += 1) {
      const rowId = rowIds[i] as string;
      state.rowIds.push(rowId);
      state.rowIndex.set(rowId, i);
      this.readRowCells(state, rowId);
    }
    for (const column of columns) state.colVals.set(column.ref, new Array(rowIds.length).fill(""));
    return state;
  }

  private readRowCells(state: SheetState, rowId: string): void {
    const cells = state.parts.rowData.get(rowId);
    for (const column of state.columns) this.raw.set(cellKey(state.id, column.ref, rowId), cells?.get(column.colId) ?? "");
  }

  private rebuild(): void {
    let started = performance.now();
    this.sheets.clear();
    this.raw.clear();
    this.cellAst.clear();
    this.sheetsMap.forEach((map, id) => {
      this.sheets.set(id, this.readSheet(id, map));
    });
    this.stats.readMs = performance.now() - started;
    started = performance.now();
    this.buildGraph();
    this.stats.graphMs = performance.now() - started;
    started = performance.now();
    this.stats.lastEvaluated = this.propagate(this.raw.keys(), false);
    this.stats.evalMs = performance.now() - started;
  }

  // ---------------------------------------------------------------- graph

  private buildGraph(): void {
    this.precedents.clear();
    this.dependents.clear();
    this.ownerRanges.clear();
    this.rangeOwnersByCol.clear();
    for (const [key, text] of this.raw) if (text.charCodeAt(0) === 61) this.addEdges(key, text);
  }

  private parsed(key: string, text: string, sheet: SheetState): Parsed {
    const hit = this.cellAst.get(key);
    if (hit && hit.text === text) return hit;
    const ast = astFor(text);
    const entry = { text, ast, deps: typeof ast === "string" ? null : astDeps(ast, (path) => sheet.columnRefSet.has(path)) };
    this.cellAst.set(key, entry);
    return entry;
  }

  private addEdges(key: string, text: string): void {
    const { sheet: own, row } = splitKey(key);
    const sheet = this.sheets.get(own);
    if (!sheet) return;
    const { deps } = this.parsed(key, text, sheet);
    if (!deps) return;
    const points: string[] = [];
    for (const col of deps.sameRowCols) points.push(cellKey(own, col, row));
    for (const ref of deps.absolute) points.push(cellKey(ref.sheet ?? own, ref.col, ref.row));
    if (points.length > 0) {
      this.precedents.set(key, points);
      for (const point of points) {
        let set = this.dependents.get(point);
        if (!set) this.dependents.set(point, (set = new Set()));
        set.add(key);
      }
    }
    if (deps.ranges.length > 0) {
      const ranges: Range[] = [];
      for (const range of deps.ranges) {
        const target = this.sheets.get(range.sheet ?? own);
        const cols = target ? (columnsBetween(target.colOrder, range.col, range.col2) ?? [range.col]) : [range.col];
        ranges.push({ sheet: range.sheet ?? own, cols, from: range.from, to: range.to });
      }
      this.ownerRanges.set(key, ranges);
      for (const range of ranges) {
        for (const col of range.cols) {
          const at = `${range.sheet}!${col}`;
          let owners = this.rangeOwnersByCol.get(at);
          if (!owners) this.rangeOwnersByCol.set(at, (owners = new Set()));
          owners.add(key);
        }
      }
    }
  }

  private removeEdges(key: string): void {
    const points = this.precedents.get(key);
    if (points) {
      for (const point of points) this.dependents.get(point)?.delete(key);
      this.precedents.delete(key);
    }
    const ranges = this.ownerRanges.get(key);
    if (ranges) {
      for (const range of ranges) for (const col of range.cols) this.rangeOwnersByCol.get(`${range.sheet}!${col}`)?.delete(key);
      this.ownerRanges.delete(key);
    }
  }

  private rangeBounds(range: Range): [number, number] | null {
    const sheet = this.sheets.get(range.sheet);
    const a = sheet?.rowIndex.get(range.from);
    const b = sheet?.rowIndex.get(range.to);
    if (a === undefined || b === undefined) return null;
    return a <= b ? [a, b] : [b, a];
  }

  private forEachDependent(key: string, visit: (dependent: string) => void): void {
    const direct = this.dependents.get(key);
    if (direct) for (const dependent of direct) visit(dependent);
    const { sheet, col, row } = splitKey(key);
    const owners = this.rangeOwnersByCol.get(`${sheet}!${col}`);
    if (!owners || owners.size === 0) return;
    const index = this.sheets.get(sheet)?.rowIndex.get(row);
    for (const owner of owners) {
      for (const range of this.ownerRanges.get(owner) ?? []) {
        if (range.sheet !== sheet || !range.cols.includes(col)) continue;
        const bounds = this.rangeBounds(range);
        if (index === undefined || bounds === null || (index >= bounds[0] && index <= bounds[1])) {
          visit(owner);
          break;
        }
      }
    }
  }

  private dirtyPrecedents(key: string, dirty: Set<string>): string[] {
    const out: string[] = [];
    for (const point of this.precedents.get(key) ?? []) if (dirty.has(point)) out.push(point);
    const ranges = this.ownerRanges.get(key);
    if (!ranges) return out;
    for (const range of ranges) {
      const bounds = this.rangeBounds(range);
      if (!bounds) continue;
      const span = (bounds[1] - bounds[0] + 1) * range.cols.length;
      if (dirty.size < span) {
        for (const candidate of dirty) {
          const { sheet, col, row } = splitKey(candidate);
          if (sheet !== range.sheet || !range.cols.includes(col)) continue;
          const index = this.sheets.get(sheet)?.rowIndex.get(row);
          if (index !== undefined && index >= bounds[0] && index <= bounds[1]) out.push(candidate);
        }
      } else {
        const rowIds = this.sheets.get(range.sheet)?.rowIds ?? [];
        for (let i = bounds[0]; i <= bounds[1]; i += 1) {
          for (const col of range.cols) {
            const candidate = cellKey(range.sheet, col, rowIds[i] as string);
            if (dirty.has(candidate)) out.push(candidate);
          }
        }
      }
    }
    return out;
  }

  /** Spike 4 §4: `SUM(col@a:col@b)` etc. as a plain loop over the column array. */
  private fastAggregate(ast: Node, own: string): Value | null {
    if (ast.k !== "call" || ast.args.length !== 1 || !FAST_AGGREGATES.has(ast.fn)) return null;
    const arg = ast.args[0];
    if (!arg || arg.k !== "range" || (arg.col2 !== undefined && arg.col2 !== arg.col)) return null;
    const sheetId = arg.sheet ?? own;
    const sheet = this.sheets.get(sheetId);
    if (!sheet) return "#REF";
    const bounds = this.rangeBounds({ sheet: sheetId, cols: [arg.col], from: arg.from, to: arg.to });
    if (!bounds) return "#REF";
    const column = sheet.colVals.get(arg.col);
    if (!column) return null;
    let sum = 0;
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = bounds[0]; i <= bounds[1]; i += 1) {
      const value = column[i];
      if (typeof value === "number") {
        sum += value;
        count += 1;
        if (value < min) min = value;
        if (value > max) max = value;
      } else if (value === "" || value === undefined) {
        continue;
      } else if (isCellError(value)) {
        return value;
      } else {
        return null;
      }
    }
    if (ast.fn === "SUM") return sum;
    if (ast.fn === "COUNT") return count;
    if (count === 0) return ast.fn === "AVERAGE" ? null : 0;
    if (ast.fn === "MIN") return min;
    if (ast.fn === "MAX") return max;
    return sum / count;
  }

  private evalKey(key: string): Value | undefined {
    const text = this.raw.get(key);
    if (text === undefined) return undefined;
    if (text.charCodeAt(0) !== 61) return literal(text);
    const { sheet: own, row } = splitKey(key);
    const sheet = this.sheets.get(own);
    if (!sheet) return undefined;
    const { ast } = this.parsed(key, text, sheet);
    if (typeof ast === "string") return ast;
    if (this.fastAggregates) {
      const fast = this.fastAggregate(ast, own);
      if (fast !== null) return fast;
    }
    sheet.ctx.currentRow = row;
    return evalNode(ast, sheet.ctx);
  }

  private propagate(seeds: Iterable<string>, expand = true): number {
    const dirty = new Set<string>(expand ? [] : seeds);
    const pending = expand ? [...seeds] : [];
    while (pending.length > 0) {
      const key = pending.pop() as string;
      if (dirty.has(key)) continue;
      dirty.add(key);
      this.forEachDependent(key, (dependent) => {
        if (!dirty.has(dependent)) pending.push(dependent);
      });
    }
    const state = new Map<string, 1 | 2>();
    const cycle = new Set<string>();
    for (const root of dirty) {
      if (state.has(root)) continue;
      const stack: { key: string; precs: string[]; i: number }[] = [{ key: root, precs: this.dirtyPrecedents(root, dirty), i: 0 }];
      state.set(root, 1);
      while (stack.length > 0) {
        const top = stack[stack.length - 1] as { key: string; precs: string[]; i: number };
        if (top.i < top.precs.length) {
          const next = top.precs[top.i] as string;
          top.i += 1;
          const seen = state.get(next);
          if (seen === 1) {
            // Only the frames on the cycle itself (from `next` up). Spike 4 marked the whole
            // stack, so a cell that merely depends on a cycle got #CYCLE or another error
            // depending on evaluation order (found by the integration fuzz). Dependents now
            // get the error through normal evaluation.
            let k = stack.length - 1;
            while (k > 0 && (stack[k] as { key: string }).key !== next) k -= 1;
            for (let f = k; f < stack.length; f += 1) cycle.add((stack[f] as { key: string }).key);
            cycle.add(next);
          } else if (seen === undefined) {
            state.set(next, 1);
            stack.push({ key: next, precs: this.dirtyPrecedents(next, dirty), i: 0 });
          }
          continue;
        }
        stack.pop();
        state.set(top.key, 2);
        this.setValue(top.key, cycle.has(top.key) ? "#CYCLE" : this.evalKey(top.key));
      }
    }
    if (this.trackDirty) this.lastDirtyKeys = [...dirty];
    return dirty.size;
  }

  // ---------------------------------------------------------------- Yjs sync

  private onBook = (event: Y.YMapEvent<unknown>): void => {
    if (!event.keysChanged.has("defs")) return;
    const started = performance.now();
    for (const sheet of this.sheets.values()) {
      const own = sheet.parts.meta.get("defs");
      sheet.defs = { ...this.bookDefs(), ...(own && typeof own === "object" ? (own as Record<string, unknown>) : {}) };
    }
    this.stats.lastEvaluated = this.propagate(this.raw.keys(), false);
    this.stats.lastChangeMs = performance.now() - started;
    this.emit();
  };

  private onSheets = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    const started = performance.now();
    const changed = new Set<string>();
    const structural = new Set<string>();
    const defsChanged = new Set<string>();
    let full = false;
    for (const event of events) {
      const path = event.path as string[];
      if (path.length === 0) {
        full = true; // a sheet added or removed
        continue;
      }
      const sheetId = path[0] as string;
      const part = path[1];
      if (part === undefined) continue; // ref / name of a sheet: no value changes
      if (part === "rowOrder") structural.add(sheetId);
      else if (part === "rowData") {
        if (path.length === 2) {
          structural.add(sheetId);
          continue;
        }
        const sheet = this.sheets.get(sheetId);
        const rowId = path[2] as string;
        if (!sheet || !sheet.rowIndex.has(rowId)) continue;
        for (const colId of (event as Y.YMapEvent<string>).keysChanged) {
          const ref = sheet.colRefById.get(colId);
          if (ref === undefined) continue;
          const key = cellKey(sheetId, ref, rowId);
          this.raw.set(key, (event.target as Y.Map<string>).get(colId) ?? "");
          changed.add(key);
        }
      } else if (part === "colOrder") full = true;
      else if (part === "colData") {
        // Width, name and type are display only; a new, removed or renamed column changes refs.
        if (path.length === 2 || (event as Y.YMapEvent<unknown>).keysChanged.has("ref")) full = true;
      } else if (part === "meta" && (event as Y.YMapEvent<unknown>).keysChanged.has("defs")) defsChanged.add(sheetId);
    }

    if (full) {
      this.rebuild();
      this.stats.lastChangeMs = performance.now() - started;
      this.emit();
      return;
    }
    const seeds = new Set<string>(changed);
    for (const sheetId of structural) this.syncStructure(sheetId, seeds);
    for (const key of changed) {
      this.removeEdges(key);
      const text = this.raw.get(key);
      if (text !== undefined && text.charCodeAt(0) === 61) this.addEdges(key, text);
    }
    for (const sheetId of defsChanged) {
      const sheet = this.sheets.get(sheetId);
      if (!sheet) continue;
      const own = sheet.parts.meta.get("defs");
      sheet.defs = { ...this.bookDefs(), ...(own && typeof own === "object" ? (own as Record<string, unknown>) : {}) };
      for (const key of this.raw.keys()) if (key.startsWith(`${sheetId}!`)) seeds.add(key);
    }
    if (seeds.size === 0 && structural.size === 0) {
      this.stats.lastEvaluated = 0;
      if (this.trackDirty) this.lastDirtyKeys = [];
      return;
    }
    this.stats.lastEvaluated = this.propagate(seeds);
    this.stats.lastChangeMs = performance.now() - started;
    this.emit();
  };

  /** Row inserts, deletes and moves on one sheet: diff row ids, update raw + graph, seed range owners. */
  private syncStructure(sheetId: string, seeds: Set<string>): void {
    const sheet = this.sheets.get(sheetId);
    if (!sheet) return;
    const nextIds = resolveOrder(sheet.parts.rowOrder.toArray(), sheet.parts.rowData);
    const before = new Set(sheet.rowIds);
    const after = new Set(nextIds);
    for (const rowId of before) {
      if (after.has(rowId)) continue;
      for (const column of sheet.columns) {
        const key = cellKey(sheetId, column.ref, rowId);
        this.removeEdges(key);
        this.raw.delete(key);
        this.cellAst.delete(key);
        seeds.add(key);
      }
    }
    const oldIndex = new Map(sheet.rowIndex);
    for (const column of sheet.columns) {
      const old = sheet.colVals.get(column.ref) ?? [];
      const next: Value[] = new Array(nextIds.length);
      for (let i = 0; i < nextIds.length; i += 1) {
        const was = oldIndex.get(nextIds[i] as string);
        next[i] = was === undefined ? "" : (old[was] as Value);
      }
      sheet.colVals.set(column.ref, next);
    }
    // Same array objects: the eval context holds them.
    sheet.rowIds.length = 0;
    sheet.rowIndex.clear();
    for (let i = 0; i < nextIds.length; i += 1) {
      const rowId = nextIds[i] as string;
      sheet.rowIds.push(rowId);
      sheet.rowIndex.set(rowId, i);
      if (!before.has(rowId)) {
        this.readRowCells(sheet, rowId);
        for (const column of sheet.columns) {
          const key = cellKey(sheetId, column.ref, rowId);
          const text = this.raw.get(key) ?? "";
          if (text.charCodeAt(0) === 61) this.addEdges(key, text);
          seeds.add(key);
        }
      }
    }
    // Range membership on this sheet may have changed: re-evaluate the owners of ranges into it.
    for (const [at, owners] of this.rangeOwnersByCol) if (at.startsWith(`${sheetId}!`)) for (const owner of owners) seeds.add(owner);
  }
}
