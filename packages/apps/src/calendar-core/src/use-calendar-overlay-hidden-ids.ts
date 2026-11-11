import { useCallback, useEffect, useRef, useState } from "react";
import { calendarViewPrefs } from "@/calendar-core/src/calendar-view-prefs";

/** Calendar-local hide set for task-list overlay rows. Default: all shown. */
export function useCalendarOverlayHiddenIds() {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set(calendarViewPrefs.read()?.hiddenOverlayTaskListIds),
  );
  const skipHydrationPersist = useRef(true);

  useEffect(() => {
    if (skipHydrationPersist.current) {
      skipHydrationPersist.current = false;
      return;
    }
    // Calendar-local overlay hide. Does not write Tasks `hiddenTaskListIds`.
    calendarViewPrefs.patch({ hiddenOverlayTaskListIds: [...hiddenIds] });
  }, [hiddenIds]);

  const setHiddenOverlayTaskListIds = useCallback((next: ReadonlySet<string>) => {
    setHiddenIds(next);
  }, []);

  const toggleOverlayTaskListVisibility = useCallback((listId: string) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  }, []);

  return {
    hiddenOverlayTaskListIds: hiddenIds,
    setHiddenOverlayTaskListIds,
    toggleOverlayTaskListVisibility,
  };
}
