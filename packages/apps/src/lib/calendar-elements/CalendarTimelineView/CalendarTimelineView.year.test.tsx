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

function sampleEvents(): CalendarEventsMap {
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
  ]);
}

describe("CalendarTimelineView year mode", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("does not mount nested timelines, event cards, or resize handles", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "year";
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = sampleEvents();
    document.body.append(el);
    await el.updateComplete;

    const root = el.shadowRoot;
    expect(root?.querySelectorAll("calendar-timeline-view")).toHaveLength(0);
    expect(root?.querySelectorAll("time-line")).toHaveLength(0);
    expect(root?.querySelectorAll("event-card")).toHaveLength(0);
    expect(root?.querySelectorAll("resize-handle")).toHaveLength(0);
    expect(root?.querySelectorAll(".year-days")).toHaveLength(12);
    expect(root?.querySelectorAll("button.year-day").length).toBe(12 * 42);
    expect(root?.querySelectorAll(".year-day-dot").length).toBeGreaterThan(0);
  });

  it("emits composed day-selection from an empty year day", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "year";
    el.lang = "en-US";
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = new Map();
    document.body.append(el);
    await el.updateComplete;

    const selected = vi.fn();
    el.addEventListener("day-selection", selected);
    const august = [...(el.shadowRoot?.querySelectorAll(".month-card") ?? [])].find((card) =>
      card.querySelector(".month-title")?.textContent?.includes("August"),
    );
    const emptyDay = [...(august?.querySelectorAll("button.year-day") ?? [])].find(
      (button) =>
        button.querySelector(".year-day-number")?.textContent?.trim() === "18" &&
        !button.classList.contains("is-outside-month"),
    );
    expect(emptyDay).toBeTruthy();
    (emptyDay as HTMLButtonElement).click();

    expect(selected).toHaveBeenCalledTimes(1);
    const event = selected.mock.calls[0]?.[0] as CustomEvent<{ date?: string }>;
    expect(event.composed).toBe(true);
    expect(event.detail.date).toBe("2026-08-18");
  });
});
