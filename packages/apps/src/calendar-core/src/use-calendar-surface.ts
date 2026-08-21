import { useEffect, useMemo, useRef, useState } from "react";
import { calendarBootstrapWindow } from "@/lib/api/wgw/calendar";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { JmapEventsAdapter, type JmapClient } from "@/lib/jmap-client";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  resolveCalendarSurfaceEvents,
  type CalendarSurfaceAdapterPhase,
} from "@/calendar-core/src/calendar-surface-events";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";
import type { CalendarUIData } from "@/calendar-core/src/calendar-types";

export type CalendarSurfaceStore = {
  /** Engine-model events for the lit views (adapter state, or cache fallback). */
  events: CalendarEventsMap;
  /** Mutation/store API for the views; undefined renders read-only (offline). */
  contextValue: JmapEventsAdapter | undefined;
  /** Pulls remote changes into the adapter (post-dialog-write refresh). */
  syncNow: () => void;
  /**
   * Server-side JMAP id for an engine key: waits for the adapter's push chain
   * (flush) so just-drag-created events resolve to their real id.
   */
  resolveJmapId: (engineKey: string) => Promise<string | undefined>;
};

export type UseCalendarSurfaceOptions = {
  /** Refresh Dexie/bootstrap after a drag (or other adapter write) persists. */
  onPersisted?: () => void;
};

/**
 * Owns the JmapEventsAdapter behind the lit calendar surface. Online (live or
 * MockJmapServer-backed mock) the adapter is the store: optimistic drag/create
 * mutations, incremental sync, polling. Without a client — or while offline —
 * the surface renders read-only from the cached wire events.
 */
export function useCalendarSurface(
  client: JmapClient | undefined,
  data: CalendarUIData,
  sessionEmail?: string,
  options?: UseCalendarSurfaceOptions,
): CalendarSurfaceStore {
  const [revision, setRevision] = useState(0);
  const [phase, setPhase] = useState<CalendarSurfaceAdapterPhase>(() =>
    client && readBrowserOnline() ? "loading" : "cache",
  );
  const adapterRef = useRef<JmapEventsAdapter>(undefined);
  const onPersistedRef = useRef(options?.onPersisted);
  onPersistedRef.current = options?.onPersisted;

  useEffect(() => {
    if (!client || !readBrowserOnline()) {
      adapterRef.current = undefined;
      setPhase("cache");
      return;
    }
    const adapter = new JmapEventsAdapter({
      client,
      onChange: () => setRevision((current) => current + 1),
      onPersisted: () => onPersistedRef.current?.(),
      onSyncError: () => {
        // Transient (e.g. connectivity loss mid-poll); the reconnect flush and
        // the next poll recover. The surface keeps rendering last-known state.
      },
    });
    adapterRef.current = adapter;
    let cancelled = false;
    setPhase("loading");
    void adapter
      .initialize(calendarBootstrapWindow())
      .then(() => {
        if (cancelled) return;
        adapter.startPolling(CALENDAR_BACKGROUND_POLL_MS);
        setPhase("ready");
        setRevision((current) => current + 1);
      })
      .catch(() => {
        if (!cancelled) setPhase("failed");
      });
    return () => {
      cancelled = true;
      adapter.stopPolling();
      if (adapterRef.current === adapter) {
        adapterRef.current = undefined;
      }
    };
  }, [client]);

  const adapter = phase === "ready" ? adapterRef.current : undefined;

  const events = useMemo<CalendarEventsMap>(() => {
    // Adapter mutates in place; onChange only bumps revision so we re-read getEvents().
    void revision;
    return resolveCalendarSurfaceEvents({
      phase,
      adapterEvents: adapter?.getEvents(),
      cacheEvents: data.events,
      sessionEmail,
    });
  }, [adapter, revision, phase, data.events, sessionEmail]);

  return {
    events,
    contextValue: adapter,
    syncNow: () => {
      void adapterRef.current?.sync().catch(() => {});
    },
    resolveJmapId: async (engineKey: string) => {
      const current = adapterRef.current;
      if (!current) return engineKey;
      const immediate = current.jmapIdForKey(engineKey);
      if (immediate) return immediate;
      await current.flush().catch(() => {});
      return current.jmapIdForKey(engineKey);
    },
  };
}
