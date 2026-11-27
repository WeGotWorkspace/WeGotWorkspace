// Adapter for the overnight prototype (prototypes/ycsv: ycsv-core + ycsv-formula + ycsv-model refs).
// Evaluation follows what the grid does: file-form refs → id-form → evaluateAll.
import { parse as parseFile, serialize } from "../../src/ycsv-core";
import { evaluateAll } from "../../src/ycsv-formula";
import { resetAstCache } from "../../src/ycsv-formula/graph";
import { toIdForm, type ColInfo } from "../../src/ycsv-model/refs";
import { type Impl, type NormResult } from "./types";

function letter(index: number): string {
  let s = "";
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function display(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function parse(text: string): NormResult {
  try {
    resetAstCache();
    const file = parseFile(text);
    const width = Math.max(file.header.length, file.columns.length);
    const refs = Array.from({ length: width }, (_, i) => file.columns[i]?.ref ?? letter(i));
    const cols: ColInfo[] = refs.map((ref, i) => ({ colId: ref, ref, header: file.header[i] }));
    const rowIds = file.rows.map((_, i) => `r${i + 1}`);
    const raw = new Map<string, string>();
    file.rows.forEach((row, r) => {
      refs.forEach((ref, c) => {
        raw.set(`${ref}@${rowIds[r]}`, toIdForm(row[c] ?? "", cols, rowIds));
      });
    });
    const defs = (file.frontmatter.defs ?? {}) as Record<string, unknown>;
    const evaluated = evaluateAll(raw, rowIds, defs, refs);
    const values: Record<string, string> = {};
    file.rows.forEach((_, r) => {
      refs.forEach((ref) => {
        values[`${ref}${r + 1}`] = display(evaluated.get(`${ref}@${rowIds[r]}`));
      });
    });
    const name = typeof file.frontmatter.name === "string" ? file.frontmatter.name : "sheet1";
    return {
      status: "ok",
      warnings: [],
      sheets: [{ ref: "sheet1", name, refs, rows: file.rows.map((r) => [...r]), values }],
    };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export const protoImpl: Impl = {
  id: "proto",
  label: "prototype (prototypes/ycsv)",
  parse,
  roundTrip(text) {
    try {
      return serialize(parseFile(text));
    } catch {
      return null;
    }
  },
};
