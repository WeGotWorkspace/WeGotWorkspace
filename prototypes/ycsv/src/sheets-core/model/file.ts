import YAML from "yaml";
import * as Y from "yjs";
import { serializeCsv } from "../../ycsv-core/csv";
import { parse } from "../../ycsv-core/parse";
import { serialize } from "../../ycsv-core/serialize";
import type { ColumnDef, YcsvFile } from "../../ycsv-core/types";
import { newColId, newRowId, newSheetId } from "./ids";
import { resolveOrder as resolveIds } from "./order";
import { bookToFileForm, bookToIdForm, type RefScope, type RefSheet } from "./refs";
import { readColumn } from "./view";
import { bookOf, LOCAL, newSheetMap, partsOf, sheetIds, sheetOrderOf, sheetsOf } from "./workbook";

/**
 * YCSV text ↔ workbook doc (integration slice). Multi-sheet per spec §3.1/§11: one
 * frontmatter with a `sheets` array, then one `---`-separated CSV body per sheet.
 * A file without `sheets` is one sheet with ref `sheet1`, and a workbook of exactly that
 * one sheet serialises back to the single-sheet form (byte-compatible with the prototype).
 *
 * This is a thin shim so the slice can load and save multi-sheet files; the real parser
 * and serializer are session sheets-interop's work (`spike/sheets-interop`). Known gap: a
 * quoted CSV field holding a line that is exactly `---` splits the body.
 */
export const SINGLE_SHEET_REF = "sheet1";

/** Keys that belong to a sheet, not to the workbook, in a single-sheet file. */
const SHEET_KEYS = new Set(["columns", "cells", "charts", "frozen_rows"]);
const PREFERRED_KEYS = ["ycsv_version", "name", "description", "created", "author", "defs", "sheets"];
const SHEET_PREFERRED = ["ref", "name", "columns", "defs", "cells", "charts"];

export type ParsedSheet = { ref: string; name?: string; file: YcsvFile; meta: Record<string, unknown> };
export type ParsedBook = { book: Record<string, unknown>; sheets: ParsedSheet[] };

function splitBlocks(text: string): { yaml: string; bodies: string[] } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new Error("YCSV: missing frontmatter");
  const lines = normalized.split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      blocks.push(current);
      current = [];
    } else current.push(lines[i] as string);
  }
  blocks.push(current);
  if (blocks.length < 2) throw new Error("YCSV: unterminated frontmatter");
  return { yaml: (blocks[0] as string[]).join("\n"), bodies: blocks.slice(1).map((b) => b.join("\n")) };
}

export function parseBook(text: string): ParsedBook {
  const { yaml, bodies } = splitBlocks(text);
  const front = (YAML.parse(yaml) as Record<string, unknown> | null) ?? {};
  if (!Array.isArray(front.sheets)) {
    const file = parse(text);
    const book: Record<string, unknown> = {};
    const meta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(file.frontmatter)) {
      if (key === "columns") continue;
      if (SHEET_KEYS.has(key)) meta[key] = value;
      else book[key] = value;
    }
    return { book, sheets: [{ ref: SINGLE_SHEET_REF, file, meta }] };
  }
  const book: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(front)) if (key !== "sheets") book[key] = value;
  const sheets = (front.sheets as Record<string, unknown>[]).map((entry, index): ParsedSheet => {
    const ref = typeof entry.ref === "string" && entry.ref !== "" ? entry.ref : `sheet${index + 1}`;
    const body = bodies[index] ?? "";
    // One sheet = one single-sheet parse, so header/column rules stay those of the prototype.
    const columns = Array.isArray(entry.columns) ? entry.columns : undefined;
    const sub = `---\n${columns ? YAML.stringify({ columns }) : ""}---\n${body}`;
    const file = parse(sub);
    const meta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) if (key !== "ref" && key !== "name" && key !== "columns") meta[key] = value;
    return { ref, name: typeof entry.name === "string" ? entry.name : undefined, file, meta };
  });
  return { book, sheets };
}

export type IdSource = {
  sheetId?: (sheet: number) => string;
  rowId?: (sheet: number, row: number) => string;
  colId?: (sheet: number, col: number) => string;
  origin?: unknown;
};

