import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { filterVisibleCalendarEventsKeepingOverlay } from "@/lib/calendar/calendar-render-overlay";
import type { CalendarAPIOperations, CalendarUIData } from "@/lib/models/calendar-types";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";

const filter = vi.hoisted(() => ({ projectId: null as string | null }));

vi.mock("@/lib/projects/use-project-filter", () => ({
  useSelectedProjectId: () => filter.projectId,
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

function mockMatchMedia() {
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

/** "work" is Project p-1's calendar; "family" (shared with me) belongs to p-2. */
function projectData(): CalendarUIData {
  const data = createCalendarAppBootstrap().data;
  return {
    ...data,
    calendars: data.calendars.map((calendar) =>
      calendar.id === "work"
        ? { ...calendar, projectId: "p-1" }
        : calendar.id === "family"
          ? { ...calendar, projectId: "p-2" }
          : calendar,
    ),
  };
}

const operations = {
  createCalendar: vi.fn(),
  subscribeCalendar: vi.fn(),
} as unknown as CalendarAPIOperations;

function shownEventCalendarIds(data: CalendarUIData, visible: ReadonlySet<string>): string[] {
  const shown = filterVisibleCalendarEventsKeepingOverlay(
    calendarEventsToEngineMap(data.events, { calendars: data.calendars }),
    [...visible],
  );
  return [...new Set([...shown.values()].map((event) => event.calendarId ?? ""))].sort();
}

describe("useCalendarController under the Project filter", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockMatchMedia();
    filter.projectId = null;
  });

  it("All Projects lists every calendar and shows every calendar's events", () => {
    const data = projectData();
    const { result } = renderHook(() => useCalendarController({ data, operations }));
    expect(result.current.calendars.map((c) => c.id).sort()).toEqual(
      data.calendars.map((c) => c.id).sort(),
    );
    expect(shownEventCalendarIds(data, result.current.visibleCalendarIds)).toEqual([
      "default",
      "family",
      "holidays",
      "work",
    ]);
    expect(result.current.canCreateCalendar).toBe(true);
    expect(result.current.canSubscribeCalendar).toBe(true);
  });

  it("a Project narrows the sidebar calendars and the events to its calendar", () => {
    filter.projectId = "p-1";
    const data = projectData();
    const { result } = renderHook(() => useCalendarController({ data, operations }));
    expect(result.current.calendars.map((c) => c.id)).toEqual(["work"]);
    expect([...result.current.visibleCalendarIds]).toEqual(["work"]);
    expect(shownEventCalendarIds(data, result.current.visibleCalendarIds)).toEqual(["work"]);
    expect(result.current.defaultCalendarId).toBe("work");
  });

  it("hides New calendar and Subscribe while a Project is selected", () => {
    filter.projectId = "p-1";
    const data = projectData();
    const { result } = renderHook(() => useCalendarController({ data, operations }));
    expect(result.current.canCreateCalendar).toBe(false);
    expect(result.current.canSubscribeCalendar).toBe(false);
    act(() => result.current.openCreateCalendarDialog());
    expect(result.current.calendarDialog).toBeNull();
  });

  it("keeps calendars hidden by toggle when switching back to All Projects", () => {
    const data = projectData();
    const { result, rerender } = renderHook(() => useCalendarController({ data, operations }));
    act(() => result.current.toggleCalendarVisibility("default"));
    filter.projectId = "p-1";
    rerender();
    expect([...result.current.visibleCalendarIds]).toEqual(["work"]);
    filter.projectId = null;
    rerender();
    expect(result.current.hiddenCalendarIds.has("default")).toBe(true);
    expect(result.current.visibleCalendarIds.has("default")).toBe(false);
    expect(result.current.visibleCalendarIds.has("work")).toBe(true);
  });

  it("does not open the calendar dialog for a Project calendar", () => {
    const data = projectData();
    const { result } = renderHook(() => useCalendarController({ data, operations }));
    act(() => result.current.openEditCalendarDialog("work"));
    expect(result.current.calendarDialog).toBeNull();
    act(() => result.current.openEditCalendarDialog("default"));
    expect(result.current.calendarDialog?.mode).toBe("edit");
  });
});
