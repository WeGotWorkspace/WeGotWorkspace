import { useEffect, useMemo, useRef, useState } from "react";
import { calendarBootstrapWindow } from "@/lib/api/wgw/calendar";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { EventsAPIContextValue } from "@/lib/calendar-elements/context/EventsAPIContext";
import { JmapEventsAdapter, type JmapClient } from "@/lib/jmap-client";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { applyOwnRsvpToEngineEvents } from "@/calendar-core/src/calendar-event-model";
import {
  resolveCalendarSurfaceEvents,
  type CalendarSurfaceAdapterPhase,
} from "@/calendar-core/src/calendar-surface-events";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";
import type { CalendarAPIOperations, CalendarUIData } from "@/calendar-core/src/calendar-types";
import { createOfflineCalendarEventsApi } from "@/calendar-core/src/offline-calendar-events-api";

export type CalendarSurfaceStore = {
  /** Engine-model events for the lit views (adapter state, or cache fallback). */
  events: CalendarEventsMap;
  /** Mutation/store API for the views; undefined renders read-only. */
  contextValue: EventsAPIContextValue | undefined;
  /** Pulls remote changes into the adapter (post-dialog-write refresh). */
  syncNow: () => void;
  /**
   * Server-side JMAP id for an engine key: waits for the adapter's push chain
   * (flush) so just-drag-created events resolve to their real id.
   */
  resolveJmapId: (engineKey: string) => Promise<string | undefined>;
};

export type UseCalendarSurfaceOptions = {
  operations?: CalendarAPIOperations;
  /** Refresh Dexie/bootstrap after a drag (or other adapter write) persists. */
  onPersisted?: () => void;
};

/**
 * Owns the JmapEventsAdapter behind the lit calendar surface. Online (live or
 * MockJmapServer-backed mock) the adapter is the store: optimistic drag/create
 * mutations, incremental sync, polling. While offline the live adapter is torn
 * down and an EventsAPI context routes mutations through hybrid operations.
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
  const [offlineOverlay, setOfflineOverlay] = useState<CalendarEventsMap | null>(null);
  const adapterRef = useRef<JmapEventsAdapter>(undefined);
  const eventsRef = useRef<CalendarEventsMap>(new Map());
  const operations = options?.operations;
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

  useEffect(() => {
    setOfflineOverlay(null);
  }, [data.events]);

  const adapter = phase === "ready" ? adapterRef.current : undefined;

  const events = useMemo<CalendarEventsMap>(() => {
    // Adapter mutates in place; onChange only bumps revision so we re-read getEvents().
    void revision;
    if (offlineOverlay && (phase === "cache" || phase === "failed")) {
      return applyOwnRsvpToEngineEvents(offlineOverlay, [...data.events], sessionEmail);
    }
    return resolveCalendarSurfaceEvents({
      phase,
      adapterEvents: adapter?.getEvents(),
      cacheEvents: data.events,
      sessionEmail,
      calendars: data.calendars,
    });
  }, [adapter, revision, phase, offlineOverlay, data.calendars, data.events, sessionEmail]);

  eventsRef.current = events;

  const offlineContext = useMemo(() => {
    if (adapter || !operations) return undefined;
    return createOfflineCalendarEventsApi({
      getEvents: () => eventsRef.current,
      calendars: data.calendars,
      operations,
      onEventsChanged: setOfflineOverlay,
      onPersisted: () => onPersistedRef.current?.(),
    });
  }, [adapter, operations, data.calendars]);

  return {
    events,
    contextValue: adapter ?? offlineContext,
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
