export function formatDateRangeShort(
  lang: string | undefined,
  startDate: {
    toLocaleString(locale: string | undefined, options: Intl.DateTimeFormatOptions): string;
  },
  endDate: {
    toLocaleString(locale: string | undefined, options: Intl.DateTimeFormatOptions): string;
  },
): string {
  const dateFormatOptions = { month: "short", day: "numeric" } as const;
  const formattedStart = startDate.toLocaleString(lang, dateFormatOptions);
  const formattedEnd = endDate.toLocaleString(lang, dateFormatOptions);
  return `${formattedStart} - ${formattedEnd}`;
}
