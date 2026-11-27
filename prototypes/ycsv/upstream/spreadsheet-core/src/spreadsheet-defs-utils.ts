import type { DefMapping, Defs, DefValue } from "@/spreadsheet-core/src/ycsv/ycsv";

export type DefKind = "scalar" | "mapping" | "list";

export function defKind(value: DefValue): DefKind {
  if (Array.isArray(value)) return "list";
  if (value !== null && typeof value === "object") return "mapping";
  return "scalar";
}

/** Resolve a mapping def by name (case-insensitive). */
export function getMappingDef(defs: Defs, name: string): DefMapping | undefined {
  const key = Object.keys(defs).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const value = defs[key];
  return defKind(value) === "mapping" ? (value as DefMapping) : undefined;
}

/** Names and mapping keys for formula autocomplete and highlighting. */
export function buildFormulaDefContext(defs: Defs) {
  const consts = new Set<string>();
  const mappingDefs = new Map<string, Set<string>>();
  for (const [name, value] of Object.entries(defs)) {
    consts.add(name);
    if (defKind(value) === "mapping") {
      mappingDefs.set(
        name.toLowerCase(),
        new Set(Object.keys(value as DefMapping).map((k) => k.toLowerCase())),
      );
    }
  }
  return { consts, mappingDefs };
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