/** Write a parsed workbook into `doc` (empty) in one transaction. */
export function bookToDoc(parsed: ParsedBook, doc: Y.Doc, ids: IdSource = {}): void {
  const refSheets: RefSheet[] = parsed.sheets.map((sheet, s) => {
    const taken = new Set<string>();
    const cols = sheet.file.columns.map((column, c) => {
      const colId = ids.colId?.(s, c) ?? newColId(taken);
      taken.add(colId);
      return { colId, ref: column.ref ?? "", header: sheet.file.header[c] ?? "" };
    });
    const rowIds = sheet.file.rows.map((_, r) => ids.rowId?.(s, r) ?? newRowId());
    return { sheetId: ids.sheetId?.(s) ?? newSheetId(), ref: sheet.ref, cols, rowIds };
  });
  const byRef = new Map(refSheets.map((sheet) => [sheet.ref, sheet]));
  const byId = new Map(refSheets.map((sheet) => [sheet.sheetId, sheet]));

  doc.transact(() => {
    const book = bookOf(doc);
    for (const [key, value] of Object.entries(parsed.book)) book.set(key, value);
    const sheetsMap = sheetsOf(doc);
    parsed.sheets.forEach((sheet, s) => {
      const ref = refSheets[s] as RefSheet;
      const scope: RefScope = { self: ref, byRef: (r) => byRef.get(r) ?? null, byId: (id) => byId.get(id) ?? null };
      const map = newSheetMap(sheet.ref, sheet.name);
      sheetsMap.set(ref.sheetId, map);
      const p = partsOf(map);
      for (const [key, value] of Object.entries(sheet.meta)) p.meta.set(key, value);
      sheet.file.columns.forEach((column, c) => {
        const { ref: colRef, name, type, ...rest } = column;
        const colMap = new Y.Map<unknown>();
        colMap.set("ref", colRef ?? "");
        if (name !== undefined) colMap.set("name", name);
        if (type !== undefined) colMap.set("type", type);
        if (Object.keys(rest).length > 0) colMap.set("rest", rest);
        p.colData.set(ref.cols[c]?.colId as string, colMap);
      });
      p.colOrder.push(ref.cols.map((col) => col.colId));
      sheet.file.rows.forEach((row, r) => {
        const cells = new Y.Map<string>();
        row.forEach((text, c) => {
          // Empty cells are omitted (spike 4: −23 to −29% sidecar with short ids).
          if (text === "") return;
          const colId = ref.cols[c]?.colId;
          if (colId) cells.set(colId, text.startsWith("=") ? bookToIdForm(text, scope) : text);
        });
        p.rowData.set(ref.rowIds[r] as string, cells);
      });
      // One push per array: pushing one by one is quadratic in Yjs (spikes 4 and 5).
      p.rowOrder.push(ref.rowIds);
    });
    sheetOrderOf(doc).push(refSheets.map((sheet) => sheet.sheetId));
  }, ids.origin ?? LOCAL);
}

export function textToDoc(text: string, doc: Y.Doc, ids: IdSource = {}): void {
  bookToDoc(parseBook(text), doc, ids);
}

/** Scope for formulas of one sheet, from the live doc (resolved orders). */
export function docRefScope(doc: Y.Doc, sheetId: string, cache = new Map<string, RefSheet>()): RefScope {
  const get = (id: string): RefSheet | null => {
    const hit = cache.get(id);
    if (hit) return hit;
    const map = sheetsOf(doc).get(id);
    if (!map) return null;
    const p = partsOf(map);
    const rowIds = resolveIds(p.rowOrder.toArray(), p.rowData);
    const rowIndex = new Map<string, number>();
    rowIds.forEach((rowId, i) => rowIndex.set(rowId, i));
    const cols = resolveIds(p.colOrder.toArray(), p.colData).map((colId) => {
      const column = readColumn(colId, p.colData.get(colId));
      return { colId, ref: column.ref, header: column.name };
    });
    const sheet = { sheetId: id, ref: String(map.get("ref") ?? ""), cols, rowIds, rowIndex };
    cache.set(id, sheet);
    return sheet;
  };
  const self = get(sheetId);
  if (!self) throw new Error(`no sheet ${sheetId}`);
  return {
    self,
    byId: get,
    byRef: (ref) => {
      for (const id of sheetIds(doc)) if (String(sheetsOf(doc).get(id)?.get("ref") ?? "") === ref) return get(id);
      return null;
    },
  };
}

