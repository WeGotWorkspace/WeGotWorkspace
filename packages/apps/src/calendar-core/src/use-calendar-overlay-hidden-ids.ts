import { useCallback, useState } from "react";
import {
  persistHiddenOverlayTaskListIds,
  readHiddenOverlayTaskListIds,
} from "@/calendar-core/src/calendar-view-prefs";

/** Calendar-local hide set for task-list overlay rows. Default: all shown. */
export function useCalendarOverlayHiddenIds() {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set(readHiddenOverlayTaskListIds()),
  );

  const setHiddenOverlayTaskListIds = useCallback((next: ReadonlySet<string>) => {
    setHiddenIds(next);
    persistHiddenOverlayTaskListIds(next);
  }, []);

  const toggleOverlayTaskListVisibility = useCallback((listId: string) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      persistHiddenOverlayTaskListIds(next);
      return next;
    });
  }, []);

  return {
    hiddenOverlayTaskListIds: hiddenIds,
    setHiddenOverlayTaskListIds,
    toggleOverlayTaskListVisibility,
  };
}
