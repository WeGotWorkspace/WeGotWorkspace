import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  listedInviteeAttendees,
  type CalendarAttendee,
} from "@/calendar-core/src/calendar-attendees";
import {
  calendarEventToForm,
  engineEventToForm,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  formAnchoredToOccurrence,
  splitOccurrenceKey,
  toLocalRecurrenceId,
} from "@/calendar-core/src/calendar-recurrence-scope";
import { recurrencePresetOptionLabel } from "@/calendar-core/src/calendar-recurrence-presets";
import { meetingUrlFromCalendarEvent } from "@/calendar-core/src/calendar-meet-link";

export type CalendarEventPreviewModel = {
  eventId: string;
  recurrenceId?: string;
  form: CalendarEventFormValue;
};

export type CalendarEventSelectionOrigin = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const NOTES_PREVIEW_MAX = 160;

/** Shared master/occurrence form used by the details popover and the edit dialog. */
export function resolveCalendarEventPreview(
  key: string,
  options: {
    events: readonly JmapCalendarEvent[];
    surfaceEvents?: CalendarEventsMap;
    pendingDeletedEventIds?: ReadonlySet<string>;
  },
): CalendarEventPreviewModel | null {
  const { masterId, recurrenceId } = splitOccurrenceKey(key);
  if (options.pendingDeletedEventIds?.has(masterId)) return null;

  const wireEvent = options.events.find((entry) => entry.id === masterId);
  const occurrenceEngine = options.surfaceEvents?.get(key);
  const masterEngine = options.surfaceEvents?.get(masterId);
  let form = wireEvent
    ? calendarEventToForm(wireEvent)
    : masterEngine
      ? engineEventToForm(masterEngine)
      : occurrenceEngine
        ? engineEventToForm(occurrenceEngine)
        : null;
  if (!form) return null;

  if (recurrenceId) {
    if (occurrenceEngine) {
      const occurrenceForm = engineEventToForm(occurrenceEngine);
      form = {
        ...form,
        allDay: occurrenceForm.allDay,
        startDate: occurrenceForm.startDate,
        startTime: occurrenceForm.startTime,
        endDate: occurrenceForm.endDate,
        endTime: occurrenceForm.endTime,
      };
    } else {
      form = formAnchoredToOccurrence(form, recurrenceId);
    }
    if (wireEvent) {
      const localRid = toLocalRecurrenceId(
        recurrenceId,
        wireEvent.showWithoutTime === true,
        wireEvent.start,
      );
      form = {
        ...form,
        meetingUrl:
          meetingUrlFromCalendarEvent(wireEvent, localRid) ||
          meetingUrlFromCalendarEvent(wireEvent, recurrenceId) ||
          form.meetingUrl,
      };
    }
  }

  return {
    eventId: masterId,
    form,
    ...(recurrenceId ? { recurrenceId } : {}),
  };
}

export function eventPreviewOccurrenceKey(preview: CalendarEventPreviewModel): string {
  return preview.recurrenceId ? `${preview.eventId}::${preview.recurrenceId}` : preview.eventId;
}

