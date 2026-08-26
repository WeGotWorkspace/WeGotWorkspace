import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { readCalendarViewPrefs } from "@/calendar-core/src/calendar-view-prefs";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const bootstrap = createCalendarAppBootstrap();

describe("useCalendarController device prefs", () => {
  beforeEach(() => {
    window.localStorage.clear();
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

  it("restores hidden calendars from device prefs after remount", () => {
    const first = renderHook(() => useCalendarController({ data: bootstrap.data }));
    act(() => {
      first.result.current.toggleCalendarVisibility("work");
      first.result.current.toggleCalendarVisibility("family");
    });
    expect([...first.result.current.hiddenCalendarIds].sort()).toEqual(["family", "work"]);
    first.unmount();

    const second = renderHook(() => useCalendarController({ data: bootstrap.data }));
    expect([...second.result.current.hiddenCalendarIds].sort()).toEqual(["family", "work"]);
    expect(second.result.current.visibleCalendarIds.has("work")).toBe(false);
    expect(second.result.current.visibleCalendarIds.has("default")).toBe(true);
  });

  it("persists last view and presentation for the next visit", () => {
    const { result } = renderHook(() =>
      useCalendarController({ data: bootstrap.data, initialView: "month" }),
    );

    act(() => {
      result.current.selectView("week");
      result.current.setPresentation("list");
    });

    expect(readCalendarViewPrefs()).toMatchObject({
      view: "week",
      presentation: "list",
    });
  });
});
