import * as Y from "yjs";
import type { ColumnType } from "../ycsv-core/types";
import type { Node } from "../ycsv-formula/ast";
import { evalNode, isCellError, type EvalCtx, type Value } from "../ycsv-formula/eval";
import { astDeps, astFor, evaluateAll, type AstDeps } from "../ycsv-formula/graph";

/**
 * In-memory sheet model kept in sync with the Y.Doc, for spike 4.
 *
 * - `full`: every Yjs change re-reads the whole doc and runs `evaluateAll` (what `useSheet` does today).
 * - `incremental`: Yjs events are applied to the in-memory model; a dependency graph
 *   (point edges + per-column range owners) finds the dirty cells, and only those are
 *   re-evaluated, in topological order, with an iterative DFS (no recursion depth limit).
 */
export type EngineMode = "full" | "incremental";

export type EngineColumn = {
  colId: string;
  ref: string;
  name?: string;
  type?: ColumnType;
  currency?: string;
  locale?: string;
};

type Range = { col: string; from: string; to: string };

export type EngineStats = {
  /** Time spent in the last change handler (sync from Yjs + recompute). */
  lastChangeMs: number;
  /** Cells re-evaluated by the last change (full mode: all cells). */
  lastEvaluated: number;
  /** Initial read + graph + evaluation, split. */
  readMs: number;
  graphMs: number;
  evalMs: number;
};

const FAST_AGGREGATES = new Set(["SUM", "COUNT", "MIN", "MAX", "AVERAGE"]);

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

export class SheetEngine {
  readonly doc: Y.Doc;
  readonly mode: EngineMode;
  columns: EngineColumn[] = [];
  rowIds: string[] = [];
  rowIndex = new Map<string, number>();
  raw = new Map<string, string>();
  /** Full mode: values keyed `ref@rowId` (as `evaluateAll` returns them). */
  values = new Map<string, Value>();
  /** Incremental mode: column-major values, `colVals.get(ref)[rowIndex]`. No key strings on reads. */
  colVals = new Map<string, Value[]>();
  version = 0;
  /** When true, `lastDirtyKeys` holds the keys the last change re-evaluated (worker deltas). */
  trackDirty = false;
  /** Native loop for whole-range SUM/COUNT/MIN/MAX/AVERAGE (spike 4 §4). */
  fastAggregates = true;
  /** Incremental mode: first evaluation via `evaluateAll` (recursive) or the engine's own iterative pass. */
  initialEval: "evaluateAll" | "propagate" = "propagate";
  lastDirtyKeys: string[] = [];
  stats: EngineStats = { lastChangeMs: 0, lastEvaluated: 0, readMs: 0, graphMs: 0, evalMs: 0 };

  private readonly listeners = new Set<() => void>();
  private readonly rowsArr: Y.Array<Y.Map<unknown>>;
  private readonly colsArr: Y.Array<Y.Map<unknown>>;
  private defs: Record<string, unknown> = {};
  private colRefById = new Map<string, string>();
  private columnRefSet = new Set<string>();
  private depCache = new Map<string, AstDeps>();
  // Dependency graph (incremental mode only).
  private precedents = new Map<string, string[]>();
  private dependents = new Map<string, Set<string>>();
  private ownerRanges = new Map<string, Range[]>();
  private rangeOwnersByCol = new Map<string, Set<string>>();
  private readonly ctx: EvalCtx;

  constructor(doc: Y.Doc, mode: EngineMode, options: { initialEval?: "evaluateAll" | "propagate" } = {}) {
    this.doc = doc;
    this.mode = mode;
    if (options.initialEval) this.initialEval = options.initialEval;
    this.rowsArr = doc.getArray<Y.Map<unknown>>("rows");
    this.colsArr = doc.getArray<Y.Map<unknown>>("columns");
    this.ctx = {
      cell: (col, row) => {
        const index = this.rowIndex.get(row);
        if (index === undefined) return "#REF";
        const value = this.mode === "incremental" ? this.colVals.get(col)?.[index] : this.values.get(`${col}@${row}`);
        return value === undefined ? "" : value;
      },
      def: (path) => this.lookupDef(path),
      rowIndex: this.rowIndex,
      rowOrder: this.rowIds,
      currentRow: "",
      isColumn: (path) => this.columnRefSet.has(path),
    };
    this.rebuild();
    this.rowsArr.observeDeep(this.onRows);
    this.colsArr.observeDeep(this.onCols);
  }

