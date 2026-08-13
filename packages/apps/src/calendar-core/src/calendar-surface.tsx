import { createElement, useEffect, useRef } from "react";
import type { Temporal } from "@js-temporal/polyfill";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { WgwCalendarSurface } from "@/lib/calendar-elements/wgw/wgw-calendar-surface";
import "@/lib/calendar-elements/wgw/wgw-calendar-surface";
import type { EventsAPIContextValue } from "@/lib/calendar-elements/context/EventsAPIContext";
import { resolveCreateIntentAllDay } from "@/calendar-core/src/calendar-editor-model";
import type { CalendarPresentation, CalendarViewId } from "@/calendar-core/src/calendar-types";

/** Lit surface time-range view (list vs grid is `presentation`). */
export type CalendarSurfaceViewId = CalendarViewId;

/** Drag/click create intent from cancelable `event-create-requested`. */
export type CalendarSurfaceCreateIntent = {
  calendarId?: string;
  allDay: boolean;
  start: Temporal.PlainDateTime;
  /** Exclusive end for all-day; wall-clock end for timed. */
  end: Temporal.PlainDateTime;
  title?: string;
};

import type { RecurrenceScopeChoice } from "@/calendar-core/src/calendar-recurrence-scope";
import type { RecurrenceScopeRequest } from "@/calendar-core/src/calendar-recurrence-scope";

export type CalendarSurfaceProps = {
  view: CalendarSurfaceViewId;
  presentation: CalendarPresentation;
  /** ISO date for the view anchor (view-group aligns its own grid start). */
  startDate: string;
  events: CalendarEventsMap;
  visibleCalendarIds?: string[];
  selectedCalendarId?: string;
  contextValue?: EventsAPIContextValue;
  onEventSelected?: (key: string) => void | Promise<void>;
  /** Lit navigated (day-number click, swipe) — keep React view/dropdown in sync. */
  onViewChange?: (view: CalendarSurfaceViewId) => void;
  /** Lit changed the anchor date (day click, week swipe, …). */
  onStartDateChange?: (isoDate: string) => void;
  /**
   * Drag/click create intent. When provided, the cancelable Lit create is
   * prevented so the adapter does not persist until the dialog saves.
   */
  onCreateRequested?: (intent: CalendarSurfaceCreateIntent) => void;
  /** Ask Only-this / This-and-future (delete also offers All instances). */
  requestRecurrenceScope?: (
    request: RecurrenceScopeRequest,
  ) => Promise<RecurrenceScopeChoice | null>;
  /** Lit chose this-and-future delete — truncate master at the occurrence. */
  onRecurrenceFutureDelete?: (args: {
    masterId: string;
    recurrenceId: string;
    allDay?: boolean;
  }) => void;
  /** Lit chose this-and-future on drag — truncate master and fork at the new times. */
  onRecurrenceFutureUpdate?: (args: {
    masterId: string;
    recurrenceId: string;
    allDay?: boolean;
    start: Temporal.PlainDateTime;
    end: Temporal.PlainDateTime;
    summary?: string;
    location?: string;
    calendarId?: string;
  }) => void;
};

function isSurfaceViewId(value: string): value is CalendarSurfaceViewId {
  return value === "day" || value === "week" || value === "month" || value === "year";
}

/**
 * React boundary for the vendored lit calendar views: sets properties
 * imperatively on the `wgw-calendar-surface` host and listens for the
 * composed interaction events. All rendering and drag interactions live in
 * the lit layer.
 */
