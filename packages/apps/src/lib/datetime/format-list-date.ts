/** Parse an ISO (or Date-parseable) string; null when invalid. */
export function parseTimestamp(value: string): number | null {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

// One formatter per shape: building an Intl.DateTimeFormat costs far more than
// formatting with it, and list rows format a date each (#1714).
let timeFormat: Intl.DateTimeFormat | null = null;
let dayMonthFormat: Intl.DateTimeFormat | null = null;
let dayMonthYearFormat: Intl.DateTimeFormat | null = null;

function listTimeFormat(): Intl.DateTimeFormat {
  timeFormat ??= new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  return timeFormat;
}

function listDayFormat(withYear: boolean): Intl.DateTimeFormat {
  if (withYear) {
    dayMonthYearFormat ??= new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    return dayMonthYearFormat;
  }
  dayMonthFormat ??= new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" });
  return dayMonthFormat;
}

/**
 * Compact list/footer stamp: time today, day+month this year, else day+month+year.
 * Returns the raw string when it is not a parseable timestamp.
 */
export function formatListDateTime(raw: string): string {
  const ts = parseTimestamp(raw);
  if (ts === null) return raw;
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return listTimeFormat().format(d);
  return listDayFormat(d.getFullYear() !== now.getFullYear()).format(d);
}
