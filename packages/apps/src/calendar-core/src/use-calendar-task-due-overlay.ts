import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { loadTasksBootstrapHybrid } from "@/lib/offline/tasks/tasks-hybrid-operations";
import { readTasksBootstrapFromCache } from "@/lib/offline/tasks/tasks-offline-store";
import { readOfflineTasksUsername } from "@/lib/offline/core/offline-session";
import { useConnectivity } from "@/hooks/use-connectivity";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { subscribeTasksBootstrapUpdated } from "@/lib/offline/tasks/tasks-bootstrap-sync";
import { useTasksLiveInbound } from "@/lib/offline/tasks/use-tasks-live-inbound";
import type { Task, TaskList, TasksUIData } from "@/lib/models/tasks-types";
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
  /** Story/test fixture — skips Dexie/hybrid hydrate and the live sync. */
  preset?: TasksUIData | null;
  hiddenListIds: ReadonlySet<string>;
};

/**
 * Thin Calendar overlay reader over the shared Tasks cache. It paints the
 * cache, loads the Tasks bootstrap once only when there is no cache yet, and
 * otherwise keeps the cache current with the Tasks inbound sync: push-driven
 * `tasklists/changes`, in one tab per browser, the same seat the Tasks app
 * uses. Showing the tab again or reconnecting sends no full reload: the push
 * compares states and pulls only what changed (shared hosting traffic budget).
 */
export function useCalendarTaskDueOverlay({
  preset,
  hiddenListIds,
}: UseCalendarTaskDueOverlayArgs): CalendarTaskDueOverlayState {
  const [liveData, setLiveData] = useState<TasksUIData | null>(null);
  const [username, setUsername] = useState<string | null>(() =>
    preset != null ? null : readOfflineTasksUsername(),
  );
  const presetMode = preset != null;
  const { online } = useConnectivity();

  const rereadCache = useCallback(async () => {
    const cached = await readCachedTasksData().catch(() => null);
    if (cached) setLiveData(cached);
  }, []);

  useEffect(() => {
    if (presetMode) return;
    let cancelled = false;
    void (async () => {
      const cached = await readCachedTasksData().catch(() => null);
      if (cancelled) return;
      if (cached) {
        setLiveData(cached);
        return;
      }
      // No cache yet: one full load fills it; the live sync takes over from there.
      if (!readBrowserOnline()) return;
      try {
        const bootstrap = await loadTasksBootstrapHybrid();
        if (cancelled) return;
        setLiveData(bootstrap.data);
        setUsername(bootstrap.session.user.username || readOfflineTasksUsername());
      } catch {
        // Overlay stays empty; Calendar itself is unchanged.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [presetMode]);

  // The Tasks app or another Calendar tab pulled into the shared cache.
  useEffect(() => {
    if (presetMode || !username) return;
    return subscribeTasksBootstrapUpdated(username, () => {
      void rereadCache();
    });
  }, [presetMode, rereadCache, username]);

  useTasksLiveInbound({
    username: presetMode ? null : username,
    enabled: !presetMode && online && wgwLiveApiEnabled(),
    patchFromCache: rereadCache,
  });

  return useMemo(() => {
    const data = preset ?? liveData;
    if (!data) return emptyOverlayState();
    return overlayStateFromData(data, hiddenListIds);
  }, [hiddenListIds, liveData, preset]);
}