export function CalendarSurface({
  view,
  presentation,
  startDate,
  events,
  visibleCalendarIds,
  selectedCalendarId,
  contextValue,
  onEventSelected,
  onViewChange,
  onStartDateChange,
  onCreateRequested,
  requestRecurrenceScope,
  onRecurrenceFutureDelete,
  onRecurrenceFutureUpdate,
}: CalendarSurfaceProps) {
  const hostRef = useRef<WgwCalendarSurface | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.view = view;
    host.presentation = presentation;
    host.startDate = startDate;
    host.events = events;
    host.visibleCalendarIds = visibleCalendarIds;
    host.selectedCalendarId = selectedCalendarId;
    host.contextValue = contextValue;
    host.requestRecurrenceScope = requestRecurrenceScope;
  }, [
    view,
    presentation,
    startDate,
    events,
    visibleCalendarIds,
    selectedCalendarId,
    contextValue,
    requestRecurrenceScope,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !onEventSelected) return;
    const handleSelected = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (typeof key === "string" && key !== "") onEventSelected(key);
    };
    host.addEventListener("event-selected", handleSelected);
    return () => host.removeEventListener("event-selected", handleSelected);
  }, [onEventSelected]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const handleStartDateChanged = () => {
      if (!onStartDateChange) return;
      const next = host.startDate;
      if (typeof next === "string" && next !== "" && next !== startDate) {
        onStartDateChange(next);
      }
    };

    const handleViewChanged = () => {
      if (!onViewChange) return;
      const next = host.view;
      if (typeof next === "string" && isSurfaceViewId(next) && next !== view) {
        onViewChange(next);
      }
    };

    host.addEventListener("view-changed", handleViewChanged);
    host.addEventListener("start-date-changed", handleStartDateChanged);
    return () => {
      host.removeEventListener("view-changed", handleViewChanged);
      host.removeEventListener("start-date-changed", handleStartDateChanged);
    };
  }, [onViewChange, onStartDateChange, view, startDate]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !onCreateRequested) return;

    const handleCreateRequested = (event: Event) => {
      // Prefer dialog → save over optimistic adapter create.
      event.preventDefault();
      const detail = (
        event as CustomEvent<{
          envelope?: { calendarId?: string };
          content?: {
            start?: Temporal.PlainDateTime;
            end?: Temporal.PlainDateTime;
            allDay?: boolean;
            summary?: string;
          };
        }>
      ).detail;
      const start = detail?.content?.start;
      const end = detail?.content?.end;
      if (!start || !end) return;
      onCreateRequested({
        calendarId: detail.envelope?.calendarId,
        allDay: resolveCreateIntentAllDay({
          start,
          end,
          allDay: detail.content?.allDay,
        }),
        start,
        end,
        title: detail.content?.summary,
      });
    };

    host.addEventListener("event-create-requested", handleCreateRequested);
    return () => host.removeEventListener("event-create-requested", handleCreateRequested);
  }, [onCreateRequested]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !onRecurrenceFutureDelete) return;
    const handleFutureDelete = (event: Event) => {
      const detail = (
        event as CustomEvent<{ masterId?: string; recurrenceId?: string; allDay?: boolean }>
      ).detail;
      if (!detail?.masterId || !detail.recurrenceId) return;
      onRecurrenceFutureDelete({
        masterId: detail.masterId,
        recurrenceId: detail.recurrenceId,
        allDay: detail.allDay,
      });
    };
    host.addEventListener("recurrence-future-delete", handleFutureDelete);
    return () => host.removeEventListener("recurrence-future-delete", handleFutureDelete);
  }, [onRecurrenceFutureDelete]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !onRecurrenceFutureUpdate) return;
    const handleFutureUpdate = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          masterId?: string;
          recurrenceId?: string;
          allDay?: boolean;
          start?: Temporal.PlainDateTime;
          end?: Temporal.PlainDateTime;
          summary?: string;
          location?: string;
          calendarId?: string;
        }>
      ).detail;
      if (!detail?.masterId || !detail.recurrenceId || !detail.start || !detail.end) return;
      onRecurrenceFutureUpdate({
        masterId: detail.masterId,
        recurrenceId: detail.recurrenceId,
        allDay: detail.allDay,
        start: detail.start,
        end: detail.end,
        summary: detail.summary,
        location: detail.location,
        calendarId: detail.calendarId,
      });
    };
    host.addEventListener("recurrence-future-update", handleFutureUpdate);
    return () => host.removeEventListener("recurrence-future-update", handleFutureUpdate);
  }, [onRecurrenceFutureUpdate]);

  return createElement("wgw-calendar-surface", {
    ref: hostRef,
    class: "calendar-surface",
  });
}
