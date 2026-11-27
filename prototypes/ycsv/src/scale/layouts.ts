import * as Y from "yjs";
import { fileToDoc } from "../ycsv-model";
import { buildScaleFile, type Notation, type ScaleWidth } from "./generate";

/**
 * Yjs layout comparison for spike 4. Every layout stores the same id-form cell strings
 * (taken from the current `fileToDoc` output), so only the Yjs structure differs.
 */
export type LayoutName = "L1-current" | "L2-flat-row-map" | "L3-one-cell-map" | "L4-flat-row-map-short-ids" | "L5-columnar";

export type LayoutConfig = { rows: number; cols: ScaleWidth; notation?: Notation; edits?: number; layouts?: LayoutName[] };

type Table = { colIds: string[]; rowIds: string[]; cells: string[][] };

type Layout = {
  build: (doc: Y.Doc, table: Table) => void;
  edit: (doc: Y.Doc, table: Table, row: number, col: number, value: string) => void;
};

const short = (i: number) => `c${i.toString(36).padStart(3, "0")}`;

const LAYOUTS: Record<LayoutName, Layout> = {
  // rows: Y.Array<Y.Map{ rowId, cells: Y.Map<colId, string> }>  — what the prototype does today
  "L1-current": {
    build(doc, table) {
      const rows = doc.getArray<Y.Map<unknown>>("rows");
      doc.transact(() => {
        rows.push(
          table.rowIds.map((rowId, r) => {
            const cells = new Y.Map<string>();
            table.colIds.forEach((colId, c) => cells.set(colId, table.cells[r]?.[c] ?? ""));
            const row = new Y.Map<unknown>();
            row.set("rowId", rowId);
            row.set("cells", cells);
            return row;
          }),
        );
      });
    },
    edit(doc, table, row, col, value) {
      const map = doc.getArray<Y.Map<unknown>>("rows").get(row);
      (map.get("cells") as Y.Map<string>).set(table.colIds[col] ?? "", value);
    },
  },
  // rows: Y.Array<Y.Map{ _id, [colId]: string }> — one Y type per row instead of two
  "L2-flat-row-map": {
    build(doc, table) {
      const rows = doc.getArray<Y.Map<string>>("rows");
      doc.transact(() => {
        rows.push(
          table.rowIds.map((rowId, r) => {
            const row = new Y.Map<string>();
            row.set("_id", rowId);
            table.colIds.forEach((colId, c) => row.set(colId, table.cells[r]?.[c] ?? ""));
            return row;
          }),
        );
      });
    },
    edit(doc, table, row, col, value) {
      doc.getArray<Y.Map<string>>("rows").get(row).set(table.colIds[col] ?? "", value);
    },
  },
  // order: Y.Array<rowId>, cells: one Y.Map keyed `${rowId}|${colId}`
  "L3-one-cell-map": {
    build(doc, table) {
      const order = doc.getArray<string>("order");
      const cells = doc.getMap<string>("cells");
      doc.transact(() => {
        order.push(table.rowIds);
        table.rowIds.forEach((rowId, r) =>
          table.colIds.forEach((colId, c) => {
            const value = table.cells[r]?.[c] ?? "";
            if (value !== "") cells.set(`${rowId}|${colId}`, value);
          }),
        );
      });
    },
    edit(doc, table, row, col, value) {
      doc.getMap<string>("cells").set(`${table.rowIds[row]}|${table.colIds[col]}`, value);
    },
  },
  // L2 with 4-char column ids and empty cells left out
  "L4-flat-row-map-short-ids": {
    build(doc, table) {
      const rows = doc.getArray<Y.Map<string>>("rows");
      doc.transact(() => {
        rows.push(
          table.rowIds.map((rowId, r) => {
            const row = new Y.Map<string>();
            row.set("_id", rowId);
            table.colIds.forEach((_, c) => {
              const value = table.cells[r]?.[c] ?? "";
              if (value !== "") row.set(short(c), value);
            });
            return row;
          }),
        );
      });
    },
    edit(doc, _table, row, col, value) {
      doc.getArray<Y.Map<string>>("rows").get(row).set(short(col), value);
    },
  },
  // Y.Array<string> per column + row-id array. Compact floor; NOT safe: concurrent edits of one
  // cell become delete+insert pairs that can duplicate the cell and shift the column.
  "L5-columnar": {
    build(doc, table) {
      doc.transact(() => {
        doc.getArray<string>("order").push(table.rowIds);
        table.colIds.forEach((colId, c) => {
          doc.getArray<string>(`col:${colId}`).push(table.cells.map((row) => row[c] ?? ""));
        });
      });
    },
    edit(doc, table, row, col, value) {
      const column = doc.getArray<string>(`col:${table.colIds[col]}`);
      doc.transact(() => {
        column.delete(row, 1);
        column.insert(row, [value]);
      });
    },
  },
};

function heapMB(): number | null {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  gc?.();
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize / 1048576 : null;
}

function tableFromCurrent(doc: Y.Doc): Table {
  const colIds = doc
    .getArray<Y.Map<unknown>>("columns")
    .toArray()
    .map((column) => String(column.get("colId")));
  const rowIds: string[] = [];
  const cells: string[][] = [];
  for (const row of doc.getArray<Y.Map<unknown>>("rows").toArray()) {
    rowIds.push(String(row.get("rowId")));
    const map = row.get("cells") as Y.Map<string>;
    cells.push(colIds.map((colId) => map.get(colId) ?? ""));
  }
  return { colIds, rowIds, cells };
}

export type LayoutResult = Record<string, number | string | null>;

export async function runLayouts(config: LayoutConfig): Promise<LayoutResult[]> {
  const source = new Y.Doc();
  fileToDoc(buildScaleFile(config.rows, config.cols, config.notation ?? "absolute"), source);
  const table = tableFromCurrent(source);
  source.destroy();
  const out: LayoutResult[] = [];
  const names = config.layouts ?? (Object.keys(LAYOUTS) as LayoutName[]);
  for (const name of names) {
    const layout = LAYOUTS[name];
    const row: LayoutResult = { layout: name, rows: config.rows, cols: config.cols, notation: config.notation ?? "absolute" };
    let builder: Y.Doc | null = new Y.Doc();
    let t = performance.now();
    layout.build(builder, table);
    row.buildMs = performance.now() - t;
    let state: Uint8Array | null = Y.encodeStateAsUpdate(builder);
    row.bytes = state.byteLength;
    row.bytesV2 = Y.encodeStateAsUpdateV2(builder).byteLength;
    builder.destroy();
    builder = null;

    const before = heapMB();
    const doc = new Y.Doc();
    t = performance.now();
    Y.applyUpdate(doc, state);
    row.applyUpdateMs = performance.now() - t;
    state = null;
    const after = heapMB();
    row.heapDocMB = before !== null && after !== null ? after - before : null;

    const sizes: number[] = [];
    doc.on("update", (update: Uint8Array) => sizes.push(update.byteLength));
    const edits = config.edits ?? 1000;
    t = performance.now();
    for (let i = 0; i < edits; i += 1) {
      const r = (i * 7919) % table.rowIds.length;
      layout.edit(doc, table, r, 2, String(i));
    }
    row.editMsAvg = (performance.now() - t) / edits;
    row.editBytesAvg = sizes.reduce((sum, size) => sum + size, 0) / Math.max(1, sizes.length);
    row.bytesAfterEdits = Y.encodeStateAsUpdate(doc).byteLength;
    row.edits = edits;
    doc.destroy();
    out.push(row);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return out;
}
