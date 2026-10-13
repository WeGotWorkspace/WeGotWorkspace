import type { ColumnType } from "../ycsv-core/types";
import { isCellError, type Value } from "../ycsv-formula/eval";

export function formatValue(
  value: Value,
  col: { type?: ColumnType; currency?: string; locale?: string },
): string {
  if (isCellError(value)) return `${value}!`;
  if (col.type === "currency" || col.type === "percent" || col.type === "number") {
    if (typeof value !== "number") return String(value);
    if (col.type === "currency") {
      return new Intl.NumberFormat(col.locale ?? "nl-NL", {
        style: "currency",
        currency: col.currency ?? "EUR",
      }).format(value);
    }
    if (col.type === "percent") {
      return new Intl.NumberFormat(col.locale, { style: "percent" }).format(value);
    }
    return String(value);
  }
  if (col.type === "date" || col.type === "datetime") {
    if (typeof value === "boolean") return String(value);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    if (col.type === "date") return new Intl.DateTimeFormat(col.locale).format(date);
    return new Intl.DateTimeFormat(col.locale, { dateStyle: "short", timeStyle: "short" }).format(date);
  }
  if (col.type === "boolean") {
    if (value === true) return "ja";
    if (value === false) return "nee";
    return String(value);
  }
  return String(value);
}
