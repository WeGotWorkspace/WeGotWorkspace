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

describe("useCalendarController publish sharee", () => {
  beforeEach(() => {
    mockMatchMedia();
  });

  it("does not offer publish on a write-sharee calendar", async () => {
    const getCalendarFeed = vi.fn();
    const { result } = renderHook(() =>
      useCalendarController({
        data: {
          ...bootstrap.data,
          calendars: [
            ...bootstrap.data.calendars,
            {
              id: "shared-write",
              name: "Shared write",
              color: "#14b8a6",
              mayWrite: true,
              mayShare: false,
              mayDelete: false,
            },
          ],
        },
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          getCalendarFeed,
          publishCalendarFeed: vi.fn(),
        },
      }),
    );

    await act(async () => {
      result.current.openEditCalendarDialog("shared-write");
    });
    expect(result.current.calendarDialog).toMatchObject({
      mode: "edit",
      calendarId: "shared-write",
      canPublish: false,
    });
    expect(getCalendarFeed).not.toHaveBeenCalled();
  });
});
