import type { Notice } from "@/notice-bar/src/notice-bar";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";

export const TEAM_AVAILABILITY_NOTICE_ID = "team-availability-offline";

/** What the cache holds for the shown teammates and the weeks in view. */
export type TeamAvailabilityCoverage = {
  /** Oldest `fetchedAt` of the cached weeks in view; null when none is cached. */
  oldestFetchedAt: number | null;
  /** A week in view was never fetched for at least one shown teammate. */
  uncachedWeeks: boolean;
};

type NoticeLabels = Pick<
  CalendarUILabels,
  | "teamAvailabilityOfflineUpdated"
  | "teamAvailabilityOfflineUncached"
  | "teamAvailabilityOfflineNone"
  | "teamAvailabilityJustNow"
>;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** "5 minutes ago", "2 days ago"; under a minute is "just now". */
export function formatAvailabilityAge(
  fetchedAt: number,
  now: number,
  locale: string | undefined,
  justNow: string,
): string {
  const elapsed = Math.max(0, now - fetchedAt);
  const format = new Intl.RelativeTimeFormat(locale || undefined, { numeric: "always" });
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit);
  }
  return justNow;
}

/**
 * One `info` notice while offline with shown teammates: how old the cached
 * busy times are, and whether a week in view was never fetched, so an empty
 * week is not read as free. Gone when the connection is back.
 */
export function teamAvailabilityOfflineNotice({
  online,
  shownCount,
  coverage,
  now,
  locale,
  labels,
}: {
  online: boolean;
  shownCount: number;
  coverage: TeamAvailabilityCoverage;
  now: number;
  locale?: string;
  labels: NoticeLabels;
}): Notice | null {
  if (online || shownCount === 0) return null;
  const title =
    coverage.oldestFetchedAt === null
      ? labels.teamAvailabilityOfflineNone
      : [
          labels.teamAvailabilityOfflineUpdated(
            formatAvailabilityAge(
              coverage.oldestFetchedAt,
              now,
              locale,
              labels.teamAvailabilityJustNow,
            ),
          ),
          coverage.uncachedWeeks ? labels.teamAvailabilityOfflineUncached : "",
        ]
          .filter(Boolean)
          .join(" ");
  return { id: TEAM_AVAILABILITY_NOTICE_ID, tone: "info", title };
}
