// Normalised parse + evaluate result, so the two YCSV implementations can be compared.

export type NormSheet = {
  ref: string;
  name: string;
  /** Column refs in position order. */
  refs: string[];
  /** Raw data cells (header excluded), as the parser kept them. */
  rows: string[][];
  /**
   * Evaluated values keyed by `<ref><row>` in **spec numbering** (row 1 = first data row,
   * §7.1). Errors are strings starting with `#`. Values are display strings.
   */
  values: Record<string, string>;
};

export type NormResult =
  | { status: "ok"; warnings: string[]; sheets: NormSheet[] }
  | { status: "error"; error: string };

export type Impl = {
  id: "core" | "proto";
  label: string;
  parse(text: string): NormResult;
  /** Parse then serialise; `null` when the implementation cannot serialise this input. */
  roundTrip(text: string): string | null;
};

export function displayOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Error) return value.message.startsWith("#") ? value.message : "#ERROR!";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  return String(value);
}
