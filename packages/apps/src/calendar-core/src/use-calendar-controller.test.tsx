import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const bootstrap = createCalendarAppBootstrap();

describe("useCalendarController view + create intent", () => {
  beforeEach(() => {
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
  });

  it("selectView updates view used by the dropdown", () => {
    const { result } = renderHook(() =>
      useCalendarController({ data: bootstrap.data, initialView: "month" }),
    );

    act(() => {
      result.current.selectView("day");
    });

    expect(result.current.view).toBe("day");
    expect(result.current.litSurface).toEqual({ view: "day", presentation: "grid" });
  });

  it("selectView is a no-op when the view is unchanged (no duplicate onViewChange)", () => {
    const onViewChange = vi.fn();
    const { result } = renderHook(() =>
      useCalendarController({ data: bootstrap.data, initialView: "week", onViewChange }),
    );

    act(() => {
      result.current.selectView("week");
    });

    expect(onViewChange).not.toHaveBeenCalled();
  });

  it("keeps the sidebar open on desktop when the view changes", () => {
    const { result } = renderHook(() =>
      useCalendarController({ data: bootstrap.data, initialView: "month" }),
    );

    expect(result.current.sidebarOpen).toBe(true);

    act(() => {
      result.current.selectView("day");
    });

    expect(result.current.sidebarOpen).toBe(true);
  });

  it("openCreateFromSurface opens a create editor without calling operations", () => {
    const createEvent = vi.fn();
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent,
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
        },
      }),
    );

    act(() => {
      result.current.openCreateFromSurface({
        calendarId: "work",
        allDay: false,
        start: Temporal.PlainDateTime.from("2033-01-12T10:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
      });
    });

    expect(createEvent).not.toHaveBeenCalled();
    expect(result.current.editor).toMatchObject({
      mode: "create",
      form: {
        calendarId: "work",
        startDate: "2033-01-12",
        startTime: "10:00",
        endDate: "2033-01-12",
        endTime: "11:00",
      },
    });
  });
});
