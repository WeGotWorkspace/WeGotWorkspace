import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  createHybridCalendarOperations,
  getCalendarsSyncRunner,
} from "@/lib/offline/calendars-hybrid-operations";
import { readCalendarBootstrapFromCache } from "@/lib/offline/calendars-offline-store";
import { setCalendarsSyncConflictListener } from "@/lib/offline/calendars-sync-conflicts";
import {
  readOfflineCalendarsUsername,
  resolveCalendarsOfflineUsername,
} from "@/lib/offline/offline-session";
import { useOfflineConflictQueue } from "@/lib/offline/use-offline-conflict-queue";
import { useOfflineReconnectFlush } from "@/lib/offline/use-offline-reconnect-flush";
import type { CalendarUIData } from "@/calendar-core/src/calendar-types";
import {
  createDefaultCalendarApiSource,
  type CalendarApiSource,
} from "@/calendar-core/src/calendar-api-source";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";

export type UseCalendarAPIOptions = {
  onSyncConflict?: (eventIds: string[]) => void;
};

export function useCalendarAPI(source?: CalendarApiSource, options?: UseCalendarAPIOptions) {
  const { online } = useConnectivity();
  const resolvedSource = useMemo(() => source ?? createDefaultCalendarApiSource(), [source]);
  const jmapClient = useMemo(() => resolvedSource.createJmapClient?.(), [resolvedSource]);
  const placeholderData = useMemo<CalendarUIData>(() => ({ calendars: [], events: [] }), []);

  const runBootstrap = useCallback(() => resolvedSource.loadBootstrap(), [resolvedSource]);
  const readCache = useCallback(async () => {
    const username = readOfflineCalendarsUsername();
    if (!username) return null;
    return readCalendarBootstrapFromCache(username);
  }, []);

  const { phase, error, data, load, successVersion, patchBootstrap } = useHybridBootstrap({
    load: runBootstrap,
    readCache,
  });

  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const refreshInFlightRef = useRef(false);

  const operations = useMemo(() => {
    const fromSource = resolvedSource.createOperations(data ?? undefined);
    if (fromSource) return fromSource;
    const username = resolveCalendarsOfflineUsername(data?.session.user.username);
    if (!username) return undefined;
    return createHybridCalendarOperations(username);
  }, [resolvedSource, data]);

  const offlineUsername = useMemo(
    () => resolveCalendarsOfflineUsername(data?.session.user.username),
    [data?.session.user.username],
  );

  useOfflineConflictQueue({
    setListener: setCalendarsSyncConflictListener,
    onConflicts: options?.onSyncConflict,
  });

  const applyBootstrapRefresh = useCallback(async () => {
    if (offlineUsername) {
      await getCalendarsSyncRunner(offlineUsername).flush();
    }
    const next = await resolvedSource.loadBootstrap();
    patchBootstrap(() => next);
    setBootstrapRevision((revision) => revision + 1);
    return next;
  }, [offlineUsername, patchBootstrap, resolvedSource]);

  const reconnectSyncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getCalendarsSyncRunner(offlineUsername).flush();
      const next = await resolvedSource.loadBootstrap().catch(() => null);
      if (next) {
        patchBootstrap(() => next);
        setBootstrapRevision((revision) => revision + 1);
        return;
      }
      const cached = await readCalendarBootstrapFromCache(offlineUsername);
      if (cached) {
        patchBootstrap(() => cached);
        setBootstrapRevision((revision) => revision + 1);
      }
    },
  });

  useEffect(() => {
    if (!offlineUsername || !online || phase !== "ready") return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const runSilentRefresh = () => {
      if (cancelled || reconnectSyncing || refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      void applyBootstrapRefresh()
        .catch(() => undefined)
        .finally(() => {
          refreshInFlightRef.current = false;
        });
    };

    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      runSilentRefresh();
    }, CALENDAR_BACKGROUND_POLL_MS);

    const onVisibilityChange = () => {
      if (!document.hidden) runSilentRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [applyBootstrapRefresh, offlineUsername, online, phase, reconnectSyncing]);

  return {
    phase,
    error,
    retry: load,
    successVersion,
    bootstrapRevision,
    listLoading: phase === "loading" || reconnectSyncing,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
    offlineUsername,
    jmapClient,
    refreshBootstrap: applyBootstrapRefresh,
  };
}
