import { type CalendarAccounts, type CalendarsMap } from "@/lib/calendar-engine";
import { type DateRange, JmapCalendarsClient } from "../calendars/JmapCalendarsClient.js";
import type { JmapCalendar, JmapCalendarEvent } from "../calendars/types.js";
import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import type { JmapId } from "../core/types.js";
import { jmapCalendarToInternal } from "../mapping/calendar.js";

const CALENDAR_TYPE = "Calendar";
const CALENDAR_EVENT_TYPE = "CalendarEvent";

export type JmapEventsAdapterOptions = {
  client: JmapClient;
  /** Defaults to the session's primary calendars account. */
  accountId?: JmapId;
  /** Called after calendar list changes from initialize/sync. */
  onChange?: () => void;
  /** Called when inbound sync fails. */
  onSyncError?: (error: unknown) => void;
  /** Inbound `/changes` ingest: write Dexie, skip pending outbox rows. */
  onRemoteEvent?: (event: JmapCalendarEvent) => void;
  onRemoteEventDestroyed?: (eventId: JmapId) => void;
  onRemoteCalendar?: (calendar: JmapCalendar) => void;
  onRemoteCalendarDestroyed?: (calendarId: JmapId) => void;
};

/**
 * Inbound-only JMAP adapter: calendar list, windowed state priming, and
 * `/changes` polling. Mutations and grid paint live on the Dexie-first
 * EventsAPI working set — this class does not apply optimistic writes or
 * expose an event map for rendering.
 */
export class JmapEventsAdapter {
  #calendars: JmapCalendarsClient;
  #options: JmapEventsAdapterOptions;
  #accountId: JmapId | null = null;

  #calendarsMap: CalendarsMap = new Map();

  #visibleCalendarIds: string[] | undefined;
  #selectedCalendarId: string | undefined;

  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #pollInFlight = false;
  #lastRange: DateRange | undefined;

  constructor(options: JmapEventsAdapterOptions) {
    this.#options = options;
    this.#calendars = new JmapCalendarsClient(options.client);
  }

  get accountId(): JmapId {
    if (this.#accountId) return this.#accountId;
    this.#accountId = this.#options.accountId ?? this.#options.client.primaryAccountId();
    return this.#accountId;
  }

  // ---- lifecycle ----

  /** Connects (if needed), loads calendars, and primes `/changes` for the window. */
  async initialize(range?: DateRange): Promise<void> {
    if (!this.#options.client.isConnected) await this.#options.client.connect();
    await this.refreshCalendars();
    if (range) await this.loadRange(range);
  }

  async refreshCalendars(): Promise<void> {
    const response = await this.#calendars.getCalendars(this.accountId);
    const map: CalendarsMap = new Map();
    for (const calendar of response.list) {
      map.set(calendar.id, jmapCalendarToInternal(calendar, { accountId: this.accountId }));
    }
    this.#calendarsMap = map;
    this.#notify();
  }

  /**
   * Windowed fetch for the visible date range. Primes CalendarEvent `/changes`
   * state and forwards each object to `onRemoteEvent` — it does not keep a
   * paint cache.
   */
  async loadRange(range: DateRange): Promise<void> {
    this.#lastRange = range;
    const response = await this.#calendars.getCalendarEventsInRange(this.accountId, range);
    for (const jmapEvent of response.list) {
      this.#options.onRemoteEvent?.(jmapEvent);
    }
    this.#notify();
  }

  /** Pulls remote changes since the last known states and forwards them inbound. */
  async sync(): Promise<void> {
    const client = this.#options.client;
    try {
      const calendarState = client.getState(this.accountId, CALENDAR_TYPE);
      if (calendarState) {
        const changes = await this.#calendars.calendarChanges(this.accountId, calendarState);
        const changedIds = [...changes.created, ...changes.updated];
        if (changedIds.length) {
          const fetched = await this.#calendars.getCalendars(this.accountId, changedIds);
          for (const calendar of fetched.list) {
            this.#calendarsMap.set(
              calendar.id,
              jmapCalendarToInternal(calendar, { accountId: this.accountId }),
            );
            this.#options.onRemoteCalendar?.(calendar);
          }
        }
        for (const id of changes.destroyed) {
          this.#calendarsMap.delete(id);
          this.#options.onRemoteCalendarDestroyed?.(id);
        }
      }

      const eventState = client.getState(this.accountId, CALENDAR_EVENT_TYPE);
      if (eventState) {
        const changes = await this.#calendars.calendarEventChanges(this.accountId, eventState);
        const changedIds = [...changes.created, ...changes.updated];
        if (changedIds.length) {
          const fetched = await this.#calendars.getCalendarEvents(this.accountId, changedIds);
          for (const jmapEvent of fetched.list) {
            this.#options.onRemoteEvent?.(jmapEvent);
          }
        }
        for (const id of changes.destroyed) {
          this.#options.onRemoteEventDestroyed?.(id);
        }
      }
      this.#notify();
    } catch (error) {
      if (error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges") {
        await this.#refetchAll();
        return;
      }
      this.#options.onSyncError?.(error);
    }
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.#pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (this.#pollInFlight) return;
      this.#pollInFlight = true;
      void this.sync().finally(() => {
        this.#pollInFlight = false;
      });
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  // ---- calendar list (inbound bookkeeping; not the grid paint source) ----

  getCalendars(): CalendarsMap {
    return this.#calendarsMap;
  }

  getCalendarAccounts(): CalendarAccounts {
    const accounts = new Set<string>();
    for (const calendar of this.#calendarsMap.values()) accounts.add(calendar.accountId);
    return accounts;
  }

  getVisibleCalendarIds(): string[] | undefined {
    if (this.#visibleCalendarIds) return this.#visibleCalendarIds;
    const hidden = [...this.#calendarsMap.values()].some((c) => c.isVisible === false);
    if (!hidden) return undefined;
    return [...this.#calendarsMap.entries()]
      .filter(([, calendar]) => calendar.isVisible !== false)
      .map(([id]) => id);
  }

  setVisibleCalendarIds(ids: string[] | undefined): void {
    this.#visibleCalendarIds = ids;
    this.#notify();
  }

  getSelectedCalendarId(): string | undefined {
    if (this.#selectedCalendarId) return this.#selectedCalendarId;
    for (const [id, calendar] of this.#calendarsMap) {
      if (calendar.isDefault) return id;
    }
    return this.#calendarsMap.keys().next().value;
  }

  setSelectedCalendarId(id: string | undefined): void {
    this.#selectedCalendarId = id;
    this.#notify();
  }

  // ---- internals ----

  #notify(): void {
    this.#options.onChange?.();
  }

  async #refetchAll(): Promise<void> {
    await this.refreshCalendars();
    if (this.#lastRange) await this.loadRange(this.#lastRange);
  }
}
