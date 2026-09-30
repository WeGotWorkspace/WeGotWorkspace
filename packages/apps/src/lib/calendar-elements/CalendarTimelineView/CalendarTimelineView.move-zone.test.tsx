import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CalendarEventsMap, type IANATimeZone } from "@/lib/calendar-engine";
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

describe("CalendarTimelineView zoned drag-move", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("converts a display-zone drag back into the event zone", async () => {
    const events: CalendarEventsMap = new Map([
      [
        "auckland-standup",
        {
          eventId: "auckland-standup@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2026-09-30T15:00:00"),
            end: Temporal.PlainDateTime.from("2026-09-30T16:00:00"),
            summary: "Auckland standup",
            timeZone: "Pacific/Auckland" as IANATimeZone,
          },
        },
      ],
    ]);
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "day";
    el.startDate = "2026-09-29";
    el.timezone = "America/Los_Angeles";
    el.events = events;
    document.body.append(el);
    await el.updateComplete;

    const timeline = el.shadowRoot?.querySelector("time-line.timeline-timed");
    expect(timeline).toBeInstanceOf(TimeLine);
    if (!(timeline instanceof TimeLine)) return;
    await timeline.updateComplete;

    const mapped = timeline.events[0];
    expect(mapped).toBeTruthy();
    const hourUnits = timeline.max / 24;
    const drafts: Array<{ start: string; end: string }> = [];
    el.addEventListener("event-times-draft", (event: Event) => {
      const detail = (
        event as CustomEvent<{ start: Temporal.PlainDateTime; end: Temporal.PlainDateTime } | null>
      ).detail;
      if (detail) {
        drafts.push({ start: detail.start.toString(), end: detail.end.toString() });
      }
    });

    timeline.dispatchEvent(
      new CustomEvent("timeline-event-move", {
        bubbles: true,
        composed: true,
        detail: {
          index: 0,
          start: mapped.start + hourUnits,
          end: mapped.end + hourUnits,
          previousStart: mapped.start,
          previousEnd: mapped.end,
        },
      }),
    );
    await el.updateComplete;

    expect(drafts.at(-1)).toEqual({
      start: "2026-09-30T16:00:00",
      end: "2026-09-30T17:00:00",
    });
  });
});
