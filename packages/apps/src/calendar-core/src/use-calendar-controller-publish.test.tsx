import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";

const toastApi = {
  show: vi.fn(() => "toast-1"),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

const bootstrap = createCalendarAppBootstrap();

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

afterEach(() => {
  vi.useRealTimers();
});

describe("useCalendarController publish and delete", () => {
  beforeEach(() => {
    mockMatchMedia();
  });

  it("deletes a writable calendar through operations", async () => {
    const deleteCalendar = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          deleteCalendar,
        },
      }),
    );

    act(() => {
      result.current.openEditCalendarDialog("work");
    });
    expect(result.current.calendarDialog).toMatchObject({
      mode: "edit",
      calendarId: "work",
      mayDelete: true,
    });

    await act(async () => {
      result.current.deleteCalendarFromDialog();
    });

    expect(deleteCalendar).toHaveBeenCalledWith("work");
    expect(result.current.calendars.find((entry) => entry.id === "work")).toBeUndefined();
  });

  it("unsubscribes instead of deleting a subscription calendar", async () => {
    const unsubscribeCalendar = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          deleteCalendar: vi.fn(),
          unsubscribeCalendar,
        },
      }),
    );

    act(() => {
      result.current.openEditCalendarDialog("holidays");
    });
    expect(result.current.calendarDialog).toMatchObject({
      mode: "edit",
      subscriptionId: "sub-holidays",
    });

    await act(async () => {
      result.current.deleteCalendarFromDialog();
    });

    expect(unsubscribeCalendar).toHaveBeenCalledWith("sub-holidays");
    expect(result.current.calendars.find((entry) => entry.id === "holidays")).toBeUndefined();
  });
});