function columnDef(map: Y.Map<unknown> | undefined): ColumnDef {
  const def: ColumnDef = { ref: String(map?.get("ref") ?? "") };
  const name = map?.get("name");
  const type = map?.get("type");
  if (typeof name === "string") def.name = name;
  if (typeof type === "string") def.type = type as ColumnDef["type"];
  const rest = map?.get("rest");
  if (rest && typeof rest === "object") for (const [key, value] of Object.entries(rest as Record<string, unknown>)) def[key] = value;
  // A width set in the grid lives on the column map; it wins over the file's (spike 6).
  const width = map?.get("width");
  if (typeof width === "number") def.width = width;
  return def;
}

function ordered(record: Record<string, unknown>, preferred: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of preferred) if (key in record) out[key] = record[key];
  for (const key of Object.keys(record)) if (!(key in out)) out[key] = record[key];
  return out;
}

/** One sheet as a YcsvFile (file-form cells), plus its meta. */
export function sheetToFile(doc: Y.Doc, sheetId: string, cache?: Map<string, RefSheet>): { file: YcsvFile; meta: Record<string, unknown> } {
  const scope = docRefScope(doc, sheetId, cache);
  const p = partsOf(sheetsOf(doc).get(sheetId) as Y.Map<unknown>);
  const colDefs = scope.self.cols.map((col) => columnDef(p.colData.get(col.colId)));
  const rows = scope.self.rowIds.map((rowId) => {
    const cells = p.rowData.get(rowId);
    return scope.self.cols.map((col) => {
      const text = cells?.get(col.colId) ?? "";
      return text.startsWith("=") ? bookToFileForm(text, scope) : text;
    });
  });
  const meta: Record<string, unknown> = {};
  p.meta.forEach((value, key) => {
    meta[key] = value;
  });
  const header = colDefs.map((col) => (typeof col.name === "string" ? col.name : (col.ref ?? "")));
  return { file: { frontmatter: { columns: colDefs }, columns: colDefs, header, rows }, meta };
}

/** The canonical YCSV text of the workbook (what a save sends as the document half). */
export function docToText(doc: Y.Doc): string {
  const ids = sheetIds(doc);
  const book: Record<string, unknown> = {};
  bookOf(doc).forEach((value, key) => {
    book[key] = value;
  });
  const cache = new Map<string, RefSheet>();
  const only = ids.length === 1 ? sheetsOf(doc).get(ids[0] as string) : undefined;
  if (only && only.get("ref") === SINGLE_SHEET_REF && only.get("name") === undefined) {
    const { file, meta } = sheetToFile(doc, ids[0] as string, cache);
    return serialize({ ...file, frontmatter: { ...book, columns: file.columns, ...meta } });
  }
  const sheets = ids.map((id) => {
    const map = sheetsOf(doc).get(id) as Y.Map<unknown>;
    const { file, meta } = sheetToFile(doc, id, cache);
    const entry: Record<string, unknown> = { ref: map.get("ref"), ...meta, columns: file.columns };
    if (typeof map.get("name") === "string") entry.name = map.get("name");
    return { entry: ordered(entry, SHEET_PREFERRED), body: serializeCsv([file.header, ...file.rows]) };
  });
  const yaml = YAML.stringify(ordered({ ...book, sheets: sheets.map((s) => s.entry) }, PREFERRED_KEYS), {
    indent: 2,
    lineWidth: 0,
    singleQuote: false,
    nullStr: "",
  });
  return `---\n${yaml}${sheets.map((s) => `---\n${s.body}`).join("")}`;
}

/** File-form cells of one sheet (tests read this as `window.__sheet.cells()`). */
export function sheetCells(doc: Y.Doc, sheetId: string): string[][] {
  return sheetToFile(doc, sheetId).file.rows;
}
