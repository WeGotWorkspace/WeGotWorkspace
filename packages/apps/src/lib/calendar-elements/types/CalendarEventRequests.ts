import type { Temporal } from "@js-temporal/polyfill";
import type { CalendarEventData, CalendarEventEnvelope } from "@/lib/calendar-engine";

/** UI-emitted payloads use an explicit `end` time (not duration-only). */
export type CalendarEventUIData = Omit<CalendarEventData, "duration" | "end"> & {
  end: Temporal.PlainDateTime;
};

export type CalendarEventRequestTrigger = "long-press" | "drag-select";

/** Map key in `events` (e.g. `sourceKey::recurrenceId` for an occurrence). */
export type EventKeyDetail = {
  key: string;
};

/**
 * Detail for cancelable `event-create-requested` (drag-to-create / click-create intent).
 * Listeners may `preventDefault()` to cancel, or mutate `content` (e.g. summary) before apply.
 * On accept, the view applies create and emits non-cancelable `event-created` with `{ key }`.
 */
export type EventCreateRequestDetail = {
  envelope: Pick<CalendarEventEnvelope, "calendarId" | "accountId">;
  content: CalendarEventUIData;
};

/** Internal: maps UI update gesture to API update/move/resize input (not DOM event detail). */
export type EventUpdateRequestDetail = {
  envelope: Pick<
    CalendarEventEnvelope,
    "eventId" | "accountId" | "calendarId" | "recurrenceId" | "isException" | "isRecurring"
  >;
  content: CalendarEventUIData;
};

/** Internal: maps UI delete gesture to API remove input (not DOM event detail). */
export type EventDeleteRequestDetail = {
  envelope: Pick<
    CalendarEventEnvelope,
    "accountId" | "calendarId" | "eventId" | "recurrenceId" | "isRecurring"
  >;
};

export type EventExceptionRequestDetail = {
  envelope: Pick<
    CalendarEventEnvelope,
    "eventId" | "accountId" | "calendarId" | "recurrenceId" | "isException" | "isRecurring"
  >;
  content: CalendarEventUIData;
  source: "move";
};

/** Emitted for `event-selected`; same shape as `event-created` / `event-updated` / `event-deleted` (`EventKeyDetail`). */
export type EventSelectionRequestDetail = EventKeyDetail;
