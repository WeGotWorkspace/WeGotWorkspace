import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
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

function weekEvents(): CalendarEventsMap {
  return new Map([
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
    [
      "holiday",
      {
        eventId: "holiday@example.test",
        data: {
          start: Temporal.PlainDateTime.from("2026-08-18T00:00:00"),
          end: Temporal.PlainDateTime.from("2026-08-19T00:00:00"),
          summary: "Holiday",
          color: "#8b5cf6",
          allDay: true,
        },
      },
    ],
  ]);
}

async function mountWeekView() {
  const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
  el.mode = "week";
  el.allDayRow = true;
  el.startDate = "2026-08-17";
  el.weekStart = 1;
  el.lang = "en-US";
  el.snapInterval = 15;
  el.events = weekEvents();
  el.style.width = "960px";
  el.style.height = "720px";
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function eventCardIn(timeline: Element | null | undefined, key: string) {
  const root = timeline instanceof HTMLElement ? timeline.shadowRoot : null;
  return root?.querySelector(`event-card[data-event-id="${key}"]`) ?? null;
}

describe("CalendarTimelineView week event select", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("emits event-selected from a timed grid card and an all-day row card", async () => {
    const el = await mountWeekView();
    const selected = vi.fn();
    el.addEventListener("event-selected", selected);

    const timedCard = eventCardIn(
      el.shadowRoot?.querySelector("time-line.timeline-timed"),
      "standup",
    );
    const allDayCard = eventCardIn(
      el.shadowRoot?.querySelector("time-line.timeline-all-day"),
      "holiday",
    );
    expect(timedCard).toBeInstanceOf(HTMLElement);
    expect(allDayCard).toBeInstanceOf(HTMLElement);
    if (!(timedCard instanceof HTMLElement) || !(allDayCard instanceof HTMLElement)) return;

    timedCard.click();
    expect(selected).toHaveBeenCalledTimes(1);
    expect((selected.mock.calls[0]?.[0] as CustomEvent).detail?.key).toBe("standup");

    allDayCard.click();
    expect(selected).toHaveBeenCalledTimes(2);
    expect((selected.mock.calls[1]?.[0] as CustomEvent).detail?.key).toBe("holiday");
  });
});
