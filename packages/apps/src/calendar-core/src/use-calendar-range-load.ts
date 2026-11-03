import { useEffect, useMemo, useRef } from "react";
import {
  calendarBootstrapWindow,
  isUtcRangeInside,
  plainDateToUtc,
  type CalendarUtcRange,
} from "@/lib/calendar-load-window";
import { viewDateRange } from "@/calendar-core/src/calendar-event-model";
import type { CalendarViewId } from "@/calendar-core/src/calendar-types";

/** Covers any week start and any time zone offset around a rendered period. */
const VIEW_RANGE_PADDING_DAYS = 7;

/** The range to load for a view anchored at `anchorISO`, padded by a week each side. */
export function calendarViewLoadRange(view: CalendarViewId, anchorISO: string): CalendarUtcRange {
  const { start, end } = viewDateRange(view, anchorISO);
  return {
    utcStart: plainDateToUtc(start.subtract({ days: VIEW_RANGE_PADDING_DAYS })),
    utcEnd: plainDateToUtc(end.add({ days: VIEW_RANGE_PADDING_DAYS })),
  };
}

export type UseCalendarRangeLoadOptions = {
  view: CalendarViewId;
  /** ISO date the view is anchored at. */
  anchor: string;
  /** Loads one period into the cache and says whether it did; undefined loads nothing. */
  loadRange?: (range: CalendarUtcRange) => Promise<boolean>;
  /** False until the first bootstrap is in, and while offline. */
  enabled: boolean;
  /** Re-read the cache after a period loaded. */
  onLoaded: () => void;
};

function safeViewLoadRange(view: CalendarViewId, anchor: string): CalendarUtcRange | null {
  try {
    return calendarViewLoadRange(view, anchor);
  } catch {
    return null;
  }
}

/**
 * The bootstrap holds a window around today. When the view shows a period
 * outside it, load that period once per session and re-read the cache (#1675).
 * A failed or offline load is retried on the next chance; the cache is kept.
 */
export function useCalendarRangeLoad({
  view,
  anchor,
  loadRange,
  enabled,
  onLoaded,
}: UseCalendarRangeLoadOptions): void {
  const loadedRef = useRef<CalendarUtcRange[]>([]);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const range = useMemo(() => safeViewLoadRange(view, anchor), [view, anchor]);

  useEffect(() => {
    loadedRef.current = [];
  }, [loadRange]);

  useEffect(() => {
    if (!enabled || !loadRange || !range) return;
    if (isUtcRangeInside(range, calendarBootstrapWindow())) return;
    if (loadedRef.current.some((loaded) => isUtcRangeInside(range, loaded))) return;
    loadedRef.current = [...loadedRef.current, range];
    const forget = () => {
      loadedRef.current = loadedRef.current.filter((loaded) => loaded !== range);
    };
    void loadRange(range)
      .then((loaded) => {
        if (loaded) {
          onLoadedRef.current();
        } else {
          forget();
        }
      })
      .catch(forget);
  }, [enabled, loadRange, range]);
}
