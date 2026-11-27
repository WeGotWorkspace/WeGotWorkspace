// Adapter for the upstream parser + engine (origin/feat/spreadsheet-core, packages/apps/src/spreadsheet-core).
import { parseYcsv, serializeYcsv } from "@/spreadsheet-core/src/ycsv/ycsv";
import { evaluateWorkbook } from "@/spreadsheet-core/src/ycsv/ycsv-formula-engine";
import { displayOf, type Impl, type NormResult, type NormSheet } from "./types";

function parse(text: string): NormResult {
  try {
    const wb = parseYcsv(text);
    const computed = evaluateWorkbook(wb);
    const sheets: NormSheet[] = wb.sheets.map((sheet, si) => {
      const values: Record<string, string> = {};
      // Engine matrix row 0 = header, row k = data row k (spec numbering).
      sheet.rows.forEach((row, r) => {
        row.forEach((_, c) => {
          const cell = computed[si]?.[r + 1]?.[c];
          values[`${sheet.refs[c]}${r + 1}`] = cell ? (cell.error ? cell.display : displayOf(cell.value)) : "";
        });
      });
      return { ref: sheet.ref, name: sheet.name, refs: [...sheet.refs], rows: sheet.rows.map((r) => [...r]), values };
    });
    return { status: "ok", warnings: [...wb.warnings], sheets };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export const coreImpl: Impl = {
  id: "core",
  label: "spreadsheet-core (feat/spreadsheet-core)",
  parse,
  roundTrip(text) {
    try {
      return serializeYcsv(parseYcsv(text));
    } catch {
      return null;
    }
  },
};

/**
 * Same engine, but every `<ref><n>` in a formula is rewritten to `<ref><n+1>` first. The
 * upstream engine numbers the header as row 1 (Excel style) while the spec numbers the first
 * data row as 1; this variant shows which failures are only that offset.
 */
function shiftRows(text: string): string {
  const wb = parseYcsv(text);
  const known = new Set(wb.sheets.flatMap((s) => s.refs.map((r) => r.toLowerCase())));
  for (const sheet of wb.sheets) {
    sheet.rows = sheet.rows.map((row) =>
      row.map((cell) => {
        if (!cell.startsWith("=")) return cell;
        return cell.replace(/("(?:[^"]|"")*")|([A-Za-z_][A-Za-z0-9_]*?)(\d+)(?![A-Za-z0-9_(])/g, (m, str, ref, n) => {
          if (str) return str;
          return known.has(String(ref).toLowerCase()) ? `${ref}${Number(n) + 1}` : m;
        });
      }),
    );
  }
  return serializeYcsv(wb);
}

export const coreShiftedImpl: Impl = {
  id: "core",
  label: "spreadsheet-core, formulas shifted +1 row",
  parse(text) {
    try {
      return parse(shiftRows(text));
    } catch (error) {
      return { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  },
  roundTrip: () => null,
};
