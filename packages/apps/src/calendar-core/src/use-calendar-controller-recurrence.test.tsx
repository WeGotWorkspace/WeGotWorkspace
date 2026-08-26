import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { CalendarEvent, CalendarEventsMap } from "@/lib/calendar-engine";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
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

describe("useCalendarController recurring scopes", () => {
  beforeEach(() => {
    mockMatchMedia();
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

  it("saveEditor skips the scope dialog when the occurrence is already an exception", async () => {
    const patchEvent = vi.fn().mockResolvedValue(undefined);
    const createEvent = vi.fn();
    const standup = bootstrap.data.events.find((event) => event.id === "standup");
    expect(standup).toBeDefined();
    const { result } = renderHook(() =>
      useCalendarController({
        data: {
          ...bootstrap.data,
          events: bootstrap.data.events.map((event) =>
            event.id === "standup"
              ? {
                  ...event,
                  recurrenceOverrides: {
                    "2033-01-12T09:30:00": { title: "Standup (moved)" },
                  },
                }
              : event,
          ),
        },
        operations: { createEvent, patchEvent, deleteEvent: vi.fn() },
      }),
    );

    await openRecurringEditor(result);
    act(() => {
      result.current.setEditorForm({
        ...result.current.editor!.form,
        title: "Standup (moved again)",
      });
    });

    vi.useFakeTimers();
    act(() => {
      result.current.saveEditor();
    });
    await act(async () => {
      vi.runAllTimers();
    });
    vi.useRealTimers();

    expect(result.current.recurrenceScopeDialog).toBeNull();
    await vi.waitFor(() => {
      expect(patchEvent).toHaveBeenCalledWith(
        "standup",
        expect.objectContaining({
          recurrenceOverrides: expect.objectContaining({
            "2033-01-12T09:30:00": expect.objectContaining({ title: "Standup (moved again)" }),
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
