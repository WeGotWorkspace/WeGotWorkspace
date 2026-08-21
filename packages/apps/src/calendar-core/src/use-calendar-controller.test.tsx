import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { CalendarEvent, CalendarEventsMap } from "@/lib/calendar-engine";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
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

describe("useCalendarController recurring scopes", () => {
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

  async function openRecurringEditor(result: {
    current: ReturnType<typeof useCalendarController>;
  }) {
    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });
  }

  async function saveAndResolveScope(
    result: { current: ReturnType<typeof useCalendarController> },
    scope: "thisInstance" | "thisAndFuture" | "allInstances" | null,
  ) {
    vi.useFakeTimers();
    act(() => {
      result.current.saveEditor();
    });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(result.current.recurrenceScopeDialog).not.toBeNull();
    await act(async () => {
      result.current.recurrenceScopeDialog?.resolve(scope);
    });
    vi.useRealTimers();
  }

  it("saveEditor thisInstance patches recurrenceOverrides on the master", async () => {
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const createEvent = vi.fn();
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent, patchEvent, deleteEvent: vi.fn() },
      }),
    );

    await openRecurringEditor(result);
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        title: "Standup (moved)",
      });
    });

    await saveAndResolveScope(result, "thisInstance");

    await vi.waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith(
        "standup",
        expect.objectContaining({
          recurrenceOverrides: expect.objectContaining({
            "2033-01-12T09:30:00": expect.objectContaining({ title: "Standup (moved)" }),
          }),
        }),
      );
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("openEditEventKey prefills occurrence wall times from recurrenceId without surface rows", async () => {
    const { result } = renderHook(() => useCalendarController({ data: bootstrap.data }));

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-17T09:30:00");
    });

    expect(result.current.editor).toMatchObject({
      mode: "edit",
      eventId: "standup",
      recurrenceId: "2033-01-17T09:30:00",
      form: {
        startDate: "2033-01-17",
        startTime: "09:30",
        endDate: "2033-01-17",
        endTime: "10:00",
      },
    });
  });

  it("saveEditor thisAndFuture truncates master and forks a new series", async () => {
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const createEvent = vi.fn().mockResolvedValue({ id: "forked" });
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent, patchEvent, deleteEvent: vi.fn() },
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-17T09:30:00");
    });
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        title: "Standup from here",
      });
    });

    await saveAndResolveScope(result, "thisAndFuture");

    await vi.waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith(
        "standup",
        expect.objectContaining({
          recurrenceRules: [
            expect.objectContaining({
              frequency: "weekly",
              until: "2033-01-17T09:29:59",
            }),
          ],
        }),
      );
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Standup from here",
          start: "2033-01-17T09:30:00",
          recurrenceRules: [expect.objectContaining({ frequency: "weekly" })],
        }),
      );
    });
  });

  it("saveEditor thisAndFuture moves future overrides onto the fork and keeps past on master", async () => {
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const createEvent = vi.fn().mockResolvedValue({ id: "forked-overrides" });
    const standup = bootstrap.data.events.find((event) => event.id === "standup")!;
    const data = {
      ...bootstrap.data,
      events: [
        {
          ...standup,
          recurrenceOverrides: {
            "2033-01-10T09:30:00": { title: "Past override" },
            "2033-01-24T09:30:00": { excluded: true },
            "2033-01-31T09:30:00": { title: "Moved later", start: "2033-01-31T11:00:00" },
          },
        },
        ...bootstrap.data.events.filter((event) => event.id !== "standup"),
      ],
    };
    const { result } = renderHook(() =>
      useCalendarController({
        data,
        operations: { createEvent, patchEvent, deleteEvent: vi.fn() },
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-17T09:30:00");
    });
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        title: "Standup from here",
      });
    });

    await saveAndResolveScope(result, "thisAndFuture");

    await vi.waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith(
        "standup",
        expect.objectContaining({
          recurrenceRules: [
            expect.objectContaining({
              until: "2033-01-17T09:29:59",
            }),
          ],
          recurrenceOverrides: {
            "2033-01-10T09:30:00": { title: "Past override" },
            "2033-01-24T09:30:00": null,
            "2033-01-31T09:30:00": null,
          },
        }),
      );
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          start: "2033-01-17T09:30:00",
          recurrenceOverrides: {
            "2033-01-24T09:30:00": { excluded: true },
            "2033-01-31T09:30:00": { title: "Moved later", start: "2033-01-31T11:00:00" },
          },
        }),
      );
    });
  });

  it("saveEditor thisAndFuture reads overrides from surface when bootstrap is stale", async () => {
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const createEvent = vi.fn().mockResolvedValue({ id: "forked-surface" });
    const standup = bootstrap.data.events.find((event) => event.id === "standup")!;
    // Bootstrap lacks the only-this exception; adapter/surface already has it.
    const data = {
      ...bootstrap.data,
      events: [{ ...standup }, ...bootstrap.data.events.filter((event) => event.id !== "standup")],
    };
    const surfaceEvents = calendarEventsToEngineMap([
      {
        ...standup,
        recurrenceOverrides: {
          "2033-01-24T09:30:00": { title: "Standup (moved)", start: "2033-01-24T11:00:00" },
        },
      },
    ]);
    const { result } = renderHook(() =>
      useCalendarController({
        data,
        surfaceEvents,
        operations: { createEvent, patchEvent, deleteEvent: vi.fn() },
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-17T09:30:00");
    });
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        title: "Standup from here",
      });
    });

    await saveAndResolveScope(result, "thisAndFuture");

    await vi.waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith(
        "standup",
        expect.objectContaining({
          recurrenceOverrides: null,
        }),
      );
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          start: "2033-01-17T09:30:00",
          recurrenceOverrides: {
            "2033-01-24T09:30:00": { title: "Standup (moved)", start: "2033-01-24T11:00:00" },
          },
        }),
      );
    });
  });

  it("saveEditor thisAndFuture uses form rules when bootstrap lacks the master", async () => {
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const createEvent = vi.fn().mockResolvedValue({ id: "forked-stale" });
    const resolveEventId = vi.fn().mockResolvedValue("server-standup");
    const surfaceMaster = {
      eventId: "urn:uuid:server-standup",
      calendarId: "work",
      isRecurring: true,
      data: {
        start: Temporal.PlainDateTime.from("2033-01-10T09:30:00"),
        duration: Temporal.Duration.from("PT30M"),
        summary: "Team standup",
        recurrenceRule: {
          freq: "WEEKLY" as const,
          byDay: [{ day: "MO" as const }],
        },
      },
    };
    const occurrence = {
      eventId: "urn:uuid:server-standup",
      calendarId: "work",
      recurrenceId: "20330112T093000",
      data: {
        start: Temporal.PlainDateTime.from("2033-01-12T09:30:00"),
        duration: Temporal.Duration.from("PT30M"),
        summary: "Team standup",
      },
    };
    const surfaceEvents: CalendarEventsMap = new Map();
    surfaceEvents.set("server-standup", surfaceMaster as CalendarEvent);
    surfaceEvents.set("server-standup::20330112T093000", occurrence as CalendarEvent);

    const { result } = renderHook(() =>
      useCalendarController({
        // Freshly created series often exist in the adapter but not yet in React bootstrap.
        data: { ...bootstrap.data, events: [] },
        operations: { createEvent, patchEvent, deleteEvent: vi.fn() },
        resolveEventId,
        surfaceEvents,
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("server-standup::20330112T093000");
    });
    expect(result.current.editor).not.toBeNull();
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        title: "Standup from here",
      });
    });

    await saveAndResolveScope(result, "thisAndFuture");

    await vi.waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith(
        "server-standup",
        expect.objectContaining({
          recurrenceRules: [
            expect.objectContaining({
              frequency: "weekly",
              until: "2033-01-12T09:29:59",
            }),
          ],
        }),
      );
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Standup from here",
          start: "2033-01-12T09:30:00",
          recurrenceRules: [expect.objectContaining({ frequency: "weekly" })],
        }),
      );
    });
    // Must not invent a daily truncation when the wire master is missing.
    expect(patchEvent.mock.calls[0]?.[1]?.recurrenceRules?.[0]?.frequency).toBe("weekly");
  });

  it("deleteEditorEvent asks delete scope after opening a recurring occurrence", async () => {
    vi.useFakeTimers();
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent: vi.fn(), patchEvent, deleteEvent },
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });

    expect(result.current.editor).not.toBeNull();
    expect(result.current.recurrenceScopeDialog).toBeNull();

    act(() => {
      result.current.deleteEditorEvent();
    });
    await act(async () => {
      vi.runAllTimers();
    });

    expect(result.current.recurrenceScopeDialog).not.toBeNull();
    expect(result.current.recurrenceScopeDialog?.action).toBe("delete");
    expect(patchEvent).not.toHaveBeenCalled();
    expect(deleteEvent).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("deleteEditorEvent thisInstance excludes only that occurrence", async () => {
    vi.useFakeTimers();
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent: vi.fn(), patchEvent, deleteEvent },
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });

    act(() => {
      result.current.deleteEditorEvent();
    });
    await act(async () => {
      vi.runAllTimers();
    });
    await act(async () => {
      result.current.recurrenceScopeDialog?.resolve("thisInstance");
    });

    await vi.waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith(
        "standup",
        expect.objectContaining({
          recurrenceOverrides: expect.objectContaining({
            "2033-01-12T09:30:00": expect.objectContaining({ excluded: true }),
          }),
        }),
      );
    });
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(result.current.pendingDeletedEventIds.has("standup")).toBe(false);

    vi.useRealTimers();
  });

  it("deleteEditorEvent thisAndFuture truncates the master series", async () => {
    vi.useFakeTimers();
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent: vi.fn(), patchEvent, deleteEvent },
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });

    act(() => {
      result.current.deleteEditorEvent();
    });
    await act(async () => {
      vi.runAllTimers();
    });
    await act(async () => {
      result.current.recurrenceScopeDialog?.resolve("thisAndFuture");
    });

    await vi.waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith(
        "standup",
        expect.objectContaining({
          recurrenceRules: [
            expect.objectContaining({
              frequency: "weekly",
              until: "2033-01-12T09:29:59",
            }),
          ],
        }),
      );
    });
    expect(deleteEvent).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("deleteEditorEvent allInstances destroys the master series", async () => {
    vi.useFakeTimers();
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const deleteEvent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent: vi.fn(), patchEvent, deleteEvent },
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });

    act(() => {
      result.current.deleteEditorEvent();
    });
    await act(async () => {
      vi.runAllTimers();
    });
    await act(async () => {
      result.current.recurrenceScopeDialog?.resolve("allInstances");
    });

    expect(result.current.pendingDeletedEventIds.has("standup")).toBe(true);
    expect(patchEvent).not.toHaveBeenCalled();

    await act(async () => {
      vi.runAllTimers();
    });

    await vi.waitFor(() => {
      expect(deleteEvent).toHaveBeenCalledWith("standup");
    });

    vi.useRealTimers();
  });

  it("deleteEditorEvent cancel on scope leaves the editor open and does nothing", async () => {
    vi.useFakeTimers();
    const patchEvent = vi.fn();
    const deleteEvent = vi.fn();
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent: vi.fn(), patchEvent, deleteEvent },
      }),
    );

    await act(async () => {
      await result.current.openEditEventKey("standup::2033-01-12T09:30:00");
    });

    act(() => {
      result.current.deleteEditorEvent();
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
    expect(deleteEvent).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("truncateSeriesFromOccurrence patches until before the occurrence", async () => {
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent: vi.fn(), patchEvent, deleteEvent: vi.fn() },
      }),
    );

    await act(async () => {
      await result.current.truncateSeriesFromOccurrence({
        masterId: "standup",
        recurrenceId: "2033-01-12T09:30:00",
      });
    });

    expect(patchEvent).toHaveBeenCalledWith(
      "standup",
      expect.objectContaining({
        recurrenceRules: [
          expect.objectContaining({
            frequency: "weekly",
            until: "2033-01-12T09:29:59",
          }),
        ],
      }),
    );
  });

  it("splitSeriesFromDrag truncates master and creates a forked series at new times", async () => {
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const createEvent = vi.fn().mockResolvedValue({ id: "drag-fork" });
    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: { createEvent, patchEvent, deleteEvent: vi.fn() },
      }),
    );

    await act(async () => {
      await result.current.splitSeriesFromDrag({
        masterId: "standup",
        recurrenceId: "2033-01-12T09:30:00",
        start: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T11:30:00"),
        summary: "Team standup",
        calendarId: "work",
      });
    });

    expect(patchEvent).toHaveBeenCalledWith(
      "standup",
      expect.objectContaining({
        recurrenceRules: [
          expect.objectContaining({
            until: "2033-01-12T09:29:59",
          }),
        ],
      }),
    );
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Team standup",
        start: "2033-01-12T11:00:00",
        duration: "PT30M",
        recurrenceRules: [expect.objectContaining({ frequency: "weekly" })],
      }),
    );
  });

  it("splitSeriesFromDrag resolves JSCalendar uid masterId and applies resized wall times", async () => {
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const createEvent = vi.fn().mockResolvedValue({ id: "drag-fork-uid" });
    const wireMaster = bootstrap.data.events.find((event) => event.id === "standup")!;
    const surfaceEvents: CalendarEventsMap = new Map();
    surfaceEvents.set("standup", {
      eventId: wireMaster.uid,
      calendarId: "work",
      isRecurring: true,
      data: {
        start: Temporal.PlainDateTime.from("2033-01-10T09:30:00"),
        duration: Temporal.Duration.from("PT30M"),
        summary: "Team standup",
        recurrenceRule: {
          freq: "WEEKLY" as const,
          byDay: [{ day: "MO" as const }],
        },
      },
    } as CalendarEvent);

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        surfaceEvents,
        operations: { createEvent, patchEvent, deleteEvent: vi.fn() },
      }),
    );

    // Lit historically passed envelope.eventId (uid) — must still fork at new times.
    await act(async () => {
      await result.current.splitSeriesFromDrag({
        masterId: wireMaster.uid,
        recurrenceId: "2033-01-12T09:30:00",
        start: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T12:00:00"),
        summary: "Team standup",
        calendarId: "work",
      });
    });

    expect(patchEvent).toHaveBeenCalledWith(
      "standup",
      expect.objectContaining({
        recurrenceRules: [
          expect.objectContaining({
            frequency: "weekly",
            until: "2033-01-12T09:29:59",
          }),
        ],
      }),
    );
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        start: "2033-01-12T11:00:00",
        duration: "PT1H",
        recurrenceRules: [expect.objectContaining({ frequency: "weekly" })],
      }),
    );
  });
});

