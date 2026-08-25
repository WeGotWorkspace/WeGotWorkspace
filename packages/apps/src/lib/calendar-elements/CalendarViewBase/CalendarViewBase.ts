import { Temporal } from "@js-temporal/polyfill";
import { ContextConsumer } from "@lit/context";
import {
  parseRecurrenceId,
  resolveCalendarEventColor,
  shiftDateValue,
  type ApplyResult,
  type CalendarEvent as ApiCalendarEvent,
  type CalendarEventPendingOperation,
  type CalendarEventsMap,
  type EventOperation,
} from "@/lib/calendar-engine";
import {
  adjacentRenderedEventRanges,
  cachedVisibleEventsInRange,
  prefetchVisibleEventsInRange,
  type RenderedEventsCache,
} from "./renderedEvents.js";
import { resolvedDataEnd } from "../domain/events-api/eventMapBridge.js";
import { BaseElement } from "../BaseElement/BaseElement.js";
import { type EventsAPIContextValue, eventsAPIContext } from "../context/EventsAPIContext.js";
import {
  fromCreateRequest,
  fromDeleteRequest,
  fromUpdateRequest,
  moveFromUpdateRequest,
} from "../domain/events-api/adapters.js";
import { resolveEventMapKey } from "../domain/events-api/resolveEventMapKey.js";
import type {
  CalendarEventPendingByCalendarId,
  CalendarEventPendingByOperation,
  CalendarEventPendingGroups,
  CalendarEventPendingOptions,
  CalendarEventPendingResult,
} from "../types/calendarEventPending.js";
import {
  isCalendarEventException,
  isCalendarEventRecurring,
} from "../types/calendarEventSemantics.js";

type EventsMap = CalendarEventsMap;
type EventEntry = [string, ApiCalendarEvent];
import type {
  EventCreateRequestDetail,
  EventDeleteRequestDetail,
  EventKeyDetail,
  EventUpdateRequestDetail,
} from "../types/CalendarEventRequests.js";
import type { WeekdayNumber } from "../types/Weekday.js";
import { getLocaleDirection, getLocaleWeekInfo, resolveLocale } from "../utils/Locale.js";

export function isWeekdayNumber(value: number | undefined): value is WeekdayNumber {
  return Boolean(value && Number.isInteger(value) && value >= 1 && value <= 7);
}

