export const spreadsheetLabels = {
  toastSaved: "Spreadsheet saved",
  emptyTitle: "No spreadsheet open",
  emptyDescription: "Open a .ycsv file from Drive to start editing.",
  loadError: "Could not load this spreadsheet.",
  saveError: "Could not save this spreadsheet.",
  renameError: "Could not rename this spreadsheet.",
  parseError: "This source has a YCSV syntax error; the grid shows the last valid state.",
  viewSource: "Edit source",
  hideSource: "Hide source",
  statsColumns: (count: number) =>
    `${count.toLocaleString()} ${count === 1 ? "column" : "columns"}`,
  statsRows: (count: number) => `${count.toLocaleString()} ${count === 1 ? "row" : "rows"}`,
  addRow: "Add row",
  addColumn: "Add column",
  rename: "Rename",
  renameDialogTitle: "Rename spreadsheet",
  renameDialogDescription: "Change the name; the file extension cannot be edited.",
  renameAction: "Rename",
  cancel: "Cancel",
  sidebarSheets: "Sheets",
  newSheet: "New sheet",
  toastSheetCreated: (ref: string) => `Sheet “${ref}” created`,
  renameSheet: "Rename sheet",
  renameSheetDialogTitle: "Rename sheet",
  renameSheetDialogDescription: "Change the display name; the sheet reference stays the same.",
  renameSheetAction: "Save",
  toastSheetRenamed: (name: string) => `Renamed to “${name}”`,
  deleteSheet: "Delete sheet",
  deleteSheetTitle: "Delete sheet?",
  deleteSheetDescription: (name: string) =>
    `“${name}” and its data will be removed from this workbook.`,
  deleteSheetConfirm: "Delete",
  sheetsEmpty: "No sheets in this workbook yet.",
  formulaBarPlaceholder: "Type a value or =FORMULA(…)",
  pickingHint: "click cells to insert",
  selectionCells: (count: number) => `${count} cells selected`,
  selectionRows: (count: number) => `${count} rows selected`,
  selectionColumns: (count: number) => `${count} columns selected`,
  selectionEntireRow: (row: number) => `entire row ${row}`,
  selectionEntireColumn: (column: string) => `entire column ${column}`,
} as const;

export type SpreadsheetUILabels = typeof spreadsheetLabels;

export function mergeSpreadsheetLabels(
  overrides?: Partial<SpreadsheetUILabels>,
): SpreadsheetUILabels {
  return { ...spreadsheetLabels, ...overrides };
}
