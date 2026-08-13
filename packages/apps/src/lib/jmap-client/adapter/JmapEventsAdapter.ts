import {
  type AddExceptionInput,
  type AddExclusionInput,
  type ApplyResult,
  type CalendarAccounts,
  type CalendarEventsMap,
  type CalendarsMap,
  type CreateInput,
  type EventChange,
  type EventOperation,
  EventsAPI,
  type EventsState,
  type MoveInput,
  type RemoveExceptionInput,
  type RemoveExclusionInput,
  type RemoveInput,
  type ResizeEndInput,
  type ResizeStartInput,
  type UpdateInput,
} from "@/lib/calendar-engine";
import { type DateRange, JmapCalendarsClient } from "../calendars/JmapCalendarsClient.js";
import type { JmapCalendarEvent } from "../calendars/types.js";
import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import type { JmapId } from "../core/types.js";
import { jmapCalendarToInternal } from "../mapping/calendar.js";
import {
  collectInternalGroup,
  internalGroupToJmapEvent,
  jmapEventToInternalRows,
} from "../mapping/event.js";

const CALENDAR_TYPE = "Calendar";
const CALENDAR_EVENT_TYPE = "CalendarEvent";

export type JmapEventsAdapterOptions = {
  client: JmapClient;
  /** Defaults to the session's primary calendars account. */
  accountId?: JmapId;
  /** IANA timezone used for local recurrence expansion. */
  timezone?: string;
  /** Called after any local or remote state change; hosts re-read events/calendars. */
  onChange?: () => void;
  /** Called when a background push or sync fails (state has been re-fetched by then). */
  onSyncError?: (error: unknown) => void;
};

/**
 * A JMAP-backed calendar store exposing the same synchronous surface as the components'
 * events-api context (`EventsAPIContextValue`-compatible by structure), so it can be
 * plugged into `calendar-view-group`/`event-calendar` hosts.
 *
 * Mutations apply optimistically to local state (rows carry `pendingOp` markers), then a
 * background `CalendarEvent/set` pushes each affected event; on success the canonical
 * server object is re-fetched, clearing the pending markers. `sync()` (or polling)
 * reconciles remote changes via `/changes`.
 */
export class JmapEventsAdapter {
  #calendars: JmapCalendarsClient;
  #options: JmapEventsAdapterOptions;
  #accountId: JmapId | null = null;

  #events: CalendarEventsMap = new Map();
  #calendarsMap: CalendarsMap = new Map();
  /** Last known wire object per master key; source of opaque property preservation. */
  #originals = new Map<string, JmapCalendarEvent>();
  #jmapIdByKey = new Map<string, JmapId>();
  #keyByJmapId = new Map<JmapId, string>();

  #visibleCalendarIds: string[] | undefined;
  #selectedCalendarId: string | undefined;

  #dirtyMasters = new Set<string>();
  #pushChain: Promise<void> = Promise.resolve();
  #pollTimer: ReturnType<typeof setInterval> | undefined;
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

  /** Connects (if needed), loads calendars, and optionally the given event window. */
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

  /** Windowed fetch for the visible date range; merges results into local state. */
  async loadRange(range: DateRange): Promise<void> {
    this.#lastRange = range;
    const response = await this.#calendars.getCalendarEventsInRange(this.accountId, range);
    for (const jmapEvent of response.list) {
      this.#ingestServerEvent(jmapEvent);
    }
    this.#notify();
  }

