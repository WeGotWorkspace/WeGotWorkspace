import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
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

describe("CalendarListView empty state", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("uses CollectionState chrome with a label under the icon", async () => {
    const el = document.createElement("calendar-list-view") as CalendarListView;
    el.startDate = "2033-01-01";
    el.events = new Map();
    document.body.append(el);
    await el.updateComplete;

    const root = el.shadowRoot;
    expect(root?.querySelector(".collection-state-host")).toBeTruthy();
    expect(root?.querySelector(".collection-state__icon")).toBeTruthy();
    expect(root?.querySelector(".collection-state__body")?.textContent).toBe(
      defaultCalendarLabels.noEventsInRange,
    );
    expect(root?.querySelector(".agenda-empty")).toBeNull();
  });
});
