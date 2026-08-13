/** One-shot class toggled on the calendar main range wrapper when day/week/month/year changes. */
export const CALENDAR_RANGE_TRANSITION_CLASS = "calendar-main__range--animate";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Restart the zoom/cross-fade enter animation. No-op when reduced motion is preferred
 * or `node` is missing — callers keep an instant swap.
 */
export function restartCalendarRangeTransition(node: HTMLElement | null): void {
  if (!node || prefersReducedMotion()) return;
  node.classList.remove(CALENDAR_RANGE_TRANSITION_CLASS);
  // Force reflow so removing/re-adding the class restarts the animation.
  void node.offsetWidth;
  node.classList.add(CALENDAR_RANGE_TRANSITION_CLASS);
}
