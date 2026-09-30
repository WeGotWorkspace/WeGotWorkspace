import type { CalendarViewId } from "@/calendar-core/src/calendar-types";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";

/** Day → Year by time span — list is a presentation toggle, not a dropdown option. */
export const CALENDAR_VIEW_ORDER: CalendarViewId[] = ["day", "week", "month", "year"];

export function closeCalendarSidebarOnMobile(close: () => void): void {
  if (!isSidebarOverlayViewport()) return;
  close();
}
