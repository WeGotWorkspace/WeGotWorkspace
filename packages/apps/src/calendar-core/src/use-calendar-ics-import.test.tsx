import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { useCalendarIcsImport } from "@/calendar-core/src/use-calendar-ics-import";

const toastApi = {
  show: vi.fn(() => "toast-1"),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  dismiss: vi.fn(),
};

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toastApi,
}));

describe("useCalendarIcsImport", () => {
  beforeEach(() => {
    toastApi.show.mockClear();
    toastApi.showError.mockClear();
  });

  it("imports into an existing calendar and toasts success", async () => {
    const importEvents = vi.fn().mockResolvedValue({
      list: [{ id: "imported-1", title: "Imported" }],
      errors: [],
    });
    const { result } = renderHook(() =>
      useCalendarIcsImport({
        labels: defaultCalendarLabels,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
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
        mode: "existing",
        calendarId: "default",
      });
    });

    expect(importEvents).toHaveBeenCalledWith("BEGIN:VCALENDAR", { calendarId: "default" });
    expect(toastApi.show).toHaveBeenCalledWith(defaultCalendarLabels.toastImportSuccess);
    expect(result.current.importFile).toBeNull();
    expect(result.current.importDialogOpen).toBe(false);
  });

  it("shows a callout and toast when import fails", async () => {
    const importEvents = vi.fn().mockRejectedValue(new Error("No VEVENT data found."));
    const { result } = renderHook(() =>
      useCalendarIcsImport({
        labels: defaultCalendarLabels,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          importEvents,
        },
      }),
    );

    const file = new File(["garbage"], "bad.ics");
    act(() => {
      result.current.beginImport(file);
    });
    await act(async () => {
      result.current.submitImportDialog(file, {
        mode: "existing",
        calendarId: "default",
      });
    });

    expect(result.current.importDialogError).toBe("No VEVENT data found.");
    expect(toastApi.showError).toHaveBeenCalledWith(defaultCalendarLabels.toastImportFailed);
    expect(result.current.importDialogOpen).toBe(true);
  });

  it("creates a destination calendar then imports", async () => {
    const onCalendarCreated = vi.fn();
    const createCalendar = vi.fn().mockResolvedValue({
      id: "travel",
      name: "Travel",
      color: "#22c55e",
      mayWrite: true,
    });
    const importEvents = vi.fn().mockResolvedValue({ list: [{ id: "imported-1" }], errors: [] });
    const { result } = renderHook(() =>
      useCalendarIcsImport({
        labels: defaultCalendarLabels,
        onCalendarCreated,
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

    expect(createCalendar).toHaveBeenCalledWith({ name: "Travel", color: "#22c55e" });
    expect(importEvents).toHaveBeenCalledWith("BEGIN:VCALENDAR", { calendarId: "travel" });
    expect(onCalendarCreated).toHaveBeenCalledWith({
      id: "travel",
      name: "Travel",
      color: "#22c55e",
      mayWrite: true,
    });
  });

  it("toasts an offline error", async () => {
    const importEvents = vi
      .fn()
      .mockRejectedValue(new Error("ICS import requires an internet connection"));
    const { result } = renderHook(() =>
      useCalendarIcsImport({
        labels: defaultCalendarLabels,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
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
        mode: "existing",
        calendarId: "default",
      });
    });

    expect(toastApi.showError).toHaveBeenCalledWith(defaultCalendarLabels.toastImportOffline);
    expect(result.current.importDialogError).toContain("internet");
  });
});
