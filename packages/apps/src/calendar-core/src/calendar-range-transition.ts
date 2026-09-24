import type { CalendarViewId } from "@/calendar-core/src/calendar-types";

/** Fallback enter classes when animating range changes (CSS only — no View Transitions API). */
export const CALENDAR_RANGE_ZOOM_IN_CLASS = "calendar-range--animate-in";
export const CALENDAR_RANGE_ZOOM_OUT_CLASS = "calendar-range--animate-out";

export const CALENDAR_RANGE_TRANSITION_CLASSES = [
  CALENDAR_RANGE_ZOOM_IN_CLASS,
  CALENDAR_RANGE_ZOOM_OUT_CLASS,
] as const;

/** Fired on the range scope after the enter animation class is removed (transform gone). */
export const CALENDAR_RANGE_TRANSITION_END_EVENT = "calendar-range-transition-end";

const RANGE_ANIMATION_MS = 360;

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
 * CSS enter animation for a range change. Intentionally avoids `document.startViewTransition`:
 * VT + Lit `scheduleUpdate` / nested `updateComplete` waits deadlocked the calendar UI
 * (frozen day/week/month/year swaps). A short opacity/scale on the incoming surface is enough.
 */
export function restartCalendarRangeTransition(
  node: HTMLElement | null,
  direction: CalendarRangeZoomDirection,
): void {
  if (!node || prefersReducedMotion()) return;
  clearCalendarRangeTransition(node);
  void node.offsetWidth;
  node.classList.add(
    direction === "out" ? CALENDAR_RANGE_ZOOM_OUT_CLASS : CALENDAR_RANGE_ZOOM_IN_CLASS,
  );
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    globalThis.clearTimeout(fallback);
    // Vitest may tear down jsdom before the fallback timer fires.
    if (typeof window === "undefined") return;
    clearCalendarRangeTransition(node);
    node.removeEventListener("animationend", onEnd);
    node.dispatchEvent(
      new CustomEvent(CALENDAR_RANGE_TRANSITION_END_EVENT, { bubbles: true, composed: true }),
    );
  };
  const onEnd = (event: Event) => {
    if (event.target !== node) return;
    settle();
  };
  node.addEventListener("animationend", onEnd);
  const fallback = globalThis.setTimeout(settle, RANGE_ANIMATION_MS + 50);
}

/**
 * Apply a range DOM update, then optionally run the CSS enter animation on `scope`.
 * Always synchronous w.r.t. Lit's update cycle — never wraps updates in View Transitions.
 */
export function runCalendarRangeViewTransition(
  scope: HTMLElement | null,
  direction: CalendarRangeZoomDirection,
  update: () => void,
): void {
  update();
  if (prefersReducedMotion()) return;
  restartCalendarRangeTransition(scope, direction);
}
