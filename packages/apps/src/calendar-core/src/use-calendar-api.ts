import { createElement, useCallback, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
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
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarUIData } from "@/calendar-core/src/calendar-types";
import {
  createDefaultCalendarApiSource,
  type CalendarApiSource,
} from "@/calendar-core/src/calendar-api-source";

export type UseCalendarAPIOptions = {
  onSyncConflict?: (eventIds: string[]) => void;
};

export function useCalendarAPI(source?: CalendarApiSource, options?: UseCalendarAPIOptions) {
  const resolvedSource = useMemo(() => source ?? createDefaultCalendarApiSource(), [source]);
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

  const [listRefreshing, setListRefreshing] = useState(false);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const { show, showError } = useAppToast();

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

  const reconnectSyncing = useOfflineReconnectFlush({
    enabled: Boolean(offlineUsername),
    flush: async () => {
      if (!offlineUsername) return;
      await getCalendarsSyncRunner(offlineUsername).flush();
      const cached = await readCalendarBootstrapFromCache(offlineUsername);
      if (cached) {
        patchBootstrap(() => cached);
        setBootstrapRevision((revision) => revision + 1);
      }
    },
  });

  const refreshList = useCallback(() => {
    if (listRefreshing) return;
    setListRefreshing(true);
    void resolvedSource
      .loadBootstrap()
      .then((next) => {
        patchBootstrap(() => next);
        setBootstrapRevision((revision) => revision + 1);
        show(defaultCalendarLabels.toastListUpdated, {
          icon: createElement(Check, { className: "size-4" }),
        });
      })
      .catch(() => {
        showError(defaultCalendarLabels.toastListRefreshFailed);
      })
      .finally(() => {
        setListRefreshing(false);
      });
  }, [listRefreshing, patchBootstrap, resolvedSource, show, showError]);

  return {
    phase,
    error,
    retry: load,
    successVersion,
    bootstrapRevision,
    listLoading: phase === "loading" || reconnectSyncing,
    listRefreshing,
    refreshList,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
    offlineUsername,
  };
}
