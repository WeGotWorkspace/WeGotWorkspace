import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar-engine";
import { CalendarListView } from "./CalendarListView";
import "./CalendarListView";

function mockDomApis() {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

function instance(id: string, start: string, summary: string): CalendarEvent {
  const startDt = Temporal.PlainDateTime.from(start);
  return {
    calendarId: "work",
    eventId: id,
    data: {
      start: startDt,
      end: startDt.add({ hours: 1 }),
      summary,
    },
  };
}

describe("CalendarListView event set", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders instances outside the 366-day agenda window", async () => {
    const el = document.createElement("calendar-list-view") as CalendarListView;
    el.useEventSet = true;
    el.startDate = "2026-08-26";
    el.events = new Map([
      ["near", instance("near", "2026-08-26T10:00:00", "Near")],
      ["far", instance("far", "2028-07-01T10:00:00", "Far")],
    ]);
    document.body.append(el);
    await el.updateComplete;

    const headings = [...(el.shadowRoot?.querySelectorAll(".agenda-day-heading") ?? [])].map(
      (node) => node.getAttribute("aria-label"),
    );
    expect(headings.some((label) => label?.includes("August 26"))).toBe(true);
    expect(headings.some((label) => label?.includes("July 1"))).toBe(true);
    expect(el.shadowRoot?.querySelectorAll(".agenda-event-item")).toHaveLength(2);
  });

  it("can order days newest-first", async () => {
    const el = document.createElement("calendar-list-view") as CalendarListView;
    el.useEventSet = true;
    el.sortDirection = "desc";
    el.events = new Map([
      ["older", instance("older", "2026-08-01T10:00:00", "Older")],
      ["newer", instance("newer", "2026-08-20T10:00:00", "Newer")],
    ]);
    document.body.append(el);
    await el.updateComplete;

    const summaries = [...(el.shadowRoot?.querySelectorAll("event-card") ?? [])].map(
      (card) => (card as HTMLElement & { summary?: string }).summary,
    );
    expect(summaries).toEqual(["Newer", "Older"]);
  });

  it("renders expanded search instances that carry end instead of duration", async () => {
    const el = document.createElement("calendar-list-view") as CalendarListView;
    el.useEventSet = true;
    const start = Temporal.PlainDateTime.from("2026-08-31T13:00:00");
    el.events = new Map([
      [
        "dev-seed-0013::20260831T130000",
        {
          calendarId: "default",
          eventId: "dev-seed-0013",
          isRecurring: true,
          data: {
            start,
            end: start.add({ hours: 1 }),
            summary: "Focus block",
          },
        },
      ],
    ]);
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll(".agenda-event-item")).toHaveLength(1);
    expect(el.shadowRoot?.querySelector("event-card")).toMatchObject({ summary: "Focus block" });
  });

  it("scrolls the matching occurrence to the start of the agenda", async () => {
    const el = document.createElement("calendar-list-view") as CalendarListView;
    el.useEventSet = true;
    el.events = new Map([
      ["past", instance("past", "2026-08-01T10:00:00", "Past")],
      ["upcoming", instance("upcoming", "2026-08-20T10:00:00", "Upcoming")],
    ]);
    document.body.append(el);
    await el.updateComplete;

    const item = el.shadowRoot?.querySelector("[data-event-key='upcoming']");
    expect(item).toBeInstanceOf(HTMLElement);
    const scrollIntoView = vi.fn();
    (item as HTMLElement).scrollIntoView = scrollIntoView;
    el.scrollToEvent("upcoming");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });
});
