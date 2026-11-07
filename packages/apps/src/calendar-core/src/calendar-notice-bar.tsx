import { useEffect, useState } from "react";
import { NoticeBar } from "@/notice-bar/src/notice-bar";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { teamAvailabilityOfflineNotice } from "@/calendar-core/src/calendar-availability-notice";
import type { TeamAvailabilityState } from "@/calendar-core/src/use-team-availability";

/** The relative "updated …" stamp is redrawn this often while offline. */
const STAMP_REFRESH_MS = 60_000;

/**
 * Calendar's shared notice bar, between the header and the grid. Today it
 * holds the offline Team availability notice; #1914 adds its clash notice.
 */
export function CalendarNoticeBar({
  availability,
  labels,
  locale,
  now = Date.now,
}: {
  availability: Pick<TeamAvailabilityState, "online" | "shownIds" | "members" | "coverage">;
  labels: CalendarUILabels;
  locale?: string;
  now?: () => number;
}) {
  const { online } = availability;
  const [, redraw] = useState(0);
  useEffect(() => {
    if (online) return;
    const timer = window.setInterval(() => redraw((value) => value + 1), STAMP_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [online]);

  const shownCount = (availability.members ?? []).filter((member) =>
    availability.shownIds.has(member.id),
  ).length;
  return (
    <NoticeBar
      label={labels.calendarNoticeBarLabel}
      notices={[
        teamAvailabilityOfflineNotice({
          online,
          shownCount,
          coverage: availability.coverage,
          now: now(),
          locale,
          labels,
        }),
      ]}
    />
  );
}
