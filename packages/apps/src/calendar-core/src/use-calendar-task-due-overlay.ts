import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { loadTasksBootstrapHybrid } from "@/lib/offline/tasks-hybrid-operations";
import { readTasksBootstrapFromCache } from "@/lib/offline/tasks-offline-store";
import { readOfflineTasksUsername } from "@/lib/offline/offline-session";
import { useOfflineReconnectFlush } from "@/lib/offline/use-offline-reconnect-flush";
import type { Task, TaskList, TasksUIData } from "@/tasks-core/src/tasks-types";
import {
  buildTaskDueOverlayModel,
  type TaskDueOverlayMarker,
} from "@/calendar-core/src/calendar-task-due-overlay";

export type CalendarTaskDueOverlayState = {
  taskLists: TaskList[];
  tasks: Task[];
  overlayEvents: CalendarEventsMap;
  markers: TaskDueOverlayMarker[];
};

function emptyOverlayState(): CalendarTaskDueOverlayState {
  return {
    taskLists: [],
    tasks: [],
    overlayEvents: new Map(),
    markers: [],
  };
}

function overlayStateFromData(
  data: TasksUIData,
  hiddenListIds: ReadonlySet<string>,
): CalendarTaskDueOverlayState {
  const model = buildTaskDueOverlayModel(data.tasks, data.taskLists, { hiddenListIds });
  return {
    taskLists: data.taskLists,
    tasks: data.tasks,
    overlayEvents: model.events,
    markers: model.markers,
  };
}

async function readCachedTasksData(): Promise<TasksUIData | null> {
  const username = readOfflineTasksUsername();
  if (!username) return null;
  const cached = await readTasksBootstrapFromCache(username);
  return cached?.data ?? null;
}

export type UseCalendarTaskDueOverlayArgs = {
  /** Story/test fixture — skips Dexie/hybrid hydrate and reconnect refresh. */
  preset?: TasksUIData | null;
  hiddenListIds: ReadonlySet<string>;
};

/**
 * Thin Calendar overlay reader. Hydrates Tasks Dexie first (same cache-then-network
 * as Tasks `useHybridBootstrap`), then live hybrid. Reconnect / visibilitychange
 * re-run **tasks** bootstrap only — never Calendar JMAP.
 */
export function useCalendarTaskDueOverlay({
  preset,
  hiddenListIds,
}: UseCalendarTaskDueOverlayArgs): CalendarTaskDueOverlayState {
  const [liveData, setLiveData] = useState<TasksUIData | null>(null);
  const refreshInFlightRef = useRef(false);
  const presetMode = preset != null;

  const applyData = useCallback((data: TasksUIData | null) => {
    setLiveData(data);
  }, []);

  const refreshFromHybrid = useCallback(async () => {
    if (presetMode) return;
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const bootstrap = await loadTasksBootstrapHybrid();
      applyData(bootstrap.data);
    } catch {
      try {
        const cached = await readCachedTasksData();
        if (cached) applyData(cached);
      } catch {
        // Overlay stays on whatever already painted; Calendar itself is unchanged.
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [applyData, presetMode]);

  useEffect(() => {
    if (presetMode) return;
    let cancelled = false;
    void (async () => {
      let paintedFromCache = false;
      try {
        const cached = await readCachedTasksData();
        if (cancelled) return;
        if (cached) {
          applyData(cached);
          paintedFromCache = true;
        }
      } catch {
        // Cache miss is fine; live hydrate still runs.
      }
      if (cancelled) return;
      if (paintedFromCache && !readBrowserOnline()) return;
      try {
        const bootstrap = await loadTasksBootstrapHybrid();
        if (!cancelled) applyData(bootstrap.data);
      } catch {
        if (cancelled) return;
        try {
          const cached = await readCachedTasksData();
          if (cached) applyData(cached);
        } catch {
          // Keep cache paint if any; otherwise overlay stays empty.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyData, presetMode]);

  useEffect(() => {
    if (presetMode) return;
    if (typeof document === "undefined") return;

    const onVisibilityChange = () => {
      if (document.hidden) return;
      void refreshFromHybrid();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [presetMode, refreshFromHybrid]);

  useOfflineReconnectFlush({
    enabled: !presetMode,
    flush: refreshFromHybrid,
  });

  return useMemo(() => {
    const data = preset ?? liveData;
    if (!data) return emptyOverlayState();
    return overlayStateFromData(data, hiddenListIds);
  }, [hiddenListIds, liveData, preset]);
}
