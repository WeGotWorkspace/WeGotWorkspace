import type { ColumnType } from "../ycsv-core/types";
import { isCellError, type Value } from "../ycsv-formula/eval";

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
let formatMisses = 0;

function fmt<T>(key: string, make: () => T): T {
  let f = cache.get(key) as T | undefined;
  if (!f) {
    formatMisses += 1;
    f = make();
    cache.set(key, f as never);
  }
  return f;
}

export function formatCacheStats(): { entries: number; misses: number } {
  return { entries: cache.size, misses: formatMisses };
}

export function formatValue(
  value: Value,
  col: { type?: ColumnType; currency?: string; locale?: string },
): string {
  if (isCellError(value)) return `${value}!`;
  if (col.type === "currency" || col.type === "percent" || col.type === "number") {
    if (typeof value !== "number") return String(value);
    if (col.type === "currency") {
      const locale = col.locale ?? "nl-NL";
      const currency = col.currency ?? "EUR";
      return fmt(`currency|${locale}|${currency}`, () =>
        new Intl.NumberFormat(locale, { style: "currency", currency }),
      ).format(value);
    }
    if (col.type === "percent") {
      return fmt(`percent|${col.locale ?? ""}`, () => new Intl.NumberFormat(col.locale, { style: "percent" })).format(
        value,
      );
    }
    return String(value);
  }
  if (col.type === "date" || col.type === "datetime") {
    if (typeof value === "boolean") return String(value);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    if (col.type === "date") {
      return fmt(`date|${col.locale ?? ""}`, () => new Intl.DateTimeFormat(col.locale)).format(date);
    }
    return fmt(
      `datetime|${col.locale ?? ""}|short|short`,
      () => new Intl.DateTimeFormat(col.locale, { dateStyle: "short", timeStyle: "short" }),
    ).format(date);
  }
  if (col.type === "boolean") {
    if (value === true) return "ja";
    if (value === false) return "nee";
    return String(value);
  }
  return String(value);
}
