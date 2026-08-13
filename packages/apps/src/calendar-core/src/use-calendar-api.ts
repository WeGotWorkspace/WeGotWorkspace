import { createElement, useCallback, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarUIData } from "@/calendar-core/src/calendar-types";
import {
  createDefaultCalendarApiSource,
  type CalendarApiSource,
} from "@/calendar-core/src/calendar-api-source";

/**
 * Bootstrap + operations wiring for the calendar app. Offline cache reads and
 * reconnect flush land with the offline domain (chunk C), mirroring
 * use-tasks-api.ts; until then the hybrid hook runs load-only.
 */
export function useCalendarAPI(source?: CalendarApiSource) {
  const resolvedSource = useMemo(() => source ?? createDefaultCalendarApiSource(), [source]);
  const placeholderData = useMemo<CalendarUIData>(() => ({ calendars: [], events: [] }), []);

  const runBootstrap = useCallback(() => resolvedSource.loadBootstrap(), [resolvedSource]);
  const readCache = useCallback(async () => null, []);

  const { phase, error, data, load, successVersion, patchBootstrap } = useHybridBootstrap({
    load: runBootstrap,
    readCache,
  });

  const [listRefreshing, setListRefreshing] = useState(false);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const { show, showError } = useAppToast();

  const operations = useMemo(
    () => resolvedSource.createOperations(data ?? undefined),
    [resolvedSource, data],
  );

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
    listRefreshing,
    refreshList,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
  };
}