  /** Pulls remote changes since the last known states and reconciles local rows. */
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
          }
        }
        for (const id of changes.destroyed) this.#calendarsMap.delete(id);
      }

      const eventState = client.getState(this.accountId, CALENDAR_EVENT_TYPE);
      if (eventState) {
        const changes = await this.#calendars.calendarEventChanges(this.accountId, eventState);
        const changedIds = [...changes.created, ...changes.updated];
        if (changedIds.length) {
          const fetched = await this.#calendars.getCalendarEvents(this.accountId, changedIds);
          for (const jmapEvent of fetched.list) {
            this.#ingestServerEvent(jmapEvent);
          }
        }
        for (const id of changes.destroyed) {
          const key = this.#keyByJmapId.get(id) ?? id;
          this.#removeLocalRows(key);
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
      void this.sync();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  /** Resolves when all queued pushes have completed (or failed and been reconciled). */
  async flush(): Promise<void> {
    await this.#pushChain;
  }

  // ---- EventsAPIContextValue-compatible surface ----

  getEvents(): EventsState {
    return this.#events;
  }

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

  getApi(): EventsAPI {
    return new EventsAPI(this.#events, {
      timezone: this.#options.timezone,
      trackPending: true,
    });
  }

  apply(operation: EventOperation): ApplyResult {
    const api = this.getApi();
    const result = api.apply(operation);
    this.#events = result.nextState;
    this.#queuePush(result.changes);
    this.#notify();
    return result;
  }

  create(input: CreateInput): ApplyResult {
    return this.apply({ type: "create", input });
  }

  update(input: UpdateInput): ApplyResult {
    return this.apply({ type: "update", input });
  }

  move(input: MoveInput): ApplyResult {
    return this.apply({ type: "move", input });
  }

  resizeStart(input: ResizeStartInput): ApplyResult {
    return this.apply({ type: "resize-start", input });
  }

  resizeEnd(input: ResizeEndInput): ApplyResult {
    return this.apply({ type: "resize-end", input });
  }

  remove(input: RemoveInput): ApplyResult {
    return this.apply({ type: "remove", input });
  }

  addExclusion(input: AddExclusionInput): ApplyResult {
    return this.apply({ type: "add-exclusion", input });
  }

  removeExclusion(input: RemoveExclusionInput): ApplyResult {
    return this.apply({ type: "remove-exclusion", input });
  }

  addException(input: AddExceptionInput): ApplyResult {
    return this.apply({ type: "add-exception", input });
  }

  removeException(input: RemoveExceptionInput): ApplyResult {
    return this.apply({ type: "remove-exception", input });
  }

  // ---- internals ----

  #notify(): void {
    this.#options.onChange?.();
  }

  /** Replaces local rows for a server event unless local pending edits exist for it. */
  #ingestServerEvent(jmapEvent: JmapCalendarEvent): void {
    const masterKey = this.#keyByJmapId.get(jmapEvent.id) ?? jmapEvent.id;
    if (this.#hasPendingRows(masterKey)) return;
    this.#removeLocalRows(masterKey, { keepMappings: true });
    const rows = jmapEventToInternalRows(jmapEvent, {
      accountId: this.accountId,
      masterKey,
    });
    for (const row of rows) this.#events.set(row.key, row.event);
    this.#originals.set(masterKey, jmapEvent);
    this.#jmapIdByKey.set(masterKey, jmapEvent.id);
    this.#keyByJmapId.set(jmapEvent.id, masterKey);
  }

  #hasPendingRows(masterKey: string): boolean {
    const prefix = `${masterKey}::`;
    for (const [key, event] of this.#events) {
      if (key !== masterKey && !key.startsWith(prefix)) continue;
      if (event.pendingOp) return true;
    }
    return false;
  }

  #removeLocalRows(masterKey: string, options: { keepMappings?: boolean } = {}): void {
    const prefix = `${masterKey}::`;
    for (const key of [...this.#events.keys()]) {
      if (key === masterKey || key.startsWith(prefix)) this.#events.delete(key);
    }
    if (!options.keepMappings) {
      const jmapId = this.#jmapIdByKey.get(masterKey);
      if (jmapId) this.#keyByJmapId.delete(jmapId);
      this.#jmapIdByKey.delete(masterKey);
      this.#originals.delete(masterKey);
    }
  }

  #queuePush(changes: EventChange[]): void {
    for (const change of changes) {
      const masterKey = change.key.includes("::") ? change.key.split("::")[0] : change.key;
      this.#dirtyMasters.add(masterKey);
    }
    if (!this.#dirtyMasters.size) return;
    this.#pushChain = this.#pushChain.then(() => this.#drainPushQueue());
  }

  async #drainPushQueue(): Promise<void> {
    while (this.#dirtyMasters.size) {
      const [masterKey] = this.#dirtyMasters;
      this.#dirtyMasters.delete(masterKey);
      try {
        await this.#pushMaster(masterKey);
      } catch (error) {
        this.#options.onSyncError?.(error);
        await this.#recoverFromPushFailure(masterKey);
      }
    }
  }

  async #pushMaster(masterKey: string): Promise<void> {
    const jmapId = this.#jmapIdByKey.get(masterKey);
    const master = this.#events.get(masterKey);

    // Deleted (or created-then-deleted) locally.
    if (!master || master.pendingOp === "deleted") {
      if (jmapId) {
        await this.#calendars.setCalendarEvents({
          accountId: this.accountId,
          destroy: [jmapId],
        });
      }
      this.#removeLocalRows(masterKey);
      this.#notify();
      return;
    }

    const group = collectInternalGroup(this.#liveRowsFor(masterKey), masterKey);
    if (!group) return;
    const original = this.#originals.get(masterKey);
    const payload = internalGroupToJmapEvent(group, {
      original,
      defaultCalendarId: this.getSelectedCalendarId(),
    });

    let serverId = jmapId;
    if (!serverId) {
      const response = await this.#calendars.setCalendarEvents({
        accountId: this.accountId,
        create: { [masterKey]: payload },
      });
      serverId = response.created?.[masterKey]?.id as JmapId | undefined;
      if (!serverId) throw new Error(`Server did not return an id for created event ${masterKey}`);
      this.#jmapIdByKey.set(masterKey, serverId);
      this.#keyByJmapId.set(serverId, masterKey);
    } else {
      await this.#calendars.setCalendarEvents({
        accountId: this.accountId,
        update: { [serverId]: payload as Record<string, unknown> },
      });
    }

    // Re-fetch the canonical server object; replaces rows and clears pending markers.
    await this.#refreshEvent(serverId, masterKey);
    this.#notify();
  }

  /** Rows for one master with pending-deleted exception rows filtered out. */
  #liveRowsFor(masterKey: string): CalendarEventsMap {
    const rows: CalendarEventsMap = new Map();
    const prefix = `${masterKey}::`;
    for (const [key, event] of this.#events) {
      if (key !== masterKey && !key.startsWith(prefix)) continue;
      if (event.pendingOp === "deleted") continue;
      rows.set(key, event);
    }
    return rows;
  }

  async #refreshEvent(jmapId: JmapId, masterKey: string): Promise<void> {
    const response = await this.#calendars.getCalendarEvents(this.accountId, [jmapId]);
    const jmapEvent = response.list[0];
    if (!jmapEvent) {
      this.#removeLocalRows(masterKey);
      return;
    }
    // Force-replace local rows (pending markers for this master are now confirmed).
    this.#removeLocalRows(masterKey, { keepMappings: true });
    const rows = jmapEventToInternalRows(jmapEvent, {
      accountId: this.accountId,
      masterKey,
    });
    for (const row of rows) this.#events.set(row.key, row.event);
    this.#originals.set(masterKey, jmapEvent);
  }

  async #recoverFromPushFailure(masterKey: string): Promise<void> {
    const jmapId = this.#jmapIdByKey.get(masterKey);
    try {
      if (jmapId) {
        await this.#refreshEvent(jmapId, masterKey);
      } else {
        // Failed create: drop the optimistic rows entirely.
        this.#removeLocalRows(masterKey);
      }
      this.#notify();
    } catch {
      // Server unreachable; leave optimistic state, a later sync() will reconcile.
    }
  }

  async #refetchAll(): Promise<void> {
    await this.refreshCalendars();
    if (this.#lastRange) await this.loadRange(this.#lastRange);
  }
}
