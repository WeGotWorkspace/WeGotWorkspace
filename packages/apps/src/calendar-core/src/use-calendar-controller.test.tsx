import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
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
    expect(result.current.presentation).toBe("grid");
    expect(result.current.litSurface).toEqual({ view: "day", presentation: "grid" });
  });

  it("setPresentation switches list/grid without changing the time-range view", () => {
    const { result } = renderHook(() =>
      useCalendarController({ data: bootstrap.data, initialView: "week" }),
    );

    act(() => {
      result.current.setPresentation("list");
    });

    expect(result.current.view).toBe("week");
    expect(result.current.presentation).toBe("list");
    expect(result.current.litSurface).toEqual({ view: "week", presentation: "list" });

    act(() => {
      result.current.selectView("month");
    });

    expect(result.current.view).toBe("month");
    expect(result.current.presentation).toBe("list");
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
        allDay: false,
        startDate: "2033-01-12",
        startTime: "10:00",
        endDate: "2033-01-12",
        endTime: "11:00",
      },
    });
  });

  it("openEditEventKey asks scope then opens the editor for a recurring occurrence", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCalendarController({ data: bootstrap.data }));

    let openPromise: Promise<void>;
    act(() => {
      openPromise = result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });

    expect(result.current.editor).toBeNull();
    expect(result.current.recurrenceScopeDialog).toBeNull();

    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.recurrenceScopeDialog).not.toBeNull();
    expect(result.current.recurrenceScopeDialog?.action).toBe("edit");
    expect(result.current.editor).toBeNull();

    await act(async () => {
      result.current.recurrenceScopeDialog?.resolve("thisInstance");
      await openPromise!;
    });

    expect(result.current.recurrenceScopeDialog).toBeNull();
    expect(result.current.editor).toMatchObject({
      mode: "edit",
      eventId: "standup",
      recurrenceId: "2033-01-12T09:30:00",
      recurrenceScope: "thisInstance",
    });

    vi.useRealTimers();
  });

  it("openEditEventKey cancel on scope leaves the editor closed", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCalendarController({ data: bootstrap.data }));

    let openPromise: Promise<void>;
    act(() => {
      openPromise = result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });

    await act(async () => {
      vi.runAllTimers();
    });

    await act(async () => {
      result.current.recurrenceScopeDialog?.resolve(null);
      await openPromise!;
    });

    expect(result.current.editor).toBeNull();
    expect(result.current.recurrenceScopeDialog).toBeNull();

    vi.useRealTimers();
  });

  it("saveEditor moves an event by create+destroy when calendarId changes", async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: "moved" });
    const patchEvent = vi.fn();
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent, patchEvent, deleteEvent },
      }),
    );

    act(() => {
      result.current.openEditEventKey("dentist");
    });
    expect(result.current.editor?.form.calendarId).toBe("default");

    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        calendarId: "work",
      });
    });

    await act(async () => {
      result.current.saveEditor();
    });

    await vi.waitFor(() => {
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ calendarId: "work", title: "Dentist" }),
      );
      expect(deleteEvent).toHaveBeenCalledWith("dentist");
    });
    expect(patchEvent).not.toHaveBeenCalled();
  });

  it("defaults create target to the isDefault calendar and highlights via defaultCalendarId", () => {
    const { result } = renderHook(() => useCalendarController({ data: bootstrap.data }));

    expect(result.current.defaultCalendarId).toBe("default");
  });

  it("selectDefaultCalendar sets create target and unhides a hidden calendar", () => {
    const { result } = renderHook(() => useCalendarController({ data: bootstrap.data }));

    act(() => {
      result.current.toggleCalendarVisibility("work");
    });
    expect(result.current.hiddenCalendarIds.has("work")).toBe(true);

    act(() => {
      result.current.selectDefaultCalendar("work");
    });

    expect(result.current.defaultCalendarId).toBe("work");
    expect(result.current.hiddenCalendarIds.has("work")).toBe(false);

    act(() => {
      result.current.openCreateEvent("2033-01-12");
    });

    expect(result.current.editor).toMatchObject({
      mode: "create",
      form: { calendarId: "work", startDate: "2033-01-12" },
    });
  });

  it("saveEditor auto-shows the target calendar when creating onto a hidden calendar", async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: "new" });
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
      result.current.openCreateEvent("2033-01-12");
    });
    act(() => {
      result.current.toggleCalendarVisibility("work");
      result.current.setEditorForm({
        ...result.current.editor!.form,
        calendarId: "work",
        title: "Hidden target",
      });
    });
    expect(result.current.hiddenCalendarIds.has("work")).toBe(true);

    await act(async () => {
      result.current.saveEditor();
    });

    await vi.waitFor(() => {
      expect(createEvent).toHaveBeenCalled();
    });
    expect(result.current.hiddenCalendarIds.has("work")).toBe(false);
  });

  it("saveEditor auto-shows the target calendar when moving an event onto a hidden calendar", async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: "moved" });
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent,
          patchEvent: vi.fn(),
          deleteEvent,
        },
      }),
    );

    act(() => {
      result.current.toggleCalendarVisibility("work");
    });
    act(() => {
      result.current.openEditEventKey("dentist");
    });
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        calendarId: "work",
      });
    });
    expect(result.current.hiddenCalendarIds.has("work")).toBe(true);

    await act(async () => {
      result.current.saveEditor();
    });

    await vi.waitFor(() => {
      expect(createEvent).toHaveBeenCalled();
    });
    expect(result.current.hiddenCalendarIds.has("work")).toBe(false);
  });

  it("deleteEditorEvent queues undoable delete and hides the event pending commit", async () => {
    vi.useFakeTimers();
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent,
        },
      }),
    );

    act(() => {
      result.current.openEditEventKey("dentist");
    });
    act(() => {
      result.current.deleteEditorEvent();
    });

    expect(result.current.editor).toBeNull();
    expect(result.current.pendingDeletedEventIds.has("dentist")).toBe(true);
    expect(deleteEvent).not.toHaveBeenCalled();

    act(() => {
      expect(result.current.undoLatest()).toBe(true);
    });
    expect(result.current.pendingDeletedEventIds.has("dentist")).toBe(false);

    vi.useRealTimers();
  });
});
