import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { CalendarEvent, CalendarEventsMap } from "@/lib/calendar-engine";
import { defaultTimedEventTimeZone } from "@/calendar-core/src/calendar-timezones";
import type { CalendarPresentation, CalendarViewId } from "@/calendar-core/src/calendar-types";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
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

describe("useCalendarController view + create intent", () => {
  beforeEach(() => {
    mockMatchMedia();
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

  it("hydrates view, date, and list mode from a path-equivalent initial state", () => {
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        initialView: "week",
        initialAnchor: "2026-08-17",
        initialPresentation: "list",
      }),
    );

    expect(result.current.view).toBe("week");
    expect(result.current.anchor).toBe("2026-08-17");
    expect(result.current.presentation).toBe("list");
    expect(result.current.litSurface).toEqual({ view: "week", presentation: "list" });
  });

  it("syncs view, date, and presentation when the URL initial state changes", () => {
    const { result, rerender } = renderHook(
      ({
        initialView,
        initialAnchor,
        initialPresentation,
      }: {
        initialView: CalendarViewId;
        initialAnchor: string;
        initialPresentation: CalendarPresentation;
      }) =>
        useCalendarController({
          data: bootstrap.data,
          initialView,
          initialAnchor,
          initialPresentation,
        }),
      {
        initialProps: {
          initialView: "month" as CalendarViewId,
          initialAnchor: "2026-08-17",
          initialPresentation: "grid" as CalendarPresentation,
        },
      },
    );

    rerender({
      initialView: "week",
      initialAnchor: "2026-08-10",
      initialPresentation: "list",
    });

    expect(result.current.view).toBe("week");
    expect(result.current.anchor).toBe("2026-08-10");
    expect(result.current.presentation).toBe("list");
  });

  it("pushes route state on view, prev/next, today, and list toggle; replaces surface date tweaks", () => {
    const onRouteStateChange = vi.fn();
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        initialView: "week",
        initialAnchor: "2026-08-17",
        initialPresentation: "grid",
        onRouteStateChange,
      }),
    );

    act(() => {
      result.current.selectView("day");
    });
    expect(onRouteStateChange).toHaveBeenLastCalledWith(
      { view: "day", date: "2026-08-17", presentation: "grid" },
      { replace: false },
    );

    act(() => {
      result.current.setPresentation("list");
    });
    expect(onRouteStateChange).toHaveBeenLastCalledWith(
      { view: "day", date: "2026-08-17", presentation: "list" },
      { replace: false },
    );

    act(() => {
      result.current.goNext();
    });
    expect(onRouteStateChange).toHaveBeenLastCalledWith(
      { view: "day", date: "2026-08-18", presentation: "list" },
      { replace: false },
    );

    act(() => {
      result.current.setAnchor("2026-08-20");
    });
    expect(onRouteStateChange).toHaveBeenLastCalledWith(
      { view: "day", date: "2026-08-20", presentation: "list" },
      { replace: true },
    );
  });

  it("selectView day then week emits one route write each (no bounce)", () => {
    const onRouteStateChange = vi.fn();
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        initialView: "day",
        initialAnchor: "2026-08-17",
        onRouteStateChange,
      }),
    );

    act(() => {
      result.current.selectView("week");
    });
    expect(result.current.view).toBe("week");
    expect(onRouteStateChange).toHaveBeenCalledTimes(1);
    expect(onRouteStateChange).toHaveBeenCalledWith(
      { view: "week", date: "2026-08-17", presentation: "grid" },
      { replace: false },
    );

    act(() => {
      result.current.selectView("week");
    });
    expect(onRouteStateChange).toHaveBeenCalledTimes(1);
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
        timeZone: defaultTimedEventTimeZone(),
      },
    });
    expect(result.current.pendingCreateIntent).toEqual({
      calendarId: "work",
      allDay: false,
      start: Temporal.PlainDateTime.from("2033-01-12T10:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
    });
  });

  it("keeps pendingCreateIntent after save until the surface event fills the slot", async () => {
    let resolveCreate!: (event: { id: string }) => void;
    const createEvent = vi.fn().mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ surfaceEvents }: { surfaceEvents?: CalendarEventsMap }) =>
        useCalendarController({
          data: bootstrap.data,
          operations: {
            createEvent,
            patchEvent: vi.fn(),
            deleteEvent: vi.fn(),
          },
          surfaceEvents,
        }),
      { initialProps: { surfaceEvents: undefined as CalendarEventsMap | undefined } },
    );

    act(() => {
      result.current.openCreateFromSurface({
        calendarId: "work",
        allDay: false,
        start: Temporal.PlainDateTime.from("2033-01-12T10:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
        title: "Kickoff",
      });
    });
    expect(result.current.pendingCreateIntent?.title).toBe("Kickoff");

    act(() => {
      result.current.saveEditor();
    });

    expect(result.current.editor).toBeNull();
    expect(result.current.pendingCreateIntent).toEqual({
      calendarId: "work",
      allDay: false,
      start: Temporal.PlainDateTime.from("2033-01-12T10:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
      title: "Kickoff",
    });

    await act(async () => {
      resolveCreate({ id: "created-1" });
    });
    expect(result.current.pendingCreateIntent?.title).toBe("Kickoff");

    const persisted: CalendarEventsMap = new Map();
    persisted.set("created-1", {
      eventId: "created-1",
      calendarId: "work",
      data: {
        start: Temporal.PlainDateTime.from("2033-01-12T10:00:00"),
        duration: Temporal.Duration.from("PT1H"),
        allDay: false,
        summary: "Kickoff",
      },
    } as CalendarEvent);
    rerender({ surfaceEvents: persisted });

    expect(result.current.pendingCreateIntent).toBeNull();
  });

  it("drops a held create preview when dragging a new slot", async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: "created-1" });
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
        title: "Kickoff",
      });
    });
    await act(async () => {
      result.current.saveEditor();
    });
    expect(result.current.pendingCreateIntent?.start.toString()).toBe("2033-01-12T10:00:00");

    act(() => {
      result.current.openCreateFromSurface({
        calendarId: "work",
        allDay: false,
        start: Temporal.PlainDateTime.from("2033-01-12T14:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T15:00:00"),
      });
    });
    expect(result.current.pendingCreateIntent?.start.toString()).toBe("2033-01-12T14:00:00");
    expect(result.current.pendingCreateIntent?.title).toBeUndefined();
  });

  it("drops pendingCreateIntent when create is cancelled or undone", async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: "created-1" });
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
      result.current.openCreateFromSurface({
        calendarId: "work",
        allDay: false,
        start: Temporal.PlainDateTime.from("2033-01-12T14:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T15:00:00"),
      });
    });
    act(() => {
      result.current.closeEditor();
    });
    expect(result.current.pendingCreateIntent).toBeNull();

    act(() => {
      result.current.openCreateFromSurface({
        calendarId: "work",
        allDay: false,
        start: Temporal.PlainDateTime.from("2033-01-12T14:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T15:00:00"),
        title: "Later",
      });
    });
    await act(async () => {
      result.current.saveEditor();
    });
    await vi.waitFor(() => {
      expect(createEvent).toHaveBeenCalled();
    });
    expect(result.current.pendingCreateIntent?.title).toBe("Later");

    await act(async () => {
      result.current.undoLatest();
    });
    expect(deleteEvent).toHaveBeenCalledWith("created-1");
    expect(result.current.pendingCreateIntent).toBeNull();
  });

  it("drops pendingCreateIntent when createEvent fails", async () => {
    const createEvent = vi.fn().mockRejectedValue(new Error("offline"));
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
        title: "Failing",
      });
    });
    await act(async () => {
      result.current.saveEditor();
    });
    await vi.waitFor(() => {
      expect(createEvent).toHaveBeenCalled();
    });
    expect(result.current.editor).toBeNull();
    expect(result.current.pendingCreateIntent).toBeNull();
  });

  it("openEditEventKey opens the editor directly for a recurring occurrence", async () => {
    const { result } = renderHook(() => useCalendarController({ data: bootstrap.data }));

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });

    expect(result.current.recurrenceScopeDialog).toBeNull();
    expect(result.current.editor).toMatchObject({
      mode: "edit",
      eventId: "standup",
      recurrenceId: "2033-01-12T09:30:00",
    });
  });

  it("saveEditor cancel on scope leaves the editor open", async () => {
    vi.useFakeTimers();
    const patchEvent = vi.fn();
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent: vi.fn(), patchEvent, deleteEvent: vi.fn() },
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        title: "Standup (edited)",
      });
    });

    act(() => {
      result.current.saveEditor();
    });
    await act(async () => {
      vi.runAllTimers();
    });
    await act(async () => {
      result.current.recurrenceScopeDialog?.resolve(null);
    });

    expect(result.current.editor).not.toBeNull();
    expect(result.current.recurrenceScopeDialog).toBeNull();
    expect(patchEvent).not.toHaveBeenCalled();

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

  it("saveEditor shows a suite undo toast and undo deletes the created event", async () => {
    toastApi.show.mockClear();
    const createEvent = vi.fn().mockResolvedValue({ id: "created-1" });
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
      result.current.openCreateEvent("2033-01-12");
    });
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        title: "Undoable create",
      });
    });

    await act(async () => {
      result.current.saveEditor();
    });

    await vi.waitFor(() => {
      expect(createEvent).toHaveBeenCalled();
    });
    expect(toastApi.show).toHaveBeenCalledWith(
      defaultCalendarLabels.toastEventCreated,
      expect.objectContaining({ canUndo: true, undoLabel: "Undo" }),
    );

    await act(async () => {
      result.current.undoLatest();
    });
    expect(deleteEvent).toHaveBeenCalledWith("created-1");
    expect(toastApi.show).toHaveBeenCalledWith(defaultCalendarLabels.toastEventSaveUndone, {
      severity: "info",
    });
  });

  it("saveEditor shows a suite undo toast and undo restores the previous event", async () => {
    toastApi.show.mockClear();
    const patchEvent = vi.fn().mockResolvedValue({ id: "dentist" });
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent,
          deleteEvent: vi.fn(),
        },
      }),
    );

    act(() => {
      result.current.openEditEventKey("dentist");
    });
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        title: "Renamed dentist",
      });
    });

    await act(async () => {
      result.current.saveEditor();
    });

    await vi.waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith(
        "dentist",
        expect.objectContaining({ title: "Renamed dentist" }),
      );
    });
    expect(toastApi.show).toHaveBeenCalledWith(
      defaultCalendarLabels.toastEventUpdated,
      expect.objectContaining({ canUndo: true, undoLabel: "Undo" }),
    );

    await act(async () => {
      result.current.undoLatest();
    });
    expect(patchEvent).toHaveBeenLastCalledWith(
      "dentist",
      expect.objectContaining({ title: "Dentist" }),
    );
    expect(toastApi.show).toHaveBeenCalledWith(defaultCalendarLabels.toastEventSaveUndone, {
      severity: "info",
    });
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
      form: {
        calendarId: "work",
        startDate: "2033-01-12",
        timeZone: defaultTimedEventTimeZone(),
      },
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
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Hidden target",
          timeZone: defaultTimedEventTimeZone(),
        }),
      );
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
