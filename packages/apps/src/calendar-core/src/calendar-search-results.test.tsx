/** @vitest-environment jsdom */
import { Temporal } from "@js-temporal/polyfill";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CalendarSearchResultsList } from "@/calendar-core/src/calendar-search-results";
import { CALENDAR_SEARCH_PAGE_SIZE } from "@/calendar-core/src/calendar-search";
import type { CalendarOccurrence } from "@/calendar-core/src/calendar-event-model";
import type { CalendarListView } from "@/lib/calendar-elements/CalendarListView/CalendarListView";

function mockDomApis() {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView = vi.fn();
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
        searchRange={{ start: "2025-08-01T00:00:00", end: "2028-08-01T00:00:00" }}
        visibleCalendars={[{ id: "work", name: "Work", color: "#6366F1" }]}
        labels={defaultCalendarLabels}
        locale="en-US"
        onEventSelected={() => {}}
      />,
    );

    const list = document.querySelector("calendar-list-view") as CalendarListView | null;
    expect(list).toBeTruthy();
    await list?.updateComplete;
    expect(list?.events?.size).toBe(CALENDAR_SEARCH_PAGE_SIZE);
    expect(list?.showYearInHeadings).toBe(true);
    expect(list?.shadowRoot?.querySelector(".agenda-day-date")?.textContent).toMatch(/2026/);

    const scope = document.querySelector(".calendar-search-results__scope");
    const tags = [...(scope?.querySelectorAll(".tag") ?? [])].map((tag) => tag.textContent?.trim());
    expect(tags[0]).toMatch(/Aug 2025/);
    expect(tags.slice(1)).toContain("Work");

    expect(document.querySelector(".collection-list-end")).toBeTruthy();
    MockIntersectionObserver.last?.emit(true);

    await waitFor(() => {
      expect(list?.events?.size).toBe(150);
    });
    expect(document.querySelector(".collection-list-end")).toBeNull();
  });
});
