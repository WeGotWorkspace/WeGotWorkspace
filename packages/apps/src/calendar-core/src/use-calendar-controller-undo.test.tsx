import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
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

type EventOps = Pick<CalendarAPIOperations, "createEvent" | "patchEvent" | "deleteEvent">;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderController(operations: EventOps) {
  return renderHook(() => useCalendarController({ data: bootstrap.data, operations }));
}

function ops(overrides: Partial<EventOps> = {}): EventOps {
  return {
    createEvent: vi.fn().mockResolvedValue({ id: "created" }),
    patchEvent: vi.fn().mockResolvedValue({ id: "patched" }),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as EventOps;
}

beforeEach(() => {
  window.localStorage.clear();
  toastApi.show.mockClear();
  toastApi.showError.mockClear();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCalendarController Undo as a compensating write (#1854)", () => {
  it("sends a create at once; Undo before it settles waits, then deletes the created id", async () => {
    const create = deferred<{ id: string }>();
    const operations = ops({ createEvent: vi.fn(() => create.promise) as never });
    const { result } = renderController(operations);

    act(() => {
      result.current.openCreateEvent("2033-01-12");
    });
    act(() => {
      result.current.saveEditor();
    });
    expect(operations.createEvent).toHaveBeenCalledTimes(1);

    act(() => {
      expect(result.current.undoLatest()).toBe(true);
    });
    expect(operations.deleteEvent).not.toHaveBeenCalled();

    await act(async () => {
      create.resolve({ id: "created-late" });
    });
    await vi.waitFor(() => {
      expect(operations.deleteEvent).toHaveBeenCalledWith("created-late");
    });
  });

  it("Undo of an edit patches back only the fields the edit changed", async () => {
    const operations = ops();
    const { result } = renderController(operations);

    act(() => {
      result.current.openEditEventKey("dentist");
    });
    act(() => {
      result.current.setEditorForm({ ...result.current.editor!.form, title: "Renamed" });
    });
    await act(async () => {
      result.current.saveEditor();
    });
    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenCalledWith("dentist", { title: "Renamed" });
    });

    await act(async () => {
      result.current.undoLatest();
    });
    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenLastCalledWith("dentist", { title: "Dentist" });
    });
  });

  it("a move whose delete failed only takes back the copy", async () => {
    const operations = ops({
      createEvent: vi.fn().mockResolvedValue({ id: "moved-copy" }),
      deleteEvent: vi
        .fn()
        .mockRejectedValueOnce(new Error("delete failed"))
        .mockResolvedValue(undefined),
    });
    const { result } = renderController(operations);

    act(() => {
      result.current.openEditEventKey("dentist");
    });
    act(() => {
      result.current.setEditorForm({ ...result.current.editor!.form, calendarId: "work" });
    });
    await act(async () => {
      result.current.saveEditor();
    });

    await vi.waitFor(() => {
      expect(operations.deleteEvent).toHaveBeenLastCalledWith("moved-copy");
    });
    expect(operations.createEvent).toHaveBeenCalledTimes(1);
    expect(toastApi.showError).toHaveBeenCalled();
  });

  it("Undo of a move deletes the copy and brings the original back", async () => {
    const operations = ops({ createEvent: vi.fn().mockResolvedValue({ id: "moved-copy" }) });
    const { result } = renderController(operations);

    act(() => {
      result.current.openEditEventKey("dentist");
    });
    act(() => {
      result.current.setEditorForm({ ...result.current.editor!.form, calendarId: "work" });
    });
    await act(async () => {
      result.current.saveEditor();
    });
    await vi.waitFor(() => {
      expect(operations.deleteEvent).toHaveBeenCalledWith("dentist");
    });

    await act(async () => {
      result.current.undoLatest();
    });
    await vi.waitFor(() => {
      expect(operations.createEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ calendarId: "default", title: "Dentist" }),
      );
    });
    expect(operations.deleteEvent).toHaveBeenCalledWith("moved-copy");
  });

  it("Undo of a drag split deletes the fork and gives the master its rules back", async () => {
    const operations = ops({ createEvent: vi.fn().mockResolvedValue({ id: "drag-fork" }) });
    const master = bootstrap.data.events.find((event) => event.id === "standup")!;
    const { result } = renderController(operations);

    await act(async () => {
      await result.current.splitSeriesFromDrag({
        masterId: "standup",
        recurrenceId: "2033-01-12T09:30:00",
        start: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T11:30:00"),
      });
    });
    await vi.waitFor(() => {
      expect(operations.createEvent).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      result.current.undoLatest();
    });
    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenLastCalledWith("standup", {
        recurrenceRules: master.recurrenceRules,
      });
    });
    expect(operations.deleteEvent).toHaveBeenCalledWith("drag-fork");
  });

  it("keeps the event delete deferred: Undo inside the grace period sends nothing", async () => {
    vi.useFakeTimers();
    const operations = ops();
    const { result } = renderController(operations);

    act(() => {
      result.current.openEditEventKey("dentist");
    });
    act(() => {
      result.current.deleteEditorEvent();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      expect(result.current.undoLatest()).toBe(true);
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(operations.deleteEvent).not.toHaveBeenCalled();
  });

  it("sends the event delete after the grace period", async () => {
    vi.useFakeTimers();
    const operations = ops();
    const { result } = renderController(operations);

    act(() => {
      result.current.openEditEventKey("dentist");
    });
    act(() => {
      result.current.deleteEditorEvent();
    });
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(operations.deleteEvent).toHaveBeenCalledWith("dentist");
  });
});
