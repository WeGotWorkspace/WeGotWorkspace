import { createElement, useEffect, useRef } from "react";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { WgwCalendarSurface } from "@/lib/calendar-elements/wgw/wgw-calendar-surface";
import "@/lib/calendar-elements/wgw/wgw-calendar-surface";
import type { EventsAPIContextValue } from "@/lib/calendar-elements/context/EventsAPIContext";

export type CalendarSurfaceProps = {
  view: "day" | "week" | "month" | "year";
  presentation: "grid" | "list";
  /** ISO date for the view anchor (view-group aligns its own grid start). */
  startDate: string;
  events: CalendarEventsMap;
  visibleCalendarIds?: string[];
  selectedCalendarId?: string;
  contextValue?: EventsAPIContextValue;
  onEventSelected?: (key: string) => void;
};

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
  }, [view, presentation, startDate, events, visibleCalendarIds, selectedCalendarId, contextValue]);

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

  return createElement("wgw-calendar-surface", {
    ref: hostRef,
    class: "calendar-surface",
  });
}
