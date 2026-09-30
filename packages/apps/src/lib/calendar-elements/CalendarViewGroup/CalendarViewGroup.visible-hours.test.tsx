import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CalendarTimelineView } from "../CalendarTimelineView/CalendarTimelineView";
import { CalendarViewGroup } from "./CalendarViewGroup";
import "./CalendarViewGroup";

function mockDomApis() {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

describe("CalendarViewGroup visibleHours", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("forwards visibleHours onto the day/week timeline", async () => {
    const el = document.createElement("calendar-view-group") as CalendarViewGroup;
    el.view = "week";
    el.startDate = "2033-01-12";
    el.visibleHours = 12;
    el.visibleHoursStart = 8;
    document.body.append(el);
    await el.updateComplete;
    const timeline = el.shadowRoot?.querySelector(
      "calendar-timeline-view",
    ) as CalendarTimelineView | null;
    expect(timeline).toBeTruthy();
    expect(timeline!.visibleHours).toBe(12);
    expect(timeline!.visibleHoursStart).toBe(8);
  });
});
