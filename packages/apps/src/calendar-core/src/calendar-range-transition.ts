import type { CalendarViewId } from "@/calendar-core/src/calendar-types";

/** Enter classes for day/week/month/year range changes (directional zoom + cross-fade). */
export const CALENDAR_RANGE_ZOOM_IN_CLASS = "calendar-main__range--animate-in";
export const CALENDAR_RANGE_ZOOM_OUT_CLASS = "calendar-main__range--animate-out";

export const CALENDAR_RANGE_TRANSITION_CLASSES = [
  CALENDAR_RANGE_ZOOM_IN_CLASS,
  CALENDAR_RANGE_ZOOM_OUT_CLASS,
] as const;

/** Narrower → wider time span zooms out; wider → narrower zooms in. */
export type CalendarRangeZoomDirection = "in" | "out";

/** Day < week < month < year (time-span width). */
const VIEW_RANK: Record<CalendarViewId, number> = {
  day: 0,
  week: 1,
  month: 2,
  year: 3,
};

export function calendarRangeViewRank(view: CalendarViewId): number {
  return VIEW_RANK[view];
}

/**
 * Zoom direction when changing time-range views.
 * Returns `null` when ranks match (no range change).
 */
export function calendarRangeZoomDirection(
  from: CalendarViewId,
  to: CalendarViewId,
): CalendarRangeZoomDirection | null {
  const delta = calendarRangeViewRank(to) - calendarRangeViewRank(from);
  if (delta === 0) return null;
  return delta > 0 ? "out" : "in";
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function clearCalendarRangeTransition(node: HTMLElement): void {
  for (const cls of CALENDAR_RANGE_TRANSITION_CLASSES) {
    node.classList.remove(cls);
  }
}

/**
 * Restart the directional zoom/cross-fade enter animation. No-op when reduced
 * motion is preferred or `node` is missing — callers keep an instant swap.
 */
export function restartCalendarRangeTransition(
  node: HTMLElement | null,
  direction: CalendarRangeZoomDirection,
): void {
  if (!node || prefersReducedMotion()) return;
  clearCalendarRangeTransition(node);
  // Force reflow so removing/re-adding the class restarts the animation.
  void node.offsetWidth;
  node.classList.add(
    direction === "out" ? CALENDAR_RANGE_ZOOM_OUT_CLASS : CALENDAR_RANGE_ZOOM_IN_CLASS,
  );
}
