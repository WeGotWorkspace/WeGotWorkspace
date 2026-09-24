/** Parse an ISO (or Date-parseable) string; null when invalid. */
export function parseTimestamp(value: string): number | null {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
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
  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}
