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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCalendarController sidebar revoke", () => {
  beforeEach(() => {
    mockMatchMedia();
  });

  it("drops a revoked calendar from the sidebar and falls back the selection", () => {
    const { result, rerender } = renderHook(({ data }) => useCalendarController({ data }), {
      initialProps: { data: bootstrap.data },
    });

    act(() => {
      result.current.selectDefaultCalendar("family");
      result.current.openEditCalendarDialog("work");
    });
    expect(result.current.defaultCalendarId).toBe("family");
    expect(result.current.calendarDialog).toMatchObject({ mode: "edit", calendarId: "work" });

    rerender({
      data: {
        ...bootstrap.data,
        calendars: bootstrap.data.calendars.filter(
          (calendar) => calendar.id !== "family" && calendar.id !== "work",
        ),
      },
    });

    expect(result.current.calendars.find((calendar) => calendar.id === "family")).toBeUndefined();
    expect(result.current.calendars.find((calendar) => calendar.id === "work")).toBeUndefined();
    expect(result.current.defaultCalendarId).toBe("default");
    expect(result.current.calendarDialog).toBeNull();
  });
});

describe("useCalendarController ICS import", () => {
  beforeEach(() => {
    mockMatchMedia();
  });

  it("adds a created import destination to the sidebar calendars", async () => {
    const createCalendar = vi.fn().mockResolvedValue({
      id: "travel",
      name: "Travel",
      color: "#22c55e",
      mayWrite: true,
    });
    const importEvents = vi.fn().mockResolvedValue({ list: [{ id: "imported-1" }], errors: [] });
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          createCalendar,
          importEvents,
        },
      }),
    );

    const file = new File(["BEGIN:VCALENDAR"], "events.ics");
    act(() => {
      result.current.beginImport(file);
    });
    await act(async () => {
      result.current.submitImportDialog(file, {
        mode: "create",
        name: "Travel",
        color: "#22c55e",
      });
    });

    expect(result.current.calendars.some((calendar) => calendar.id === "travel")).toBe(true);
  });
});
