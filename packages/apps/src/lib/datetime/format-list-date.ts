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
let relativeDayFormat: Intl.RelativeTimeFormat | null = null;

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

/** "Yesterday" in the viewer's language, capitalised for a list cell. */
function yesterdayLabel(): string {
  relativeDayFormat ??= new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const label = relativeDayFormat.format(-1, "day");
  return label.charAt(0).toLocaleUpperCase() + label.slice(1);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Compact list/footer stamp, locale-based: time today, "Yesterday", day+month this
 * year, else day+month+year.
 */
export function formatListTimestamp(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (isSameDay(d, now)) return listTimeFormat().format(d);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameDay(d, yesterday)) return yesterdayLabel();
  return listDayFormat(d.getFullYear() !== now.getFullYear()).format(d);
}

/**
 * {@link formatListTimestamp} for a date string. Returns the raw string when it is
 * not a parseable timestamp.
 */
export function formatListDateTime(raw: string): string {
  const ts = parseTimestamp(raw);
  if (ts === null) return raw;
  return formatListTimestamp(ts);
}
