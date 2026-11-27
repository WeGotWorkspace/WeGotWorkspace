import * as Y from "yjs";
import { cleanup, resolveOrder } from "./order";

/**
 * Integration slice: the Yjs layout of a workbook. Several sheets per doc, each with
 * spike 9's order-array layout for rows and columns.
 *
 *   sheets:     Y.Map<sheetId, Y.Map{
 *                 ref: string, name?: string,
 *                 rowOrder: Y.Array<rowId>, rowData: Y.Map<rowId, Y.Map<colId, idFormText>>,
 *                 colOrder: Y.Array<colId>, colData: Y.Map<colId, Y.Map{ref, name?, type?, rest, width?}>,
 *                 meta: Y.Map{ frozen_rows?, defs?, cells?, charts?, …other sheet keys } }>
 *   sheetOrder: Y.Array<sheetId>   (same read rule as rows: first occurrence with data wins)
 *   book:       Y.Map{ ycsv_version, defs, …top-level frontmatter keys }
 *
 * The child types of a sheet are created with the sheet and never replaced, so a peer's
 * edit can never land in a type someone else swapped out (the bug spike 9 fixed for rows).
 */
export const SHEETS = "sheets";
export const SHEET_ORDER = "sheetOrder";
export const BOOK = "book";
export const LOCAL = "local";

export type SheetParts = {
  map: Y.Map<unknown>;
  rowOrder: Y.Array<string>;
  rowData: Y.Map<Y.Map<string>>;
  colOrder: Y.Array<string>;
  colData: Y.Map<Y.Map<unknown>>;
  meta: Y.Map<unknown>;
};

export const sheetsOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap<Y.Map<unknown>>(SHEETS);
export const sheetOrderOf = (doc: Y.Doc): Y.Array<string> => doc.getArray<string>(SHEET_ORDER);
export const bookOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>(BOOK);

export function partsOf(map: Y.Map<unknown>): SheetParts {
  return {
    map,
    rowOrder: map.get("rowOrder") as Y.Array<string>,
    rowData: map.get("rowData") as Y.Map<Y.Map<string>>,
    colOrder: map.get("colOrder") as Y.Array<string>,
    colData: map.get("colData") as Y.Map<Y.Map<unknown>>,
    meta: map.get("meta") as Y.Map<unknown>,
  };
}

export function sheetParts(doc: Y.Doc, sheetId: string): SheetParts | null {
  const map = sheetsOf(doc).get(sheetId);
  return map ? partsOf(map) : null;
}

/** A detached sheet map with its child types; insert it into `sheets` to use it. */
export function newSheetMap(ref: string, name?: string): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set("ref", ref);
  if (name !== undefined && name !== ref) map.set("name", name);
  map.set("rowOrder", new Y.Array<string>());
  map.set("rowData", new Y.Map<Y.Map<string>>());
  map.set("colOrder", new Y.Array<string>());
  map.set("colData", new Y.Map<Y.Map<unknown>>());
  map.set("meta", new Y.Map<unknown>());
  return map;
}

/** Sheet ids in tab order (spike 9 read rule). */
export function sheetIds(doc: Y.Doc): string[] {
  return resolveOrder(sheetOrderOf(doc).toArray(), sheetsOf(doc));
}

export function sheetRef(doc: Y.Doc, sheetId: string): string {
  return String(sheetsOf(doc).get(sheetId)?.get("ref") ?? "");
}

export function sheetName(doc: Y.Doc, sheetId: string): string {
  const map = sheetsOf(doc).get(sheetId);
  const name = map?.get("name");
  return typeof name === "string" ? name : String(map?.get("ref") ?? "");
}

export function sheetIdByRef(doc: Y.Doc, ref: string): string | null {
  for (const id of sheetIds(doc)) if (sheetRef(doc, id) === ref) return id;
  return null;
}

/** Shared types a per-user UndoManager tracks: everything a gesture can change. */
export function undoScope(doc: Y.Doc): Y.AbstractType<unknown>[] {
  return [sheetsOf(doc), sheetOrderOf(doc), bookOf(doc)] as Y.AbstractType<unknown>[];
}

/** Write back the read rule for every order (rows, columns, sheets). Returns the number of fixes. */
export function repairWorkbook(doc: Y.Doc): number {
  let fixes = 0;
  doc.transact(() => {
    fixes += cleanup(sheetOrderOf(doc), sheetsOf(doc));
    sheetsOf(doc).forEach((map) => {
      const p = partsOf(map);
      fixes += cleanup(p.rowOrder, p.rowData);
      fixes += cleanup(p.colOrder, p.colData);
    });
  }, "repair");
  return fixes;
}
