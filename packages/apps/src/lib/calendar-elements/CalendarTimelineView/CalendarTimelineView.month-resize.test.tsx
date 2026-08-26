import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { TimeLine } from "../TimeLine/TimeLine";
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
          end: Temporal.PlainDateTime.from("2026-08-18T10:00:00"),
          summary: "Standup",
          color: "#6366f1",
        },
      },
    ],
    [
      "review",
      {
        eventId: "review@example.test",
        data: {
          start: Temporal.PlainDateTime.from("2026-08-19T11:00:00"),
          end: Temporal.PlainDateTime.from("2026-08-19T12:00:00"),
          summary: "Review",
          color: "#0f766e",
        },
      },
    ],
  ]);
}

describe("CalendarTimelineView month resize", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("keeps month timelines resizable without mounting a handle per card", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "month";
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = sampleEvents();
    document.body.append(el);
    await el.updateComplete;

    const timeline = el.shadowRoot?.querySelector("time-line.timeline-main");
    expect(timeline).toBeInstanceOf(TimeLine);
    if (!(timeline instanceof TimeLine)) return;

    expect(timeline.resizeHandles).toBe(true);
    expect(timeline.shadowRoot?.querySelectorAll(".event").length).toBeGreaterThan(1);
    expect(timeline.shadowRoot?.querySelectorAll("resize-handle")).toHaveLength(0);

    el.selectedEventKey = "standup";
    await el.updateComplete;
    await timeline.updateComplete;

    const selected = timeline.shadowRoot?.querySelector(".event.event--selected");
    expect(selected?.querySelectorAll("resize-handle").length).toBeGreaterThan(0);
    expect(timeline.shadowRoot?.querySelectorAll("resize-handle").length).toBeLessThan(4);
  });

  it("keeps compact month view-only (no resize handles)", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "month";
    el.forceCompact = true;
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = sampleEvents();
    el.selectedEventKey = "standup";
    document.body.append(el);
    await el.updateComplete;

    const timeline = el.shadowRoot?.querySelector("time-line.timeline-main");
    expect(timeline).toBeInstanceOf(TimeLine);
    if (!(timeline instanceof TimeLine)) return;
    expect(timeline.resizeHandles).toBe(false);
    expect(timeline.shadowRoot?.querySelectorAll("resize-handle")).toHaveLength(0);
  });
});
