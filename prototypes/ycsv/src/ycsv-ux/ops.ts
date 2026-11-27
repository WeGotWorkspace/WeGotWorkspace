/**
 * Integration slice: the grid's gestures now live in `sheets-core/model/ops.ts` on spike 9's
 * order-array layout, one sheet of a workbook at a time. Kept as a module so the grid's
 * imports stay put.
 */
export {
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  moveColumns,
  moveRows,
  setColumnWidth,
  setFrozenRows,
  sortRows,
  writeCells,
  type CellWrite,
  type SheetRef,
} from "../sheets-core/model/ops";
export { LOCAL } from "../sheets-core/model/workbook";
export { createSheetUndoManager as makeUndoManager, guardedUndo } from "../sheets-core/collab/undo";
