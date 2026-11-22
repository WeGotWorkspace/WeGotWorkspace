import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useJmapPushConnected } from "@/lib/api/wgw/use-jmap-state-change";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  createHybridCalendarOperations,
  getCalendarsSyncRunner,
} from "@/lib/offline/calendars/calendars-hybrid-operations";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { readCalendarBootstrapFromCache } from "@/lib/offline/calendars/calendars-offline-store";
import { setCalendarsSyncConflictListener } from "@/lib/offline/calendars/calendars-sync-conflicts";
import {
  readOfflineCalendarsUsername,
  resolveCalendarsOfflineUsername,
} from "@/lib/offline/core/offline-session";
import { useOfflineConflictQueue } from "@/lib/offline/core/use-offline-conflict-queue";
import { useOfflineReconnectFlush } from "@/hooks/use-offline-reconnect-flush";
import type { CalendarUIData } from "@/lib/models/calendar-types";
import type { CalendarUtcRange } from "@/lib/calendar-load-window";
import {
  createDefaultCalendarApiSource,
  type CalendarApiSource,
} from "@/calendar-core/src/calendar-api-source";

export type UseCalendarAPIOptions = {
  onSyncConflict?: (eventIds: string[]) => void;
  /**
   * This screen runs calendar live inbound sync, which keeps the cache current
   * while push is connected. Only then does a tab that becomes visible re-read
   * the cache instead of running a bootstrap (#2287). Default: bootstrap.
   */
  liveInbound?: boolean;
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

  const loadEventsInRange = useMemo(() => {
    const load = resolvedSource.loadEventsInRange;
    if (!load || !offlineUsername) return undefined;
    return (range: CalendarUtcRange) => load(offlineUsername, range);
  }, [resolvedSource, offlineUsername]);

  useOfflineConflictQueue({
    setListener: setCalendarsSyncConflictListener,
    onConflicts: options?.onSyncConflict,
  });

  const pushConnected = useJmapPushConnected();
  const liveInbound = options?.liveInbound ?? false;

  const applyBootstrapRefresh = useCallback(async () => {
    if (offlineUsername && readBrowserOnline()) {
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

    const onVisibilityChange = () => {
      if (document.hidden || reconnectSyncing || refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      // Push connected and this screen's live inbound sync writes the cache: re-read
      // it instead of a full bootstrap (#2287). Pending outbox rows flush on
      // reconnect or the runner's own triggers, not here. Inbound `/changes` cannot
      // see ICS feeds the server has not fetched, so stale subscriptions still
      // refresh, and a refreshed one reloads the bootstrap.
      const refresh =
        pushConnected && liveInbound
          ? readCalendarBootstrapFromCache(offlineUsername).then(async (cached) => {
              if (!cached) return applyBootstrapRefresh();
              patchBootstrap(() => cached);
              setBootstrapRevision((revision) => revision + 1);
              const refreshed = await operations
                ?.refreshStaleCalendarSubscriptions?.()
                .catch(() => false);
              return refreshed ? applyBootstrapRefresh() : cached;
            })
          : applyBootstrapRefresh();
      void refresh
        .catch(() => undefined)
        .finally(() => {
          refreshInFlightRef.current = false;
        });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    applyBootstrapRefresh,
    offlineUsername,
    liveInbound,
    online,
    operations,
    patchBootstrap,
    phase,
    pushConnected,
    reconnectSyncing,
  ]);

  return {
    phase,
    error,
    retry: load,
    successVersion,
    bootstrapRevision,
    // First paint only. A reconnect keeps the cached calendar on screen (#1532).
    listLoading: phase === "loading",
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
    offlineUsername,
    jmapClient,
    loadEventsInRange,
    refreshBootstrap: applyBootstrapRefresh,
    reloadFromCache: async () => {
      if (!offlineUsername) return;
      const cached = await readCalendarBootstrapFromCache(offlineUsername);
      if (cached) {
        patchBootstrap(() => cached);
        setBootstrapRevision((revision) => revision + 1);
      }
    },
  };
}
