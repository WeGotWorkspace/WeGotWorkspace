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

describe("useCalendarController publish feed", () => {
  beforeEach(() => {
    mockMatchMedia();
  });

  it("publishes and unpublishes through feed operations", async () => {
    const publishCalendarFeed = vi.fn().mockResolvedValue({
      httpsUrl: "https://example.test/api/v1/calendars/feeds/abc",
      webcalUrl: "webcal://example.test/api/v1/calendars/feeds/abc",
    });
    const unpublishCalendarFeed = vi.fn().mockResolvedValue(undefined);
    const getCalendarFeed = vi.fn().mockResolvedValue(null);

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          getCalendarFeed,
          publishCalendarFeed,
          unpublishCalendarFeed,
        },
      }),
    );

    await act(async () => {
      result.current.openEditCalendarDialog("default");
    });
    expect(getCalendarFeed).toHaveBeenCalledWith("default");

    await act(async () => {
      result.current.toggleCalendarPublish(true);
    });
    expect(publishCalendarFeed).toHaveBeenCalledWith("default");
    expect(result.current.publishFeed?.httpsUrl).toContain("/calendars/feeds/");

    await act(async () => {
      result.current.toggleCalendarPublish(false);
    });
    expect(unpublishCalendarFeed).toHaveBeenCalledWith("default");
    expect(result.current.publishFeed).toBeNull();
  });
});
