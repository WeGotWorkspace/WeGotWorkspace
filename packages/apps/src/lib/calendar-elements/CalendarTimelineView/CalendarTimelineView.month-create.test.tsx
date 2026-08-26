import { Temporal } from "@js-temporal/polyfill";
import { ContextProvider } from "@lit/context";
import { LitElement } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
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
  } as unknown as EventsAPIContextValue;
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

if (!customElements.get("test-events-api-host")) {
  customElements.define("test-events-api-host", TestEventsApiHost);
}

function mountMonthView(events: CalendarEventsMap = new Map()) {
  const host = document.createElement("test-events-api-host") as TestEventsApiHost;
  const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
  el.mode = "month";
  el.lang = "en-US";
  el.startDate = "2026-08-01";
  el.weekStart = 1;
  el.events = events;
  host.append(el);
  document.body.append(host);
  return { host, el };
}

function monthHeaderButtons(el: CalendarTimelineView) {
  const timeline = el.shadowRoot?.querySelector("time-line");
  return [...(timeline?.shadowRoot?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
}

function monthDayButton(el: CalendarTimelineView, dayLabel: string, outsideMonth = false) {
  return monthHeaderButtons(el).find((button) => {
    const label = button.ariaLabel ?? "";
    if (label.startsWith("Create event")) return false;
    const isOutside = Boolean(button.closest(".is-outside-month"));
    return label.includes(dayLabel) && isOutside === outsideMonth;
  });
}

function monthDayCreateButton(el: CalendarTimelineView, dayLabel: string) {
  return monthHeaderButtons(el).find((button) => {
    const label = button.ariaLabel ?? "";
    return label.startsWith("Create event") && label.includes(dayLabel);
  });
}

describe("CalendarTimelineView month double-click and header + create", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("emits day-selection from an empty month day-number click, not create", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { el } = mountMonthView();
    await el.updateComplete;

    const created = vi.fn((event: Event) => event.preventDefault());
    const selected = vi.fn();
    el.addEventListener("event-create-requested", created);
    el.addEventListener("day-selection", selected);

    const emptyDay = monthDayButton(el, "August 18");
    expect(emptyDay).toBeTruthy();
    emptyDay!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );

    expect(created).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(created).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledTimes(1);
    const event = selected.mock.calls[0]?.[0] as CustomEvent<{ date?: string }>;
    expect(event.detail.date).toBe("2026-08-18");
  });

  it("emits day-selection from Enter on an empty month day-number, not create", async () => {
    const { el } = mountMonthView();
    await el.updateComplete;

    const created = vi.fn((event: Event) => event.preventDefault());
    const selected = vi.fn();
    el.addEventListener("event-create-requested", created);
    el.addEventListener("day-selection", selected);

    const emptyDay = monthDayButton(el, "August 18");
    expect(emptyDay).toBeTruthy();
    emptyDay!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }),
    );

    expect(created).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledTimes(1);
    const event = selected.mock.calls[0]?.[0] as CustomEvent<{ date?: string }>;
    expect(event.detail.date).toBe("2026-08-18");
  });

  it("opens all-day create from an empty month day-number double-click without navigating", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { el } = mountMonthView();
    await el.updateComplete;

    const created = vi.fn((event: Event) => event.preventDefault());
    const selected = vi.fn();
    el.addEventListener("event-create-requested", created);
    el.addEventListener("day-selection", selected);

    const emptyDay = monthDayButton(el, "August 18");
    expect(emptyDay).toBeTruthy();
    emptyDay!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
    emptyDay!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 }),
    );
    emptyDay!.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }),
    );

    expect(created).toHaveBeenCalledTimes(1);
    const event = created.mock.calls[0]?.[0] as CustomEvent<EventCreateRequestDetail>;
    expect(event.composed).toBe(true);
    expect(event.detail.content.allDay).toBe(true);
    expect(event.detail.content.start.toString()).toBe("2026-08-18T00:00:00");
    expect(event.detail.content.end.toString()).toBe("2026-08-19T00:00:00");
    await vi.advanceTimersByTimeAsync(400);
    expect(selected).not.toHaveBeenCalled();
  });

  it("opens all-day create from the month header + button", async () => {
    const { el } = mountMonthView();
    await el.updateComplete;

    const created = vi.fn((event: Event) => event.preventDefault());
    const selected = vi.fn();
    el.addEventListener("event-create-requested", created);
    el.addEventListener("day-selection", selected);

    const plus = monthDayCreateButton(el, "August 18");
    expect(plus).toBeTruthy();
    expect(plus!.ariaLabel).toMatch(/^Create event on .*August 18/);
    plus!.click();

    expect(selected).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledTimes(1);
    const event = created.mock.calls[0]?.[0] as CustomEvent<EventCreateRequestDetail>;
    expect(event.detail.content.allDay).toBe(true);
    expect(event.detail.content.start.toString()).toBe("2026-08-18T00:00:00");
  });

  it("emits create from the header + even without an Events API context", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "month";
    el.lang = "en-US";
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = new Map();
    document.body.append(el);
    await el.updateComplete;

    const created = vi.fn((event: Event) => event.preventDefault());
    el.addEventListener("event-create-requested", created);

    const plus = monthDayCreateButton(el, "August 18");
    expect(plus).toBeTruthy();
    plus!.click();

    expect(created).toHaveBeenCalledTimes(1);
    const event = created.mock.calls[0]?.[0] as CustomEvent<EventCreateRequestDetail>;
    expect(event.detail.content.allDay).toBe(true);
    expect(event.detail.content.start.toString()).toBe("2026-08-18T00:00:00");
  });

  it("keeps day-selection for a month day that already has events", async () => {
    const { el } = mountMonthView(
      new Map([
        [
          "standup",
          {
            eventId: "standup@example.test",
            data: {
              start: Temporal.PlainDateTime.from("2026-08-18T09:00:00"),
              end: Temporal.PlainDateTime.from("2026-08-18T09:30:00"),
              summary: "Standup",
              color: "#6366f1",
            },
          },
        ],
      ]),
    );
    await el.updateComplete;

    const created = vi.fn((event: Event) => event.preventDefault());
    const selected = vi.fn();
    el.addEventListener("event-create-requested", created);
    el.addEventListener("day-selection", selected);

    const busyDay = monthDayButton(el, "August 18");
    expect(busyDay).toBeTruthy();
    busyDay!.click();

    expect(created).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledTimes(1);
    const event = selected.mock.calls[0]?.[0] as CustomEvent<{ date?: string }>;
    expect(event.detail.date).toBe("2026-08-18");
  });
});
