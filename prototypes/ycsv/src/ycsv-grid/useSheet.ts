import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import type { ColumnType } from "../ycsv-core/types";
import { evaluateAll, type RawCells, type Value } from "../ycsv-formula";

export type SheetColumn = {
  colId: string;
  ref: string;
  name?: string;
  type?: ColumnType;
  currency?: string;
  locale?: string;
};

export type SheetRow = {
  rowId: string;
  cells: Record<string, string>;
};

export function useSheet(doc: Y.Doc): {
  columns: SheetColumn[];
  rows: SheetRow[];
  values: Map<string, Value>;
} {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const columns = doc.getArray("columns");
    const rows = doc.getArray("rows");
    const bump = () => setTick((n) => n + 1);
    columns.observeDeep(bump);
    rows.observeDeep(bump);
    return () => {
      columns.unobserveDeep(bump);
      rows.unobserveDeep(bump);
    };
  }, [doc]);

  return useMemo(() => readSheet(doc), [doc, tick]);
}

function readSheet(doc: Y.Doc): {
  columns: SheetColumn[];
  rows: SheetRow[];
  values: Map<string, Value>;
} {
  const columnMaps = doc.getArray<Y.Map<unknown>>("columns");
  const rowMaps = doc.getArray<Y.Map<unknown>>("rows");
  const columns: SheetColumn[] = [];
  for (let i = 0; i < columnMaps.length; i += 1) {
    const map = columnMaps.get(i);
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

  const rows: SheetRow[] = [];
  for (let i = 0; i < rowMaps.length; i += 1) {
    const map = rowMaps.get(i);
    const cellsMap = map.get("cells") as Y.Map<string>;
    const cells: Record<string, string> = {};
    cellsMap.forEach((value, key) => {
      cells[key] = value;
    });
    rows.push({ rowId: String(map.get("rowId") ?? ""), cells });
  }

  const raw: RawCells = new Map();
  for (const row of rows) {
    for (const column of columns) raw.set(`${column.ref}@${row.rowId}`, row.cells[column.colId] ?? "");
  }
  const defs = doc.getMap("raw").get("defs");
  const values = evaluateAll(
    raw,
    rows.map((row) => row.rowId),
    defs && typeof defs === "object" ? (defs as Record<string, unknown>) : {},
    columns.map((column) => column.ref),
  );
  return { columns, rows, values };
}