describe("useCalendarController create calendar directory", () => {
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

  it("forwards groupSlug when creating a calendar in a group directory", async () => {
    const createCalendar = vi.fn().mockResolvedValue({
      id: "roadmap",
      name: "Roadmap",
      color: "#22c55e",
      scope: "group",
      groupSlug: "team",
      mayWrite: true,
      mayDelete: true,
    });

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          createCalendar,
        },
      }),
    );

    act(() => {
      result.current.openCreateCalendarDialog();
    });
    await act(async () => {
      result.current.saveCalendarDialog({
        name: "Roadmap",
        color: "#22c55e",
        groupSlug: "team",
      });
    });

    expect(createCalendar).toHaveBeenCalledWith({
      name: "Roadmap",
      color: "#22c55e",
      groupSlug: "team",
    });
  });

  it("patches a team calendar name and color", async () => {
    const patchCalendar = vi.fn().mockResolvedValue({
      id: "group-editorial",
      name: "Desk",
      color: "#ec4899",
      scope: "group",
      groupSlug: "editorial",
      mayWrite: true,
      mayDelete: false,
    });

    const { result } = renderHook(() =>
      useCalendarController({
        data: bootstrap.data,
        operations: {
          createEvent: vi.fn(),
          patchEvent: vi.fn(),
          deleteEvent: vi.fn(),
          patchCalendar,
        },
      }),
    );

    act(() => {
      result.current.openEditCalendarDialog("group-editorial");
    });
    await act(async () => {
      result.current.saveCalendarDialog({
        name: "Desk",
        color: "#ec4899",
      });
    });

    expect(patchCalendar).toHaveBeenCalledWith("group-editorial", {
      name: "Desk",
      color: "#ec4899",
    });
    expect(result.current.calendars.find((entry) => entry.id === "group-editorial")).toMatchObject({
      name: "Desk",
      color: "#ec4899",
    });
  });
});