function formatPlainDate(iso: string, locale: string): string {
  try {
    return Temporal.PlainDate.from(iso).toLocaleString(locale, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function formatPlainTime(hhmm: string, locale: string): string {
  try {
    return Temporal.PlainTime.from(`${hhmm}:00`).toLocaleString(locale, {
      timeStyle: "short",
    });
  } catch {
    return hhmm;
  }
}

/** Locale when-line for the compact popover (all-day or timed). */
export function formatEventPreviewWhen(form: CalendarEventFormValue, locale: string): string {
  const startDate = formatPlainDate(form.startDate, locale);
  const endDate = formatPlainDate(form.endDate, locale);
  if (form.allDay) {
    return form.startDate === form.endDate ? startDate : `${startDate} – ${endDate}`;
  }
  const startTime = formatPlainTime(form.startTime, locale);
  const endTime = formatPlainTime(form.endTime, locale);
  if (form.startDate === form.endDate) {
    return `${startDate} · ${startTime}–${endTime}`;
  }
  return `${startDate} · ${startTime} – ${endDate} · ${endTime}`;
}

export function eventPreviewNotesExcerpt(description: string): string | null {
  const trimmed = description.trim();
  if (!trimmed) return null;
  if (trimmed.length <= NOTES_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, NOTES_PREVIEW_MAX).trimEnd()}…`;
}

export function eventPreviewInviteeNames(
  attendees: CalendarAttendee[],
  labels: CalendarUILabels,
): string | null {
  const listed = listedInviteeAttendees(attendees);
  if (listed.length === 0) return null;
  const names = listed.map((row) => row.name || row.email);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} ${labels.eventDetailsMoreInvitees(names.length - 3)}`;
}

export function eventPreviewRepeatLabel(
  form: CalendarEventFormValue,
  locale: string,
): string | null {
  if (form.recurrencePreset === "none") return null;
  return recurrencePresetOptionLabel(form.recurrencePreset, form.startDate, locale);
}

function originFromRect(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): CalendarEventSelectionOrigin | undefined {
  if (rect.width === 0 && rect.height === 0) return undefined;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function originFromUnknown(value: unknown): CalendarEventSelectionOrigin | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.left !== "number" ||
    typeof record.top !== "number" ||
    typeof record.width !== "number" ||
    typeof record.height !== "number"
  ) {
    return undefined;
  }
  return originFromRect({
    left: record.left,
    top: record.top,
    width: record.width,
    height: record.height,
  });
}

function eventCardFromPath(path: EventTarget[]): Element | undefined {
  if (typeof Element === "undefined") return undefined;
  return path.find((entry): entry is Element => {
    if (!(entry instanceof Element)) return false;
    const tag = entry.tagName.toLowerCase();
    return tag === "event-card" || tag === "all-day-event";
  });
}

/** Compact-month day cells are ≪ a week-view day column. */
const COMPACT_MONTH_CELL_MAX_WIDTH = 72;
const COMPACT_MONTH_CELL_MIN_HEIGHT = 64;
const COMPACT_MONTH_CELL_MIN_ASPECT = 1.75;

/** Virtual trigger height so a tall timed segment does not pin the popover to the grid floor. */
const DETAILS_POPOVER_ANCHOR_MAX_HEIGHT = 40;

function originLooksLikeMonthCell(origin: CalendarEventSelectionOrigin): boolean {
  return (
    origin.width > 0 &&
    origin.width <= COMPACT_MONTH_CELL_MAX_WIDTH &&
    origin.height >= COMPACT_MONTH_CELL_MIN_HEIGHT &&
    origin.height / origin.width >= COMPACT_MONTH_CELL_MIN_ASPECT
  );
}

/** Clicked-segment box for placement: keep width, clamp tall day-column cards to a compact head. */
export function detailsPopoverAnchorOrigin(
  origin: CalendarEventSelectionOrigin,
): CalendarEventSelectionOrigin {
  if (origin.height <= DETAILS_POPOVER_ANCHOR_MAX_HEIGHT) return origin;
  return { ...origin, height: DETAILS_POPOVER_ANCHOR_MAX_HEIGHT };
}

function viewportPrefersDockedPopover(): boolean {
  if (typeof globalThis.matchMedia !== "function") return false;
  return (
    globalThis.matchMedia("(max-width: 40rem)").matches ||
    globalThis.matchMedia("(orientation: portrait) and (max-width: 48rem)").matches
  );
}

/** Narrow/portrait viewport or a compact-month day cell: dock instead of anchoring to the card. */
export function detailsPopoverShouldDock(origin?: CalendarEventSelectionOrigin): boolean {
  return viewportPrefersDockedPopover() || (origin != null && originLooksLikeMonthCell(origin));
}

/** Shared `event-selected` decode for CalendarSurface and search list hosts. */
export function eventSelectedFromEvent(
  event: Event,
): { key: string; origin?: CalendarEventSelectionOrigin } | null {
  const key =
    event instanceof CustomEvent ? (event.detail as { key?: unknown } | undefined)?.key : undefined;
  if (typeof key !== "string" || key === "") return null;
  return { key, origin: selectionOriginFromEvent(event) };
}

/** Same `event-selected` → opener wiring for the grid surface and search list. */
export function bindCalendarEventSelected(
  target: EventTarget,
  onEventSelected: (key: string, origin?: CalendarEventSelectionOrigin) => void,
): () => void {
  const handle = (event: Event) => {
    const selected = eventSelectedFromEvent(event);
    if (selected) onEventSelected(selected.key, selected.origin);
  };
  target.addEventListener("event-selected", handle);
  return () => target.removeEventListener("event-selected", handle);
}

export function selectionOriginFromEvent(event: Event): CalendarEventSelectionOrigin | undefined {
  const detail = event instanceof CustomEvent ? event.detail : undefined;
  const fromDetail = originFromUnknown(
    detail && typeof detail === "object" ? (detail as { origin?: unknown }).origin : undefined,
  );
  if (fromDetail) return fromDetail;

  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const card = eventCardFromPath(path);
  if (card) return originFromRect(card.getBoundingClientRect());
  return undefined;
}
