import { createContext, useContext, type MutableRefObject } from "react";
import type { FormulaSheetInfo } from "@/spreadsheet-core/src/formula-suggest";
import type { ColumnSetting, Defs } from "@/spreadsheet-core/src/ycsv/ycsv";

/**
 * Editor context for the in-cell formula editor. Replaces the original
 * module-level global so multiple grids never share mutable state.
 */
export type SpreadsheetGridContextValue = {
  defs: Defs;
  columnSettings: ColumnSetting[];
  sheets: FormulaSheetInfo[];
  activeSheetRef: string;
  /** Live bridge while the in-cell formula editor is open. */
  cellFormulaEdit: MutableRefObject<CellFormulaEditBridge | null>;
  notifyCellPicking: (open: boolean) => void;
  setCellFormulaDraft: (draft: string) => void;
};

export type CellFormulaEditBridge = {
  draft: string;
  caret: number;
  insertedLen: number;
  setDraft: (next: string, caret: number) => void;
  insertRef: (ref: string) => void;
};

const defaultCellFormulaEdit = { current: null } as MutableRefObject<CellFormulaEditBridge | null>;

const SpreadsheetGridContext = createContext<SpreadsheetGridContextValue>({
  defs: {},
  columnSettings: [],
  sheets: [],
  activeSheetRef: "",
  cellFormulaEdit: defaultCellFormulaEdit,
  notifyCellPicking: () => {},
  setCellFormulaDraft: () => {},
});

export const SpreadsheetGridProvider = SpreadsheetGridContext.Provider;

export function useSpreadsheetGridContext(): SpreadsheetGridContextValue {
  return useContext(SpreadsheetGridContext);
}
