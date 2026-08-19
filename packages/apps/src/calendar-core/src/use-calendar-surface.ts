import { useEffect, useMemo, useRef, useState } from "react";
import { calendarBootstrapWindow } from "@/lib/api/wgw/calendar";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { JmapEventsAdapter, type JmapClient } from "@/lib/jmap-client";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  applyOwnRsvpToEngineEvents,
  calendarEventsToEngineMap,
} from "@/calendar-core/src/calendar-event-model";
import type { CalendarUIData } from "@/calendar-core/src/calendar-types";

const SYNC_POLL_MS = 30_000;

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
): CalendarSurfaceStore {
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const adapterRef = useRef<JmapEventsAdapter>(undefined);

  useEffect(() => {
    if (!client || !readBrowserOnline()) {
      adapterRef.current = undefined;
      setReady(false);
      return;
    }
    const adapter = new JmapEventsAdapter({
      client,
      onChange: () => setRevision((current) => current + 1),
      onSyncError: () => {
        // Transient (e.g. connectivity loss mid-poll); the reconnect flush and
        // the next poll recover. The surface keeps rendering last-known state.
      },
    });
    adapterRef.current = adapter;
    let cancelled = false;
    void adapter
      .initialize(calendarBootstrapWindow())
      .then(() => {
        if (cancelled) return;
        adapter.startPolling(SYNC_POLL_MS);
        setReady(true);
        setRevision((current) => current + 1);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
      adapter.stopPolling();
      if (adapterRef.current === adapter) {
        adapterRef.current = undefined;
      }
    };
  }, [client]);

  const adapter = ready ? adapterRef.current : undefined;

  const events = useMemo<CalendarEventsMap>(() => {
    void revision;
    const raw = adapter ? new Map(adapter.getEvents()) : calendarEventsToEngineMap(data.events);
    return applyOwnRsvpToEngineEvents(raw, data.events, sessionEmail);
  }, [adapter, revision, data.events, sessionEmail]);

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
