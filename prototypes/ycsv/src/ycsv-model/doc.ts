import * as Y from "yjs";
import type { ColumnDef, YcsvFile } from "../ycsv-core/types";
import { newColId, newRowId } from "./ids";
import { refsThatMustBeQuoted, toFileForm, toIdForm, type ColInfo } from "./refs";

const PREFERRED_KEYS = [
  "ycsv_version",
  "name",
  "description",
  "created",
  "author",
  "columns",
  "defs",
  "cells",
  "charts",
];

function columnsOf(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>("columns");
}

function rowsOf(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>("rows");
}

export function fileToDoc(file: YcsvFile, doc: Y.Doc): void {
  const meta = doc.getMap("meta");
  const raw = doc.getMap("raw");
  const columns = columnsOf(doc);
  const rows = rowsOf(doc);

  doc.transact(() => {
    meta.clear();
    raw.clear();
    if (columns.length > 0) columns.delete(0, columns.length);
    if (rows.length > 0) rows.delete(0, rows.length);

    for (const key of Object.keys(file.frontmatter)) {
      if (key === "columns") continue;
      const value = file.frontmatter[key];
      if (key === "defs" || key === "cells" || key === "charts") raw.set(key, value);
      else meta.set(key, value);
    }

    const colIds = file.columns.map(() => newColId());
    const rowIds = file.rows.map(() => newRowId());
    const colInfos: ColInfo[] = file.columns.map((column, index) => ({
      colId: colIds[index] ?? "",
      ref: column.ref ?? "",
      header: file.header[index] ?? "",
    }));

    file.columns.forEach((column, index) => {
      const { ref, name, type, ...rest } = column;
      const map = new Y.Map<unknown>();
      map.set("colId", colIds[index]);
      map.set("ref", ref ?? "");
      if (name !== undefined) map.set("name", name);
      if (type !== undefined) map.set("type", type);
      map.set("rest", rest);
      columns.push([map]);
    });

    file.rows.forEach((data, index) => {
      const cells = new Y.Map<string>();
      for (let colIndex = 0; colIndex < colInfos.length; colIndex += 1) {
        const col = colInfos[colIndex];
        if (!col) continue;
        cells.set(col.colId, toIdForm(data[colIndex] ?? "", colInfos, rowIds));
      }
      const map = new Y.Map<unknown>();
      map.set("rowId", rowIds[index]);
      map.set("cells", cells);
      rows.push([map]);
    });
  }, "local");
}

function columnDef(map: Y.Map<unknown>): ColumnDef {
  const ref = String(map.get("ref") ?? "");
  const name = map.get("name");
  const type = map.get("type");
  const rest = map.get("rest");
  const def: ColumnDef = { ref };
  if (typeof name === "string") def.name = name;
  if (typeof type === "string") def.type = type as ColumnDef["type"];
  if (rest && typeof rest === "object") {
    for (const [key, value] of Object.entries(rest as Record<string, unknown>)) def[key] = value;
  }
  return def;
}

export function docToFile(doc: Y.Doc): YcsvFile {
  const columns = columnsOf(doc);
  const rows = rowsOf(doc);
  const colDefs: ColumnDef[] = [];
  const colInfos: ColInfo[] = [];
  for (let i = 0; i < columns.length; i += 1) {
    const map = columns.get(i);
    const def = columnDef(map);
    colDefs.push(def);
    colInfos.push({ colId: String(map.get("colId") ?? ""), ref: def.ref ?? "" });
  }

  const rowIds: string[] = [];
  const rowMaps: Y.Map<unknown>[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const map = rows.get(i);
    rowMaps.push(map);
    rowIds.push(String(map.get("rowId") ?? ""));
  }

  const rowIndex = new Map<string, number>();
  rowIds.forEach((id, index) => rowIndex.set(id, index));
  const mustQuote = refsThatMustBeQuoted(colInfos.map((col) => col.ref));

  const dataRows = rowMaps.map((map) => {
    const cells = map.get("cells") as Y.Map<string>;
    return colInfos.map((col) => toFileForm(cells.get(col.colId) ?? "", colInfos, rowIds, rowIndex, mustQuote));
  });

  const bag: Record<string, unknown> = {};
  doc.getMap("meta").forEach((value, key) => {
    bag[key] = value;
  });
  doc.getMap("raw").forEach((value, key) => {
    bag[key] = value;
  });
  bag.columns = colDefs;

  const frontmatter: Record<string, unknown> = {};
  for (const key of PREFERRED_KEYS) {
    if (key in bag) frontmatter[key] = bag[key];
  }
  for (const key of Object.keys(bag)) {
    if (!(key in frontmatter)) frontmatter[key] = bag[key];
  }

  const header = colDefs.map((col) => (typeof col.name === "string" ? col.name : (col.ref ?? "")));
  return { frontmatter, columns: colDefs, header, rows: dataRows };
}