export abstract class CalendarViewBase extends BaseElement {
  #lang?: string;
  #timezone?: string;
  #currentTime?: string;
  #eventsAPI?: EventsAPIContextValue;
  #renderedEventsCache: RenderedEventsCache | null = null;
  #prefetchIdleId: number | null = null;
  #prefetchTimeoutId: ReturnType<typeof setTimeout> | null = null;
  #eventsAPIConsumer = new ContextConsumer(this, {
    context: eventsAPIContext,
    subscribe: true,
    callback: (value: EventsAPIContextValue | undefined) => {
      this.#eventsAPI = value;
      this.requestUpdate();
    },
  });

  declare events?: EventsMap;
  selectedCalendarId?: string;

  /**
   * Walk ancestors across Lit shadow roots to find `wgw-calendar-surface`.
   * `Element.closest` stops at a shadow boundary, so a plain closest from a
   * nested view never reaches the React-wired host.
   */
  #findCalendarSurfaceHost():
    | (HTMLElement & {
        requestRecurrenceScope?: (request: {
          action: "edit" | "delete" | "update";
          masterId: string;
          recurrenceId?: string;
          description?: string;
        }) => Promise<"thisInstance" | "thisAndFuture" | "allInstances" | null>;
      })
    | null {
    type SurfaceHost = HTMLElement & {
      requestRecurrenceScope?: (request: {
        action: "edit" | "delete" | "update";
        masterId: string;
        recurrenceId?: string;
        description?: string;
      }) => Promise<"thisInstance" | "thisAndFuture" | "allInstances" | null>;
    };
    const inLightDom = this.closest("wgw-calendar-surface") as SurfaceHost | null;
    if (inLightDom) return inLightDom;

    let root: Node = this.getRootNode();
    while (root instanceof ShadowRoot) {
      const host = root.host;
      if (host.localName === "wgw-calendar-surface") return host as SurfaceHost;
      const nested = host.closest("wgw-calendar-surface") as SurfaceHost | null;
      if (nested) return nested;
      root = host.getRootNode();
    }
    return null;
  }

  /**
   * Host-provided scope picker (React wires this on `wgw-calendar-surface`).
   * Returns `thisInstance` | `thisAndFuture` | `allInstances` (delete only),
   * or `null` when the user cancels or no host callback is available
   * (abort — never use `window.confirm`).
   */
  async #askRecurrenceScope(args: {
    action: "update" | "delete";
    masterId: string;
    recurrenceId?: string;
    description?: string;
  }): Promise<"thisInstance" | "thisAndFuture" | "allInstances" | null> {
    const host = this.#findCalendarSurfaceHost();
    if (!host?.requestRecurrenceScope) return null;
    return host.requestRecurrenceScope({
      action: args.action === "update" ? "edit" : args.action,
      masterId: args.masterId,
      recurrenceId: args.recurrenceId,
      description: args.description,
    });
  }

  static get properties() {
    return {
      events: {
        type: Object,
        converter: {
          fromAttribute: (value: string | null): EventsMap =>
            new Map(JSON.parse(value || "[]") as EventEntry[]),
        },
      },
      lang: { type: String },
      dir: { type: String, reflect: true },
      timezone: { type: String },
      currentTime: { type: String, attribute: "current-time" },
      selectedCalendarId: { type: String, attribute: "selected-calendar-id" },
    } as const;
  }

  get lang(): string {
    return resolveLocale(this.#lang);
  }

  set lang(lang: string | null | undefined) {
    this.#lang = lang?.trim() ? lang : undefined;
  }

  get timezone(): string {
    return this.#timezone ?? Temporal.Now.timeZoneId();
  }

  set timezone(timezone: string | null | undefined) {
    this.#timezone = timezone?.trim() ? timezone : undefined;
  }

  get currentTime(): string {
    return this.#currentTime ?? Temporal.Now.zonedDateTimeISO(this.timezone).toString();
  }

  set currentTime(
    currentTime: Temporal.PlainDateTime | Temporal.ZonedDateTime | string | null | undefined,
  ) {
    this.#currentTime = currentTime?.toString() ?? undefined;
  }

  /**
   * Explicitly pinned `currentTime`, or `undefined` when the view should read a live clock.
   * Day/week composition binds this (not `currentTime`) so a parent re-render does not freeze
   * Temporal.Now into the child and the now-indicator can tick.
   */
  protected get pinnedCurrentTime(): string | undefined {
    return this.#currentTime;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.#eventsAPIConsumer;
  }

  disconnectedCallback() {
    this.#cancelRenderedEventsPrefetch();
    super.disconnectedCallback();
  }

  /** Prefer the bound map; context `getEvents()` is already `@lit-calendar/events-api` state. */
  #viewMapFromContext(api: EventsAPIContextValue): EventsMap {
    if (this.events !== undefined) {
      return this.events;
    }
    return api.getEvents() ?? new Map();
  }

  /**
   * Color shown for an event: `data.color` when set, otherwise the parent calendar (from context),
   * then the shared fallback (`DEFAULT_CALENDAR_EVENT_COLOR` in `@lit-calendar/events-api`).
   */
  protected resolveEventDisplayColor(event: ApiCalendarEvent): string {
    return resolveCalendarEventColor(
      event.calendarId,
      event.data.color,
      this.#eventsAPI?.getCalendars(),
    );
  }

  /** Color for a newly created event before any explicit user color is chosen. */
  protected resolveNewEventColor(calendarId: string | undefined): string {
    return resolveCalendarEventColor(
      calendarId ?? this.calendarIdForNewEvent(),
      undefined,
      this.#eventsAPI?.getCalendars(),
    );
  }

  /** Resolves {@link Calendar.accountId} for a calendar id using context, when the host provided a map. */
  protected accountIdForCalendar(calendarId: string | undefined): string | undefined {
    const id = calendarId?.trim();
    if (!id) return undefined;
    return this.#eventsAPI?.getCalendars()?.get(id)?.accountId;
  }

  /**
   * Calendar id for create gestures: from {@link EventsAPIContextValue.getSelectedCalendarId} when the
   * host provides it (e.g. `event-calendar`), otherwise {@link selectedCalendarId}.
   */
  protected calendarIdForNewEvent(): string | undefined {
    const fromContext = this.#eventsAPI?.getSelectedCalendarId();
    if (fromContext !== undefined && fromContext !== null) {
      const trimmed = String(fromContext).trim();
      if (trimmed !== "") return trimmed;
    }
    const raw = this.selectedCalendarId;
    if (raw === undefined || raw === null) return undefined;
    const trimmed = String(raw).trim();
    return trimmed === "" ? undefined : trimmed;
  }

  /** Account for a new event when the target calendar is known (see {@link calendarIdForNewEvent}). */
  protected defaultAccountIdForNewEvent(): string | undefined {
    return this.accountIdForCalendar(this.calendarIdForNewEvent());
  }

  protected applyCreateRequestToEventsAPI(detail: EventCreateRequestDetail): boolean {
    if (!this.#eventsAPI) return false;
    // Cancelable intent: consumers (e.g. Storybook) may prompt/confirm and call preventDefault,
    // or mutate `detail.content` (summary, etc.) before the create is applied.
    const accepted = this.dispatchEvent(
      new CustomEvent("event-create-requested", {
        detail,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    if (!accepted) return false;
    const result = this.#applyEventsAPIOperation({
      type: "create",
      input: fromCreateRequest(detail),
    });
    if (!result) return true;
    const key = this.#notifyKeyFromApply(result, "");
    if (key) {
      this.#emitCalendarRequestApplied("event-created", { key });
    }
    return true;
  }

  protected async applyUpdateRequestToEventsAPI(detail: EventUpdateRequestDetail): Promise<{
    handled: boolean;
    accepted: boolean;
  }> {
    if (!this.#eventsAPI || !detail.envelope.eventId) return { handled: false, accepted: true };
    const events = this.#viewMapFromContext(this.#eventsAPI);
    const eventKey = resolveEventMapKey(events, detail.envelope);
    if (!eventKey) return { handled: false, accepted: true };
    const current = events.get(eventKey);
    if (!current) return { handled: false, accepted: true };

    const data = current.data;
    const currentEnd = resolvedDataEnd(data);
    const isRecurring = detail.envelope.isRecurring ?? isCalendarEventRecurring(current);
    const shouldPromptForSeries = isRecurring && !isCalendarEventException(current);
    const recurrenceId = detail.envelope.recurrenceId ?? current.recurrenceId;
    const occurrenceStart =
      data.recurrenceRule && !current.recurrenceId && recurrenceId
        ? (parseRecurrenceId(recurrenceId, data.allDay ?? false, data.start) ?? data.start)
        : data.start;
    const baseDuration = this.#toPlainDateTime(data.start).until(this.#toPlainDateTime(currentEnd));
    const occurrenceEnd = shiftDateValue(occurrenceStart, baseDuration);
    const updateKind = this.#getUpdateKind(
      occurrenceStart,
      occurrenceEnd,
      detail.content.start,
      detail.content.end,
    );

    if (shouldPromptForSeries && recurrenceId) {
      // Engine/JMAP map key — not JSCalendar uid (`envelope.eventId`). React
      // truncate/fork looks up bootstrap + surface by this key.
      const seriesMasterKey = eventKey.includes("::")
        ? eventKey.slice(0, eventKey.indexOf("::"))
        : eventKey;
      const moveTarget = this.#formatScopeMoveTarget(detail.content.start, Boolean(data.allDay));
      const scope = await this.#askRecurrenceScope({
        action: "update",
        masterId: seriesMasterKey,
        recurrenceId,
        description: moveTarget
          ? `Do you want to move only this occurrence to ${moveTarget}, or change the date for this and all future events?`
          : undefined,
      });
      if (scope !== "thisInstance" && scope !== "thisAndFuture") {
        return { handled: true, accepted: false };
      }

      if (scope === "thisInstance") {
        return this.#applyUpdateAndNotify(eventKey, {
          type: "add-exception",
          input: {
            target: { key: eventKey },
            recurrenceId,
            event: {
              start: detail.content.start,
              end: detail.content.end,
              summary: detail.content.summary,
              color: detail.content.color,
              location: detail.content.location,
              calendarId: detail.envelope.calendarId,
              accountId: detail.envelope.accountId,
            },
          },
        });
      }

      // thisAndFuture: React truncates the master and creates a forked series.
      // Keep the suggested geometry (`accepted: true`); the view drops its overlay
      // once the engine map reflects the fork. Cancel is the only revert path.
      this.dispatchEvent(
        new CustomEvent("recurrence-future-update", {
          detail: {
            masterId: seriesMasterKey,
            recurrenceId,
            allDay: Boolean(data.allDay),
            start: detail.content.start,
            end: detail.content.end,
            summary: detail.content.summary,
            location: detail.content.location,
            calendarId: detail.envelope.calendarId,
          },
          bubbles: true,
          composed: true,
        }),
      );
      return { handled: true, accepted: true };
    }

    if (updateKind === "move") {
      const delta = this.#toPlainDateTime(occurrenceStart).until(
        this.#toPlainDateTime(detail.content.start),
      );
      const moveInput = moveFromUpdateRequest(detail, delta);
      return this.#applyUpdateAndNotify(eventKey, {
        type: "move",
        input: {
          ...moveInput,
          target: { key: eventKey },
        },
      });
    }

    if (updateKind === "resize-start") {
      return this.#applyUpdateAndNotify(eventKey, {
        type: "resize-start",
        input: {
          target: { key: eventKey },
          scope: detail.envelope.isRecurring && !detail.envelope.isException ? "series" : "single",
          toStart: detail.content.start,
        },
      });
    }

    if (updateKind === "resize-end") {
      return this.#applyUpdateAndNotify(eventKey, {
        type: "resize-end",
        input: {
          target: { key: eventKey },
          scope: detail.envelope.isRecurring && !detail.envelope.isException ? "series" : "single",
          toEnd: detail.content.end,
        },
      });
    }

    const updateInput = fromUpdateRequest(detail);
    return this.#applyUpdateAndNotify(eventKey, {
      type: "update",
      input: {
        ...updateInput,
        target: { key: eventKey },
      },
    });
  }

  protected async applyDeleteRequestToEventsAPI(
    detail: EventDeleteRequestDetail,
  ): Promise<boolean> {
    if (!this.#eventsAPI || !detail.envelope.eventId) return false;
    const events = this.#viewMapFromContext(this.#eventsAPI);
    const eventKey = resolveEventMapKey(events, detail.envelope);
    if (!eventKey) return false;
    const current = events.get(eventKey);
    if (!current) return false;

    const recurrenceId = detail.envelope.recurrenceId ?? current.recurrenceId;
    const isRecurring = detail.envelope.isRecurring ?? isCalendarEventRecurring(current);
    const shouldPromptForSeries = isRecurring && !isCalendarEventException(current);

    if (shouldPromptForSeries) {
      const seriesMasterKey = eventKey.includes("::")
        ? eventKey.slice(0, eventKey.indexOf("::"))
        : eventKey;
      const scope = await this.#askRecurrenceScope({
        action: "delete",
        masterId: seriesMasterKey,
        recurrenceId,
      });
      if (!scope) return true;

      // All instances: destroy the master series (not an exclusion on one occurrence).
      if (scope === "allInstances") {
        const masterKey =
          detail.envelope.eventId && events.has(detail.envelope.eventId)
            ? detail.envelope.eventId
            : seriesMasterKey;
        const removeInput = fromDeleteRequest(detail);
        return this.#applyDeleteAndNotify(masterKey, {
          type: "remove",
          input: {
            ...removeInput,
            target: { key: masterKey },
            scope: "series",
          },
        });
      }

      // thisAndFuture: ask React to truncate the master series at this occurrence.
      if (scope === "thisAndFuture" && recurrenceId) {
        this.dispatchEvent(
          new CustomEvent("recurrence-future-delete", {
            detail: {
              masterId: seriesMasterKey,
              recurrenceId,
              allDay: Boolean(current.data.allDay),
            },
            bubbles: true,
            composed: true,
          }),
        );
        return true;
      }
      // thisInstance: fall through to add-exclusion / remove-exception below.
    }

    if (isCalendarEventException(current)) {
      return this.#applyDeleteAndNotify(eventKey, {
        type: "remove-exception",
        input: {
          target: { key: eventKey },
          recurrenceId,
          options: { asExclusion: true },
        },
      });
    }

    if (isRecurring && recurrenceId && current.data.recurrenceRule && !current.recurrenceId) {
      return this.#applyDeleteAndNotify(eventKey, {
        type: "add-exclusion",
        input: {
          target: { key: eventKey },
          recurrenceId,
        },
      });
    }

    const removeInput = fromDeleteRequest(detail);
    return this.#applyDeleteAndNotify(eventKey, {
      type: "remove",
      input: {
        ...removeInput,
        target: { key: eventKey },
        scope: "single",
      },
    });
  }

  /** Cached expand + declined filter; identity of `events` plus range/timezone is the key. */
  getRenderedEvents(range: {
    start: Temporal.PlainDateTime;
    end: Temporal.PlainDateTime;
  }): EventsMap {
    const next = cachedVisibleEventsInRange(
      this.#renderedEventsCache,
      this.events,
      range,
      this.timezone,
    );
    this.#renderedEventsCache = next.cache;
    this.#scheduleAdjacentRenderedEventsPrefetch(range);
    return next.value;
  }

  #cancelRenderedEventsPrefetch(): void {
    if (this.#prefetchIdleId !== null && typeof cancelIdleCallback === "function") {
      cancelIdleCallback(this.#prefetchIdleId);
    }
    this.#prefetchIdleId = null;
    if (this.#prefetchTimeoutId !== null) {
      clearTimeout(this.#prefetchTimeoutId);
    }
    this.#prefetchTimeoutId = null;
  }

  #scheduleAdjacentRenderedEventsPrefetch(range: {
    start: Temporal.PlainDateTime;
    end: Temporal.PlainDateTime;
  }): void {
    this.#cancelRenderedEventsPrefetch();
    const run = (): void => {
      this.#prefetchIdleId = null;
      this.#prefetchTimeoutId = null;
      const { prev, next } = adjacentRenderedEventRanges(range);
      let cache = this.#renderedEventsCache;
      cache = prefetchVisibleEventsInRange(cache, this.events, prev, this.timezone);
      cache = prefetchVisibleEventsInRange(cache, this.events, next, this.timezone);
      this.#renderedEventsCache = cache;
    };
    if (typeof requestIdleCallback === "function") {
      this.#prefetchIdleId = requestIdleCallback(run);
      return;
    }
    this.#prefetchTimeoutId = setTimeout(run, 0);
  }

  get pendingByCalendarId(): CalendarEventPendingByCalendarId {
    return this.getPendingEvents({ groupBy: "calendarId" });
  }

  getPendingEvents(options: { groupBy: "pendingOp" }): CalendarEventPendingGroups;
  getPendingEvents(options: { groupBy: "calendarId" }): CalendarEventPendingByCalendarId;
  getPendingEvents(options: CalendarEventPendingOptions = {}): CalendarEventPendingResult {
    if (options.groupBy === "calendarId") return this.#collectPendingByCalendarId();
    return this.#collectPendingByOperation();
  }

  #collectPendingByOperation(): CalendarEventPendingGroups {
    const grouped: CalendarEventPendingGroups = this.#createPendingGroupsMap();
    for (const [id, event] of this.events ?? []) {
      const pendingOp = this.#resolvePendingOperation(event);
      if (!pendingOp) continue;
      const bucket = grouped.get(pendingOp);
      if (!bucket) continue;
      bucket.set(id, event);
    }
    return grouped;
  }

  #collectPendingByCalendarId(): CalendarEventPendingByCalendarId {
    const grouped: CalendarEventPendingByCalendarId = new Map();
    for (const [id, event] of this.events ?? []) {
      const pendingOp = this.#resolvePendingOperation(event);
      if (!pendingOp) continue;
      if (!event.calendarId || !event.eventId) continue;

      const byEventId =
        grouped.get(event.calendarId) ?? new Map<string, CalendarEventPendingByOperation>();
      const byOperation = byEventId.get(event.eventId) ?? this.#createPendingOperationMap();
      const bucket = byOperation.get(pendingOp);
      if (!bucket) continue;
      bucket.set(id, event);
      byEventId.set(event.eventId, byOperation);
      grouped.set(event.calendarId, byEventId);
    }
    return grouped;
  }

  protected resolveWeekStart(weekStart: number | undefined, lang: string): WeekdayNumber {
    if (isWeekdayNumber(weekStart)) return weekStart as WeekdayNumber;
    const firstDay = getLocaleWeekInfo(lang).firstDay;
    if (isWeekdayNumber(firstDay)) return firstDay;
    return 1;
  }

  protected resolveDirection(forceRtl = false): "ltr" | "rtl" {
    if (forceRtl) return "rtl";

    const explicitDirection = this.dir?.trim().toLowerCase();
    if (explicitDirection === "rtl" || explicitDirection === "ltr") {
      return explicitDirection;
    }

    return getLocaleDirection(this.lang);
  }

  protected forwardCalendarEvent = (event: Event) => {
    this.#forwardCalendarEvent(event, false);
  };

  protected forwardComposedCalendarEvent = (event: Event) => {
    this.#forwardCalendarEvent(event, true);
  };

  #forwardCalendarEvent(event: Event, composed: boolean) {
    event.stopPropagation();
    const forwardedEvent = new CustomEvent(event.type, {
      detail: event instanceof CustomEvent ? event.detail : undefined,
      bubbles: true,
      composed,
      cancelable: event.cancelable,
    });
    const notCancelled = this.dispatchEvent(forwardedEvent);
    if (!notCancelled && event.cancelable) {
      event.preventDefault();
    }
  }

  #emitCalendarRequestApplied(
    type: "event-created" | "event-updated" | "event-deleted",
    detail: EventKeyDetail,
  ): void {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail,
        bubbles: true,
        composed: true,
        cancelable: false,
      }),
    );
  }

  #notifyKeyFromApply(result: ApplyResult, fallbackKey: string): string {
    const created = result.changes.find((change) => change.type === "created");
    if (created) return created.key;
    const updated = result.changes.find((change) => change.type === "updated");
    if (updated) return updated.key;
    const removed = result.changes.find((change) => change.type === "removed");
    if (removed) return removed.key;
    return fallbackKey;
  }

  #applyUpdateAndNotify(
    eventKey: string,
    operation: EventOperation,
  ): { handled: boolean; accepted: boolean } {
    const result = this.#applyEventsAPIOperation(operation);
    if (!result) return { handled: true, accepted: true };
    return this.#returnUpdateHandled(eventKey, result);
  }

  #applyDeleteAndNotify(eventKey: string, operation: EventOperation): boolean {
    const result = this.#applyEventsAPIOperation(operation);
    if (!result) return true;
    return this.#returnDeleteHandled(eventKey, result);
  }

  #returnUpdateHandled(
    eventKey: string,
    result: ApplyResult,
  ): { handled: boolean; accepted: boolean } {
    this.#emitCalendarRequestApplied("event-updated", {
      key: this.#notifyKeyFromApply(result, eventKey),
    });
    return { handled: true, accepted: true };
  }

  #returnDeleteHandled(eventKey: string, result: ApplyResult): boolean {
    this.#emitCalendarRequestApplied("event-deleted", {
      key: this.#notifyKeyFromApply(result, eventKey),
    });
    return true;
  }

  #applyEventsAPIOperation(operation: EventOperation): ApplyResult | undefined {
    if (!this.#eventsAPI) return undefined;
    const result = this.#eventsAPI.apply(operation);
    this.events = result.nextState;
    return result;
  }

  #toPlainDateTime(value: Temporal.PlainDateTime): Temporal.PlainDateTime {
    return value;
  }

  /** Compact wall time for the recurrence-scope dialog description. */
  #formatScopeMoveTarget(start: Temporal.PlainDateTime, allDay: boolean): string | undefined {
    try {
      const dt = this.#toPlainDateTime(start);
      const day = String(dt.day).padStart(2, "0");
      const month = String(dt.month).padStart(2, "0");
      const date = `${day}/${month}/${dt.year}`;
      if (allDay) return date;
      const hour = String(dt.hour).padStart(2, "0");
      const minute = String(dt.minute).padStart(2, "0");
      return `${date}, ${hour}:${minute}`;
    } catch {
      return undefined;
    }
  }

  #getUpdateKind(
    currentStart: Temporal.PlainDateTime,
    currentEnd: Temporal.PlainDateTime,
    nextStart: Temporal.PlainDateTime,
    nextEnd: Temporal.PlainDateTime,
  ): "move" | "resize-start" | "resize-end" | "update" {
    const sameStart =
      Temporal.PlainDateTime.compare(
        this.#toPlainDateTime(currentStart),
        this.#toPlainDateTime(nextStart),
      ) === 0;
    const sameEnd =
      Temporal.PlainDateTime.compare(
        this.#toPlainDateTime(currentEnd),
        this.#toPlainDateTime(nextEnd),
      ) === 0;
    if (sameStart && sameEnd) return "update";
    if (!sameStart && sameEnd) return "resize-start";
    if (sameStart && !sameEnd) return "resize-end";
    const oldDuration = this.#toPlainDateTime(currentStart).until(
      this.#toPlainDateTime(currentEnd),
    );
    const newDuration = this.#toPlainDateTime(nextStart).until(this.#toPlainDateTime(nextEnd));
    return oldDuration.total({ unit: "seconds" }) === newDuration.total({ unit: "seconds" })
      ? "move"
      : "update";
  }

  #resolvePendingOperation(event: ApiCalendarEvent): CalendarEventPendingOperation | undefined {
    if (
      event.pendingOp === "created" ||
      event.pendingOp === "updated" ||
      event.pendingOp === "deleted"
    ) {
      return event.pendingOp;
    }
    return undefined;
  }

  #createPendingGroupsMap(): CalendarEventPendingGroups {
    return new Map([
      ["created", new Map()],
      ["updated", new Map()],
      ["deleted", new Map()],
    ]);
  }

  #createPendingOperationMap(): CalendarEventPendingByOperation {
    return new Map([
      ["created", new Map()],
      ["updated", new Map()],
      ["deleted", new Map()],
    ]);
  }
}