  destroy(): void {
    this.rowsArr.unobserveDeep(this.onRows);
    this.colsArr.unobserveDeep(this.onCols);
    this.listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  valueAt(rowIndex: number, colIndex: number): Value {
    const col = this.columns[colIndex];
    const row = this.rowIds[rowIndex];
    if (!col || !row) return "";
    const value =
      this.mode === "incremental" ? this.colVals.get(col.ref)?.[rowIndex] : this.values.get(`${col.ref}@${row}`);
    return value === undefined ? "" : value;
  }

  getValue(key: string): Value | undefined {
    if (this.mode !== "incremental") return this.values.get(key);
    const { col, row } = splitKey(key);
    const index = this.rowIndex.get(row);
    return index === undefined ? undefined : this.colVals.get(col)?.[index];
  }

  private setValue(key: string, value: Value | undefined): void {
    const { col, row } = splitKey(key);
    const index = this.rowIndex.get(row);
    const column = this.colVals.get(col);
    if (index === undefined || !column) return;
    column[index] = value === undefined ? "" : value;
  }

  /** Values as a `ref@rowId` map (tests compare it with `evaluateAll`). */
  valuesAsMap(): Map<string, Value> {
    if (this.mode !== "incremental") return this.values;
    const out = new Map<string, Value>();
    for (const [key] of this.raw) {
      const value = this.getValue(key);
      if (value !== undefined) out.set(key, value);
    }
    return out;
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private lookupDef(path: string): Value | undefined {
    let current: unknown = this.defs;
    for (const part of path.split(".")) {
      if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    if (typeof current === "number" || typeof current === "string" || typeof current === "boolean") return current;
    return undefined;
  }

  // ---------------------------------------------------------------- full read

  private readColumns(): void {
    const columns: EngineColumn[] = [];
    for (const map of this.colsArr.toArray()) {
      const rest = map.get("rest");
      const record = rest && typeof rest === "object" ? (rest as Record<string, unknown>) : {};
      const name = map.get("name");
      const type = map.get("type");
      columns.push({
        colId: String(map.get("colId") ?? ""),
        ref: String(map.get("ref") ?? ""),
        name: typeof name === "string" ? name : undefined,
        type: typeof type === "string" ? (type as ColumnType) : undefined,
        currency: typeof record.currency === "string" ? record.currency : undefined,
        locale: typeof record.locale === "string" ? record.locale : undefined,
      });
    }
    this.columns = columns;
    this.colRefById = new Map(columns.map((column) => [column.colId, column.ref]));
    this.columnRefSet = new Set(columns.map((column) => column.ref));
    this.depCache.clear();
    const defs = this.doc.getMap("raw").get("defs");
    this.defs = defs && typeof defs === "object" ? (defs as Record<string, unknown>) : {};
  }

  private readRows(): void {
    this.rowIds.length = 0;
    this.rowIndex.clear();
    this.raw.clear();
    const maps = this.rowsArr.toArray();
    for (let i = 0; i < maps.length; i += 1) {
      const map = maps[i] as Y.Map<unknown>;
      const rowId = String(map.get("rowId") ?? "");
      this.rowIds.push(rowId);
      this.rowIndex.set(rowId, i);
      this.readRowCells(map, rowId);
    }
  }

  private readRowCells(map: Y.Map<unknown>, rowId: string): void {
    const cells = map.get("cells") as Y.Map<string> | undefined;
    for (const column of this.columns) {
      this.raw.set(`${column.ref}@${rowId}`, cells?.get(column.colId) ?? "");
    }
  }

  private evaluateEverything(): void {
    const started = performance.now();
    if (this.mode === "incremental" && this.initialEval === "propagate") {
      // Own iterative evaluation of every cell: no recursion depth limit, no key-string value map.
      this.values = new Map();
      this.colVals.clear();
      for (const column of this.columns) this.colVals.set(column.ref, new Array(this.rowIds.length).fill(""));
      this.stats.lastEvaluated = this.propagate(this.raw.keys(), false);
      this.stats.evalMs = performance.now() - started;
      return;
    }
    this.values = evaluateAll(this.raw, this.rowIds, this.defs, [...this.columnRefSet]);
    if (this.mode === "incremental") {
      this.colVals.clear();
      for (const column of this.columns) {
        const out: Value[] = new Array(this.rowIds.length);
        for (let i = 0; i < this.rowIds.length; i += 1) {
          const value = this.values.get(`${column.ref}@${this.rowIds[i]}`);
          out[i] = value === undefined ? "" : value;
        }
        this.colVals.set(column.ref, out);
      }
      this.values = new Map();
    }
    this.stats.evalMs = performance.now() - started;
    this.stats.lastEvaluated = this.raw.size;
  }

  private rebuild(): void {
    let started = performance.now();
    this.readColumns();
    this.readRows();
    this.stats.readMs = performance.now() - started;
    started = performance.now();
    if (this.mode === "incremental") this.buildGraph();
    this.stats.graphMs = performance.now() - started;
    this.evaluateEverything();
  }

  private onCols = (): void => {
    const started = performance.now();
    this.rebuild();
    this.stats.lastChangeMs = performance.now() - started;
    this.emit();
  };

  // ---------------------------------------------------------------- graph

  private buildGraph(): void {
    this.precedents.clear();
    this.dependents.clear();
    this.ownerRanges.clear();
    this.rangeOwnersByCol.clear();
    for (const [key, text] of this.raw) {
      if (text.startsWith("=")) this.addEdges(key, text);
    }
  }

  private depsFor(text: string, ast: Node): AstDeps {
    let deps = this.depCache.get(text);
    if (!deps) {
      deps = astDeps(ast, (path) => this.columnRefSet.has(path));
      this.depCache.set(text, deps);
    }
    return deps;
  }

  private addEdges(key: string, text: string): void {
    const ast = astFor(text);
    if (typeof ast === "string") return;
    const deps = this.depsFor(text, ast);
    const row = key.slice(key.indexOf("@") + 1);
    const points: string[] = [];
    for (const col of deps.sameRowCols) points.push(`${col}@${row}`);
    for (const ref of deps.absolute) points.push(`${ref.col}@${ref.row}`);
    if (points.length > 0) {
      this.precedents.set(key, points);
      for (const point of points) {
        let set = this.dependents.get(point);
        if (!set) this.dependents.set(point, (set = new Set()));
        set.add(key);
      }
    }
    if (deps.ranges.length > 0) {
      this.ownerRanges.set(key, deps.ranges);
      for (const range of deps.ranges) {
        let owners = this.rangeOwnersByCol.get(range.col);
        if (!owners) this.rangeOwnersByCol.set(range.col, (owners = new Set()));
        owners.add(key);
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
      for (const range of ranges) this.rangeOwnersByCol.get(range.col)?.delete(key);
      this.ownerRanges.delete(key);
    }
  }

  private rangeBounds(range: Range): [number, number] | null {
    const a = this.rowIndex.get(range.from);
    const b = this.rowIndex.get(range.to);
    if (a === undefined || b === undefined) return null;
    return a <= b ? [a, b] : [b, a];
  }

  /** Every cell whose value may change when `key` changes. */
  private forEachDependent(key: string, visit: (dependent: string) => void): void {
    const direct = this.dependents.get(key);
    if (direct) for (const dependent of direct) visit(dependent);
    const { col, row } = splitKey(key);
    const owners = this.rangeOwnersByCol.get(col);
    if (!owners || owners.size === 0) return;
    const index = this.rowIndex.get(row);
    for (const owner of owners) {
      for (const range of this.ownerRanges.get(owner) ?? []) {
        if (range.col !== col) continue;
        const bounds = this.rangeBounds(range);
        // A row that is gone (index undefined) may have been inside: dirty the owner.
        if (index === undefined || bounds === null || (index >= bounds[0] && index <= bounds[1])) {
          visit(owner);
          break;
        }
      }
    }
  }

  /** Dirty cells this formula reads, so they are evaluated first. */
  private dirtyPrecedents(key: string, dirty: Set<string>): string[] {
    const out: string[] = [];
    for (const point of this.precedents.get(key) ?? []) if (dirty.has(point)) out.push(point);
    const ranges = this.ownerRanges.get(key);
    if (ranges) {
      for (const range of ranges) {
        const bounds = this.rangeBounds(range);
        if (!bounds) continue;
        const span = bounds[1] - bounds[0] + 1;
        if (dirty.size < span) {
          for (const candidate of dirty) {
            const { col, row } = splitKey(candidate);
            if (col !== range.col) continue;
            const index = this.rowIndex.get(row);
            if (index !== undefined && index >= bounds[0] && index <= bounds[1]) out.push(candidate);
          }
        } else {
          for (let i = bounds[0]; i <= bounds[1]; i += 1) {
            const candidate = `${range.col}@${this.rowIds[i]}`;
            if (dirty.has(candidate)) out.push(candidate);
          }
        }
      }
    }
    return out;
  }

  /**
   * `SUM|COUNT|MIN|MAX|AVERAGE(col@a:col@b)` as a plain loop instead of building a 50k
   * array for formulajs. Only numbers and "" take this path (same result as formulajs);
   * anything else returns null and falls back to the generic evaluator.
   */
  private fastAggregate(ast: Node): Value | null {
    if (ast.k !== "call" || ast.args.length !== 1 || !FAST_AGGREGATES.has(ast.fn)) return null;
    const arg = ast.args[0];
    if (!arg || arg.k !== "range") return null;
    const bounds = this.rangeBounds(arg);
    if (!bounds) return "#REF";
    let sum = 0;
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    const column = this.colVals.get(arg.col);
    if (!column) return null;
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
    if (!text.startsWith("=")) return literal(text);
    const ast = astFor(text);
    if (typeof ast === "string") return ast;
    if (this.fastAggregates) {
      const fast = this.fastAggregate(ast);
      if (fast !== null) return fast;
    }
    this.ctx.currentRow = key.slice(key.indexOf("@") + 1);
    return evalNode(ast, this.ctx);
  }

  /** Re-evaluate `seeds` and everything downstream of them. Returns the number of cells evaluated. */
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

    // Iterative DFS over dirty precedents: post-order is a valid evaluation order.
    const state = new Map<string, 1 | 2>();
    const cycle = new Set<string>();
    for (const root of dirty) {
      if (state.has(root)) continue;
      const stack: { key: string; precs: string[]; i: number }[] = [
        { key: root, precs: this.dirtyPrecedents(root, dirty), i: 0 },
      ];
      state.set(root, 1);
      while (stack.length > 0) {
        const top = stack[stack.length - 1] as { key: string; precs: string[]; i: number };
        if (top.i < top.precs.length) {
          const next = top.precs[top.i] as string;
          top.i += 1;
          const seen = state.get(next);
          if (seen === 1) {
            for (const frame of stack) cycle.add(frame.key);
            cycle.add(next);
          } else if (seen === undefined) {
            state.set(next, 1);
            stack.push({ key: next, precs: this.dirtyPrecedents(next, dirty), i: 0 });
          }
          continue;
        }
        stack.pop();
        state.set(top.key, 2);
        if (cycle.has(top.key)) {
          this.setValue(top.key, "#CYCLE");
          continue;
        }
        this.setValue(top.key, this.evalKey(top.key));
      }
    }
    if (this.trackDirty) this.lastDirtyKeys = [...dirty];
    return dirty.size;
  }

  // ---------------------------------------------------------------- Yjs sync

  private onRows = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    const started = performance.now();
    if (this.mode === "full") {
      this.readRows();
      this.evaluateEverything();
      this.stats.lastChangeMs = performance.now() - started;
      this.emit();
      return;
    }

    const changed = new Set<string>();
    let structural = false;
    for (const event of events) {
      const target = event.target;
      if (target === this.rowsArr) {
        structural = true;
        continue;
      }
      // A cells map: target.parent is the row map, whose parent is the rows array.
      const rowMap = target.parent as Y.Map<unknown> | null;
      if (!(target instanceof Y.Map) || !rowMap || rowMap.parent !== this.rowsArr) continue;
      if (target._item?.parentSub !== "cells") continue;
      const rowId = String(rowMap.get("rowId") ?? "");
      if (!this.rowIndex.has(rowId)) continue;
      for (const colId of (event as Y.YMapEvent<string>).keysChanged) {
        const ref = this.colRefById.get(colId);
        if (ref === undefined) continue;
        const key = `${ref}@${rowId}`;
        this.raw.set(key, (target as Y.Map<string>).get(colId) ?? "");
        changed.add(key);
      }
    }

    const seeds = new Set<string>(changed);
    if (structural) this.syncStructure(seeds);
    for (const key of changed) {
      this.removeEdges(key);
      const text = this.raw.get(key);
      if (text !== undefined && text.startsWith("=")) this.addEdges(key, text);
    }
    this.stats.lastEvaluated = this.propagate(seeds);
    this.stats.lastChangeMs = performance.now() - started;
    this.emit();
  };

  /** Row inserts/deletes: diff row ids, update raw + graph, seed range owners. */
  private syncStructure(seeds: Set<string>): void {
    const maps = this.rowsArr.toArray();
    const before = new Set(this.rowIds);
    const nextIds: string[] = new Array(maps.length);
    for (let i = 0; i < maps.length; i += 1) nextIds[i] = String((maps[i] as Y.Map<unknown>).get("rowId") ?? "");
    const after = new Set(nextIds);

    for (const rowId of before) {
      if (after.has(rowId)) continue;
      for (const column of this.columns) {
        const key = `${column.ref}@${rowId}`;
        this.removeEdges(key);
        this.raw.delete(key);
        // Dependents of the removed cell must re-evaluate (they become #REF or shrink).
        seeds.add(key);
      }
    }

    // Re-index the column arrays to the new row order (kept rows keep their values).
    const oldIndex = new Map(this.rowIndex);
    for (const column of this.columns) {
      const old = this.colVals.get(column.ref) ?? [];
      const next: Value[] = new Array(nextIds.length);
      for (let i = 0; i < nextIds.length; i += 1) {
        const was = oldIndex.get(nextIds[i] as string);
        next[i] = was === undefined ? "" : (old[was] as Value);
      }
      this.colVals.set(column.ref, next);
    }

    this.rowIds.length = 0;
    this.rowIndex.clear();
    for (let i = 0; i < nextIds.length; i += 1) {
      const rowId = nextIds[i] as string;
      this.rowIds.push(rowId);
      this.rowIndex.set(rowId, i);
      if (!before.has(rowId)) {
        this.readRowCells(maps[i] as Y.Map<unknown>, rowId);
        for (const column of this.columns) {
          const key = `${column.ref}@${rowId}`;
          const text = this.raw.get(key) ?? "";
          if (text.startsWith("=")) this.addEdges(key, text);
          seeds.add(key);
        }
      }
    }
    // Range membership may have changed for every range: re-evaluate all range owners.
    for (const owners of this.rangeOwnersByCol.values()) for (const owner of owners) seeds.add(owner);
  }
}

// ------------------------------------------------------------------ index-based mutations

/** `setCell` without the full-doc snapshot and row scan of `mutate.setCell`: the grid knows the index. */
export function setCellAt(doc: Y.Doc, rowIndex: number, colId: string, idFormValue: string): void {
  doc.transact(() => {
    const row = doc.getArray<Y.Map<unknown>>("rows").get(rowIndex);
    (row.get("cells") as Y.Map<string>).set(colId, idFormValue);
  }, "local");
}

export function deleteRowAt(doc: Y.Doc, rowIndex: number): void {
  doc.transact(() => {
    doc.getArray<Y.Map<unknown>>("rows").delete(rowIndex, 1);
  }, "local");
}

/** One transaction writing a block of literal values (a paste). */
export function pasteBlock(doc: Y.Doc, startRow: number, colIds: string[], values: string[][]): void {
  doc.transact(() => {
    const rows = doc.getArray<Y.Map<unknown>>("rows").slice(startRow, startRow + values.length);
    rows.forEach((row, r) => {
      const cells = row.get("cells") as Y.Map<string>;
      colIds.forEach((colId, c) => cells.set(colId, values[r]?.[c] ?? ""));
    });
  }, "local");
}
