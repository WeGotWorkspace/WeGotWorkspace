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
  /** Viewport rect of the create-preview card when the intent was emitted. */
  origin?: EventSelectionOriginRect;
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

/** Viewport rect that places the details popover. Day view uses the painted time label. */
export type EventSelectionOriginRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Emitted for `event-selected`; same shape as `event-created` / `event-updated` / `event-deleted` (`EventKeyDetail`). */
export type EventSelectionRequestDetail = EventKeyDetail & {
  origin?: EventSelectionOriginRect;
};

/**
 * Day-view timed cards are as wide as the day column. The edit popover prefers
 * the right side of that box and then opens outside the viewport. The painted
 * time label sits at the start of the card. Short cards hide
 * `.event-card-time-main` (container max-height 47px); `.event-card-compact-time`
 * is the label that remains.
 */
const DAY_VIEW_SELECTION_ANCHORS = [".event-card-time-main", ".event-card-compact-time"] as const;

export function eventSelectionOriginFromElement(
  target: EventTarget | null | undefined,
): EventSelectionOriginRect | undefined {
  return dayViewSelectionOrigin(target) ?? originRect(target);
}

function originRect(target: EventTarget | null | undefined): EventSelectionOriginRect | undefined {
  if (!(target instanceof Element)) return undefined;
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return undefined;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function dayViewSelectionOrigin(
  target: EventTarget | null | undefined,
): EventSelectionOriginRect | undefined {
  if (!(target instanceof Element) || target.tagName.toLowerCase() !== "event-card") {
    return undefined;
  }
  if (!isInsideDayTimeline(target)) return undefined;
  const root = target.shadowRoot;
  if (!root) return undefined;
  for (const selector of DAY_VIEW_SELECTION_ANCHORS) {
    const origin = originRect(root.querySelector(selector));
    if (origin) return origin;
  }
  return undefined;
}

function isInsideDayTimeline(card: Element): boolean {
  const timelineRoot = card.getRootNode();
  if (!(timelineRoot instanceof ShadowRoot)) return false;
  const viewRoot = timelineRoot.host.getRootNode();
  if (!(viewRoot instanceof ShadowRoot)) return false;
  const view = viewRoot.host;
  return (
    view.tagName.toLowerCase() === "calendar-timeline-view" && view.getAttribute("mode") === "day"
  );
}
