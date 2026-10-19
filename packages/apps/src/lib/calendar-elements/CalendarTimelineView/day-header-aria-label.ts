/**
 * Accessible names for the timeline day-header buttons. Each leads with the text shown on
 * the button and then gives the full date, so the name contains the visible label
 * (WCAG 2.5.3 / axe label-content-name-mismatch).
 */

function fullDate(locale: string, dayDate: Date): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(dayDate);
}

/** Single-timeline header showing "Sun 9": "Sun 9, Sunday, August 9, 2026". */
export function dayHeaderAriaLabel(locale: string, dayDate: Date, visibleLabel: string): string {
  return `${visibleLabel}, ${fullDate(locale, dayDate)}`;
}

/**
 * Month header: plain day numbers already appear in the full date; the 1st shows the
 * month boundary ("Aug 1"), which is put first.
 */
export function monthDayHeaderAriaLabel(locale: string, dayDate: Date): string {
  if (dayDate.getUTCDate() !== 1) return fullDate(locale, dayDate);
  // Same formatter options as the visible pill, so the two always agree.
  const boundary = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
    dayDate,
  );
  return `${boundary}, ${fullDate(locale, dayDate)}`;
}
