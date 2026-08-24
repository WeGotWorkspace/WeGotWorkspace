import { useEffect, useMemo, useRef, useState } from "react";
import { calendarBootstrapWindow } from "@/lib/api/wgw/calendar";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { EventsAPIContextValue } from "@/lib/calendar-elements/context/EventsAPIContext";
import { JmapEventsAdapter, type JmapClient } from "@/lib/jmap-client";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import { resolveCalendarSurfaceEvents } from "@/calendar-core/src/calendar-surface-events";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";
import type { CalendarAPIOperations, CalendarUIData } from "@/calendar-core/src/calendar-types";
import {
  createCalendarEventsApi,
  persistEventId,
  type CalendarEventsApi,
} from "@/calendar-core/src/calendar-events-api";
import {
  ingestRemoteCalendarEvent,
  ingestRemoteCalendarEventDestroyed,
} from "@/lib/offline/calendars-jmap-inbound";

export type CalendarSurfaceStore = {
  /** Engine-model events for the lit views (working set + Dexie). */
  events: CalendarEventsMap;
  /** Mutation/store API for the views; undefined renders read-only. */
  contextValue: EventsAPIContextValue | undefined;
  /** Pulls remote changes (inbound adapter / later Dexie ingest). */
  syncNow: () => void;
  /** Persist id for an engine key (working-set / Dexie map key). */
  resolveJmapId: (engineKey: string) => Promise<string | undefined>;
};

export type UseCalendarSurfaceOptions = {
  operations?: CalendarAPIOperations;
  /** Offline username for inbound JMAP → Dexie ingest. */
  username?: string | null;
  /** Refresh Dexie/bootstrap after a drag (or other working-set write) persists. */
  onPersisted?: () => void;
  /** Re-read Dexie after inbound ingest (no second bootstrap poll). */
  onInboundChange?: () => void;
};

/**
 * One EventsAPI working set online and offline. The JMAP adapter is inbound-only
 * wiring (poll / sync); it is never `contextValue` and never the paint source.
 */
export function useCalendarSurface(
  client: JmapClient | undefined,
  data: CalendarUIData,
  sessionEmail?: string,
  options?: UseCalendarSurfaceOptions,
): CalendarSurfaceStore {
  const [workingRevision, setWorkingRevision] = useState(0);
  const workingSetRef = useRef<CalendarEventsMap>(new Map());
  const eventsApiRef = useRef<CalendarEventsApi>(undefined);
  const adapterRef = useRef<JmapEventsAdapter>(undefined);
  const operations = options?.operations;
  const usernameRef = useRef(options?.username);
  usernameRef.current = options?.username;
  const onPersistedRef = useRef(options?.onPersisted);
  onPersistedRef.current = options?.onPersisted;
  const onInboundChangeRef = useRef(options?.onInboundChange);
  onInboundChangeRef.current = options?.onInboundChange;

  useEffect(() => {
    if (!client) {
      adapterRef.current = undefined;
      return;
    }
    const adapter = new JmapEventsAdapter({
      client,
      onSyncError: () => {
        // Transient; the next poll recovers.
      },
      onRemoteEvent: (event) => {
        const username = usernameRef.current;
        if (!username) return;
        void ingestRemoteCalendarEvent(username, event).then(() => {
          onInboundChangeRef.current?.();
        });
      },
      onRemoteEventDestroyed: (eventId) => {
        const username = usernameRef.current;
        if (!username) return;
        void ingestRemoteCalendarEventDestroyed(username, eventId).then(() => {
          onInboundChangeRef.current?.();
        });
      },
    });
    adapterRef.current = adapter;
    let cancelled = false;
    void adapter
      .initialize(calendarBootstrapWindow())
      .then(() => {
        if (cancelled) return;
        adapter.startPolling(CALENDAR_BACKGROUND_POLL_MS);
      })
      .catch(() => {
        // Offline or first-paint: Dexie/working set still render.
      });
    return () => {
      cancelled = true;
      adapter.stopPolling();
      if (adapterRef.current === adapter) {
        adapterRef.current = undefined;
      }
    };
  }, [client]);

  const cacheMap = useMemo(
    () => calendarEventsToEngineMap([...data.events], { calendars: data.calendars }),
    [data.calendars, data.events],
  );

  const events = useMemo<CalendarEventsMap>(() => {
    void workingRevision;
    return resolveCalendarSurfaceEvents({
      workingSet: workingSetRef.current.size > 0 ? workingSetRef.current : undefined,
      cacheEvents: data.events,
      calendars: data.calendars,
      sessionEmail,
    });
  }, [workingRevision, data.calendars, data.events, sessionEmail]);

  useEffect(() => {
    eventsApiRef.current?.replaceEvents(cacheMap);
    setWorkingRevision((current) => current + 1);
  }, [cacheMap]);

  const calendarIdsKey = data.calendars.map((calendar) => calendar.id).join("\0");
  const contextValue = useMemo(() => {
    if (!operations) {
      eventsApiRef.current = undefined;
      return undefined;
    }
    const api = createCalendarEventsApi({
      getEvents: () => (workingSetRef.current.size > 0 ? workingSetRef.current : cacheMap),
      calendars: data.calendars,
      operations,
      onEventsChanged: (next) => {
        workingSetRef.current = next;
        setWorkingRevision((current) => current + 1);
      },
      onPersisted: () => onPersistedRef.current?.(),
    });
    eventsApiRef.current = api;
    return api;
    // Recreate only when calendar ids change — a new calendars array on
    // bootstrap patch must not reset the working set (that blanks reconnect).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- calendarIdsKey
  }, [operations, calendarIdsKey]);

  return {
    events,
    contextValue,
    syncNow: () => {
      void adapterRef.current?.sync().catch(() => {});
    },
    resolveJmapId: async (engineKey: string) => persistEventId(engineKey),
  };
}
