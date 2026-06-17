import type { Defs, DefValue } from "@/spreadsheet-core/src/ycsv/ycsv";

export type DefKind = "scalar" | "mapping" | "list";

export function defKind(value: DefValue): DefKind {
  if (Array.isArray(value)) return "list";
  if (value !== null && typeof value === "object") return "mapping";
  return "scalar";
}

function defValuesEqual(a: DefValue, b: DefValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Sheet-local defs: merged values that differ from or are absent in workbook defs. */
export function extractSheetLocalDefs(merged: Defs, workbookDefs: Defs): Defs {
  const local: Defs = {};
  for (const [key, value] of Object.entries(merged)) {
    const workbookValue = workbookDefs[key];
    if (workbookValue === undefined || !defValuesEqual(workbookValue, value)) {
      local[key] = value;
    }
  }
  return local;
}

export function mergeSheetDefs(workbookDefs: Defs, sheetLocalDefs: Defs): Defs {
  return { ...workbookDefs, ...sheetLocalDefs };
}

export function parseScalarDefInput(raw: string): DefValue {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

export function scalarDefToInput(value: DefValue): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}
