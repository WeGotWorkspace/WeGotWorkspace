const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseInvitationInstant(value: string): Date | null {
  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateLabel(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTimeLabel(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** Formats invitation start/end for the docs-style card header and body. */
export function formatInvitationWhen(
  start: string | null | undefined,
  end: string | null | undefined,
  locale: string,
): string | null {
  if (!start) return null;
  const startDate = parseInvitationInstant(start);
  if (!startDate) return null;

  const endDate = end ? parseInvitationInstant(end) : null;
  const startIsDateOnly = DATE_ONLY.test(start);
  const endIsDateOnly = Boolean(end && DATE_ONLY.test(end));

  if (startIsDateOnly) {
    const startLabel = formatDateLabel(startDate, locale);
    if (endDate && endIsDateOnly && startDate.toDateString() !== endDate.toDateString()) {
      return `${startLabel} – ${formatDateLabel(endDate, locale)}`;
    }
    return startLabel;
  }

  const datePart = formatDateLabel(startDate, locale);
  const startTime = formatTimeLabel(startDate, locale);
  if (!endDate) return `${datePart} · ${startTime}`;

  const endTime = formatTimeLabel(endDate, locale);
  if (startDate.toDateString() === endDate.toDateString()) {
    return `${datePart} · ${startTime}–${endTime}`;
  }
  return `${datePart} · ${startTime} – ${formatDateLabel(endDate, locale)} · ${endTime}`;
}
