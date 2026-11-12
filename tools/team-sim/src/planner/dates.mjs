/** Date helpers on ISO calendar dates (YYYY-MM-DD), UTC arithmetic only. */
const DAY = 86400000;

export const toDay = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const fromDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromDay(toDay(iso) + n * DAY);
export const daysBetween = (a, b) => Math.round((toDay(b) - toDay(a)) / DAY);
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (iso) => new Date(toDay(iso)).getUTCDay();
export const isWeekend = (iso) => [0, 6].includes(weekday(iso));
export const inRange = (iso, from, to) => iso >= from && iso <= to;

export function assertIsoDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || fromDay(toDay(iso)) !== iso) {
    throw new Error(`not an ISO date: ${iso}`);
  }
  return iso;
}

/** Weekdays (Mon–Fri) from `from` (inclusive) up to `to` (exclusive). */
export function weekdaysBetween(from, to) {
  let count = 0;
  for (let d = from; d < to; d = addDays(d, 1)) if (!isWeekend(d)) count += 1;
  return count;
}

/** Local wall time on a date in a time zone → UTC ISO timestamp. */
export function zonedIso(date, hhmm, timeZone) {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return new Date(guess - (shown - guess)).toISOString();
}
