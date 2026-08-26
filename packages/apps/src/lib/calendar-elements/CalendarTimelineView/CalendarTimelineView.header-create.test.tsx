import { ContextProvider } from "@lit/context";
import { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventsAPIContext, type EventsAPIContextValue } from "../context/EventsAPIContext";
import type { EventCreateRequestDetail } from "../types/CalendarEventRequests";
import { CalendarTimelineView } from "./CalendarTimelineView";
import "./CalendarTimelineView";

function mockDomApis() {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

function stubEventsApi(): EventsAPIContextValue {
  const noop = () => undefined;
  return {
    getEvents: () => new Map(),
    getCalendars: () => new Map(),
    getCalendarAccounts: () => new Set(),
    getVisibleCalendarIds: () => undefined,
    getSelectedCalendarId: () => "cal-1",
    apply: noop,
    getApi: () => ({}) as EventsAPIContextValue["getApi"] extends () => infer T ? T : never,
    create: noop,
    update: noop,
    move: noop,
    resizeStart: noop,
    resizeEnd: noop,
    remove: noop,
    addExclusion: noop,
    removeExclusion: noop,
    addException: noop,
    removeException: noop,
  } as EventsAPIContextValue;
}

class TestEventsApiHost extends LitElement {
  constructor() {
    super();
    new ContextProvider(this, {
      context: eventsAPIContext,
      initialValue: stubEventsApi(),
    });
  }

  protected createRenderRoot() {
    return this;
  }
}

if (!customElements.get("test-events-api-host-header-create")) {
  customElements.define("test-events-api-host-header-create", TestEventsApiHost);
}

function mountView(mode: "day" | "week") {
  const host = document.createElement("test-events-api-host-header-create") as TestEventsApiHost;
  const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
  el.mode = mode;
  el.lang = "en-US";
  el.startDate = "2026-08-17";
  el.weekStart = 1;
  el.events = new Map();
  host.append(el);
  document.body.append(host);
  return el;
}

function firstWeekdayCreateButton(el: CalendarTimelineView) {
  const header = el.shadowRoot?.querySelector("calendar-weekday-header");
  return header?.shadowRoot?.querySelector(".weekday-create-button") as HTMLButtonElement | null;
}

describe("CalendarTimelineView day/week header + create", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it.each(["week", "day"] as const)(
    "opens all-day create from the %s weekday-header + button",
    async (mode) => {
      const el = mountView(mode);
      await el.updateComplete;

      const created = vi.fn((event: Event) => event.preventDefault());
      const selected = vi.fn();
      el.addEventListener("event-create-requested", created);
      el.addEventListener("day-selection", selected);

      const plus = firstWeekdayCreateButton(el);
      expect(plus).toBeTruthy();
      expect(plus!.ariaLabel).toMatch(/^Create event on .*August 17/);
      plus!.click();

      expect(selected).not.toHaveBeenCalled();
      expect(created).toHaveBeenCalledTimes(1);
      const event = created.mock.calls[0]?.[0] as CustomEvent<EventCreateRequestDetail>;
      expect(event.detail.content.allDay).toBe(true);
      expect(event.detail.content.start.toString()).toBe("2026-08-17T00:00:00");
      expect(event.detail.content.end.toString()).toBe("2026-08-18T00:00:00");
    },
  );
});
