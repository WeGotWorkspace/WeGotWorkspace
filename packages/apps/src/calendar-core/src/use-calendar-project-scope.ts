import { useMemo } from "react";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import { collectionsInProject } from "@/lib/projects/project-match";
import { useSelectedProjectIds } from "@/lib/projects/use-project-filter";

/**
 * The calendars the suite Project filter keeps (#818), and which of them show events.
 * Sidebar and main pane both read this, so they agree. Hidden ids of calendars outside
 * the Project stay as they are, so "All Projects" brings the same toggles back.
 */
export function useCalendarProjectScope(
  calendars: readonly CalendarInfo[],
  hiddenCalendarIds: ReadonlySet<string>,
) {
  const projectIds = useSelectedProjectIds();
  const shown = useMemo(() => collectionsInProject(calendars, projectIds), [calendars, projectIds]);
  const visibleCalendarIds = useMemo(
    () => new Set(shown.filter((c) => !hiddenCalendarIds.has(c.id)).map((c) => c.id)),
    [shown, hiddenCalendarIds],
  );
  return { projectIds, shown, visibleCalendarIds };
}
