import type { LitElement } from "lit";
import type { CalendarViewId } from "@/calendar-core/src/calendar-types";

/** Named snapshot for the calendar range surface (not the app chrome). */
export const CALENDAR_RANGE_VIEW_TRANSITION_NAME = "calendar-range";

/** Set on `<html>` while a range VT runs so CSS can pick zoom direction. */
export const CALENDAR_RANGE_ZOOM_ATTR = "data-calendar-range-zoom";

/** Fallback enter classes when View Transitions API is unavailable. */
export const CALENDAR_RANGE_ZOOM_IN_CLASS = "calendar-range--animate-in";
export const CALENDAR_RANGE_ZOOM_OUT_CLASS = "calendar-range--animate-out";

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

type StartViewTransition = (
  callbackOrOptions:
    | (() => void | PromiseLike<void>)
    | {
        update?: () => void | PromiseLike<void>;
        types?: string[];
      },
) => { finished: Promise<void> };

function getDocumentStartViewTransition(): StartViewTransition | null {
  if (typeof document === "undefined") return null;
  const onDocument = document as Document & { startViewTransition?: StartViewTransition };
  if (typeof onDocument.startViewTransition === "function") {
    return onDocument.startViewTransition.bind(document) as StartViewTransition;
  }
  return null;
}

export function supportsCalendarRangeViewTransition(): boolean {
  return getDocumentStartViewTransition() !== null;
}

export function clearCalendarRangeTransition(node: HTMLElement): void {
  for (const cls of CALENDAR_RANGE_TRANSITION_CLASSES) {
    node.classList.remove(cls);
  }
}

/**
 * CSS-only fallback: animate the incoming surface when View Transitions are unavailable.
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
  const clear = () => {
    clearCalendarRangeTransition(node);
    node.removeEventListener("animationend", clear);
  };
  node.addEventListener("animationend", clear);
}

/**
 * Wait until `host` and nested Lit custom elements have committed, then one
 * frame so paint matches the new tree — needed before VT captures "new".
 */
export async function awaitCalendarRangePaint(host: LitElement): Promise<void> {
  await host.updateComplete;
  const root = host.renderRoot;
  if (!root) return;

  const collectUpdateCompletes = (): Promise<unknown>[] => {
    const pending: Promise<unknown>[] = [];
    root.querySelectorAll("*").forEach((node) => {
      const el = node as Partial<LitElement>;
      if (el.updateComplete) pending.push(el.updateComplete);
    });
    return pending;
  };

  // Two passes: first paint upgrades children; second waits for their shadow trees.
  for (let pass = 0; pass < 2; pass += 1) {
    const pending = collectUpdateCompletes();
    if (pending.length > 0) await Promise.all(pending);
    await host.updateComplete;
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Run a directional range change with the View Transitions API when available.
 * Uses document-scoped VT with a named `calendar-range` snapshot on the light-DOM
 * range wrapper (see calendar-workspace.css). Root chrome animation is disabled
 * in CSS. Falls back to an enter-class animation on `scope`.
 *
 * Resolves when the DOM update (and optional paint wait inside `update`) finishes,
 * not when the VT animation ends — so Lit's `scheduleUpdate` can continue.
 */
export function runCalendarRangeViewTransition(
  scope: HTMLElement | null,
  direction: CalendarRangeZoomDirection,
  update: () => void | PromiseLike<void>,
): Promise<void> {
  if (prefersReducedMotion()) {
    return Promise.resolve(update());
  }

  const start = getDocumentStartViewTransition();
  if (!start) {
    return Promise.resolve(update()).then(() => {
      restartCalendarRangeTransition(scope, direction);
    });
  }

  const types = [`calendar-range-zoom-${direction}`];
  document.documentElement.setAttribute(CALENDAR_RANGE_ZOOM_ATTR, direction);

  return new Promise<void>((resolve, reject) => {
    const wrappedUpdate = async () => {
      try {
        await update();
        resolve();
      } catch (error) {
        reject(error);
        throw error;
      }
    };

    let transition: { finished: Promise<void> };
    try {
      transition = start({ update: wrappedUpdate, types });
    } catch {
      transition = start(wrappedUpdate);
    }

    void transition.finished.finally(() => {
      if (document.documentElement.getAttribute(CALENDAR_RANGE_ZOOM_ATTR) === direction) {
        document.documentElement.removeAttribute(CALENDAR_RANGE_ZOOM_ATTR);
      }
    });
  });
}
