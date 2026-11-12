/** @vitest-environment jsdom */
import { Temporal } from "@js-temporal/polyfill";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarSearchResultsList } from "@/calendar-core/src/calendar-search-results";
import { CALENDAR_SEARCH_PAGE_SIZE } from "@/calendar-core/src/calendar-search";
import type { CalendarOccurrence } from "@/calendar-core/src/calendar-event-model";

function mockDomApis() {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView = vi.fn();
  // The list asks whether this is a touch screen.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

class MockIntersectionObserver {
  static last: MockIntersectionObserver | null = null;

  constructor(private callback: IntersectionObserverCallback) {
    MockIntersectionObserver.last = this;
  }

  observe() {}

  disconnect() {}

  emit(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as never);
  }
}

function upcomingHits(count: number): CalendarOccurrence[] {
  return Array.from({ length: count }, (_, index) => {
    const start = Temporal.PlainDateTime.from("2026-08-27T10:00:00").add({ minutes: index });
    return {
      key: `hit-${index}`,
      eventId: `hit-${index}`,
      calendarId: "work",
      title: "Overflow standup",
      color: "#6366F1",
      allDay: false,
      isRecurring: false,
      start,
      end: start.add({ minutes: 30 }),
    };
  });
}

describe("CalendarSearchResultsList paging", () => {
  beforeEach(() => {
    mockDomApis();
    MockIntersectionObserver.last = null;
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("paints at most 100 hits then appends the next page when the list end intersects", async () => {
    const upcoming = upcomingHits(150);
    render(
      <CalendarSearchResultsList
        results={{ upcoming, past: [] }}
        calendars={[{ id: "work", name: "Work", color: "#6366F1" }]}
        labels={defaultCalendarLabels}
        locale="en-US"
        selection={{ selectedIds: [], selectionMode: false, onItemClick: () => {} }}
      />,
    );

    const rows = () => document.querySelectorAll(".calendar-search-results [data-list-item-id]");
    expect(rows()).toHaveLength(CALENDAR_SEARCH_PAGE_SIZE);
    // Results span years: the day headings carry the year.
    expect(document.querySelector(".calendar-search-results")?.textContent).toMatch(/2026/);
    // No scope tags above the results.
    expect(document.querySelector(".calendar-search-results__scope")).toBeNull();
    expect(document.querySelector(".calendar-search-results .tag")).toBeNull();

    expect(document.querySelector(".collection-list-end")).toBeTruthy();
    MockIntersectionObserver.last?.emit(true);

    await waitFor(() => {
      expect(rows()).toHaveLength(150);
    });
    expect(document.querySelector(".collection-list-end")).toBeNull();
  });
});
