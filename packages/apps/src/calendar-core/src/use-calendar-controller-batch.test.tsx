import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { CalendarAPIOperations, CalendarEventPatch } from "@/lib/models/calendar-types";
import { useCalendarController } from "@/calendar-core/src/use-calendar-controller";
import { groupOccurrenceKeys } from "@/calendar-core/src/use-calendar-event-deletes";
import { createCalendarAutosaveWrites } from "@/calendar-core/src/calendar-autosave-writes";
import { calendarEventToForm } from "@/calendar-core/src/calendar-editor-model";
import { patchToJmapPartial } from "@/calendar-core/src/calendar-wire";
import type { CalendarEditorState } from "@/calendar-core/src/use-calendar-controller";
import type { JmapCalendarEvent } from "@/lib/jmap-client";

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
const STANDUP_TUESDAY = "standup::2033-01-11T09:30:00";
const STANDUP_WEDNESDAY = "standup::2033-01-12T09:30:00";

type EventOps = Pick<CalendarAPIOperations, "createEvent" | "patchEvent" | "deleteEvent">;

function ops(): EventOps {
  return {
    createEvent: vi.fn().mockResolvedValue({ id: "created" }),
    patchEvent: vi.fn().mockResolvedValue({ id: "patched" }),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
  } as EventOps;
}

function renderController(operations: EventOps) {
  return renderHook(() =>
    useCalendarController({ data: bootstrap.data, operations, sessionEmail: "me@example.com" }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  toastApi.show.mockClear();
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

describe("groupOccurrenceKeys", () => {
  it("groups the picked rows by event: occurrences of a series, or the event itself", () => {
    const groups = groupOccurrenceKeys(
      [STANDUP_TUESDAY, "dentist", STANDUP_WEDNESDAY],
      bootstrap.data.events,
    );
    expect(
      groups.map(({ eventId, recurrenceIds, whole }) => ({ eventId, recurrenceIds, whole })),
    ).toEqual([
      {
        eventId: "standup",
        recurrenceIds: ["2033-01-11T09:30:00", "2033-01-12T09:30:00"],
        whole: false,
      },
      { eventId: "dentist", recurrenceIds: [], whole: true },
    ]);
    expect(groups[1]?.original?.title).toBe("Dentist");
  });
});

describe("useCalendarController batch writes (list mode multi-select)", () => {
  it("deletes after the grace period: a series loses only the picked dates, the rest go", async () => {
    vi.useFakeTimers();
    const operations = ops();
    const { result } = renderController(operations);

    act(() => {
      result.current.deleteCalendarEvents([STANDUP_TUESDAY, STANDUP_WEDNESDAY, "dentist"]);
    });
    // Hidden at once: the occurrences by their keys, the whole event by its id.
    expect([...result.current.pendingDeletedEventIds].sort()).toEqual(
      ["dentist", STANDUP_TUESDAY, STANDUP_WEDNESDAY].sort(),
    );
    expect(toastApi.show).toHaveBeenCalledWith("3 events deleted", expect.anything());
    expect(operations.deleteEvent).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(operations.deleteEvent).toHaveBeenCalledTimes(1);
    expect(operations.deleteEvent).toHaveBeenCalledWith("dentist");
    expect(operations.patchEvent).toHaveBeenCalledTimes(1);
    const [patchedId, patch] = vi.mocked(operations.patchEvent).mock.calls[0]!;
    expect(patchedId).toBe("standup");
    const overrides = patch.recurrenceOverrides ?? {};
    expect(Object.keys(overrides)).toEqual(
      expect.arrayContaining(["2033-01-11T09:30:00", "2033-01-12T09:30:00"]),
    );
  });

  it("excludes the dates from the series as it is when the write goes", async () => {
    vi.useFakeTimers();
    const operations = ops();
    const { result, rerender } = renderHook(
      ({ data }) => useCalendarController({ data, operations, sessionEmail: "me@example.com" }),
      { initialProps: { data: bootstrap.data } },
    );

    act(() => {
      result.current.deleteCalendarEvents([STANDUP_TUESDAY]);
    });
    // An edit of another date of the series is saved during the grace period.
    const edited = { "2033-01-13T09:30:00": { title: "Standup (moved room)" } };
    rerender({
      data: {
        ...bootstrap.data,
        events: bootstrap.data.events.map((event) =>
          event.id === "standup" ? { ...event, recurrenceOverrides: edited } : event,
        ),
      },
    });
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    const [, patch] = vi.mocked(operations.patchEvent).mock.calls[0]!;
    expect(patch.recurrenceOverrides).toMatchObject(edited);
    expect(Object.keys(patch.recurrenceOverrides ?? {})).toContain("2033-01-11T09:30:00");
  });

  it("Undo inside the grace period sends nothing and shows the rows again", () => {
    vi.useFakeTimers();
    const operations = ops();
    const { result } = renderController(operations);

    act(() => {
      result.current.deleteCalendarEvents(["dentist", "design-review"]);
    });
    act(() => {
      expect(result.current.undoLatest()).toBe(true);
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(operations.deleteEvent).not.toHaveBeenCalled();
    expect(result.current.pendingDeletedEventIds.size).toBe(0);
  });

  it("moves each event (a series whole) to the calendar: a copy there, then the original goes", async () => {
    const operations = ops();
    const { result } = renderController(operations);

    await act(async () => {
      result.current.moveCalendarEvents([STANDUP_TUESDAY, "dentist"], "family");
    });

    expect(operations.createEvent).toHaveBeenCalledTimes(2);
    for (const [draft] of vi.mocked(operations.createEvent).mock.calls) {
      expect(draft.calendarId).toBe("family");
      expect(draft.organizer?.email).toBe("me@example.com");
    }
    expect(vi.mocked(operations.createEvent).mock.calls[0]![0].title).toBe("Team standup");
    expect(operations.deleteEvent).toHaveBeenCalledWith("standup");
    expect(operations.deleteEvent).toHaveBeenCalledWith("dentist");
  });

  it("moves the open event as its form stands, edits not saved yet included", async () => {
    const operations = ops();
    const { result } = renderController(operations);
    const dentist = bootstrap.data.events.find((event) => event.id === "dentist")!;
    const form = { ...calendarEventToForm(dentist), title: "Dentist (moved)" };

    await act(async () => {
      result.current.moveCalendarEvents(["dentist"], "family", {
        mode: "edit",
        eventId: "dentist",
        form,
      });
    });

    const [draft] = vi.mocked(operations.createEvent).mock.calls[0]!;
    expect(draft.title).toBe("Dentist (moved)");
    expect(draft.calendarId).toBe("family");
  });

  it("skips events already in the target calendar", async () => {
    const operations = ops();
    const { result } = renderController(operations);

    await act(async () => {
      result.current.moveCalendarEvents(["dentist"], "default");
    });

    expect(operations.createEvent).not.toHaveBeenCalled();
    expect(operations.deleteEvent).not.toHaveBeenCalled();
  });
});

/** One event on a fake server: patches apply in arrival order; `hold` keeps the next back. */
function fakeServer(event: JmapCalendarEvent) {
  let stored = event;
  const held: (() => void)[] = [];
  let holdNext = false;
  let failNext = false;
  const patchEvent = vi.fn(async (_id: string, patch: CalendarEventPatch) => {
    if (holdNext) {
      holdNext = false;
      await new Promise<void>((resolve) => held.push(resolve));
    }
    if (failNext) {
      failNext = false;
      throw new Error("offline");
    }
    stored = { ...stored, ...patchToJmapPartial(patch) };
    return stored;
  });
  return {
    patchEvent,
    hold: () => (holdNext = true),
    fail: () => (failNext = true),
    release: () => held.shift()?.(),
    stored: () => stored,
  };
}

describe("useCalendarController list-mode autosave", () => {
  const dentist = bootstrap.data.events.find((event) => event.id === "dentist")!;
  const standup = bootstrap.data.events.find((event) => event.id === "standup")!;

  function renderAutosave(server: ReturnType<typeof fakeServer>) {
    const operations = { ...ops(), patchEvent: server.patchEvent } as EventOps;
    const { result } = renderController(operations);
    const writes = createCalendarAutosaveWrites();
    return (target: CalendarEditorState, scope?: Parameters<typeof result.current.saveEditor>[0]) =>
      result.current.saveEditor(scope, { keepOpen: true, writes, target });
  }

  it("writes one at a time, so a field typed back while a write is out is still sent", async () => {
    const server = fakeServer(dentist);
    const autosave = renderAutosave(server);
    const form = calendarEventToForm(dentist);
    const edit = (change: Partial<typeof form>) =>
      autosave({ mode: "edit", eventId: "dentist", form: { ...form, ...change } });

    server.hold();
    await act(async () => edit({ title: "Meet", location: "Room 1" }));
    await act(async () => edit({ title: form.title, location: "" }));
    expect(server.patchEvent).toHaveBeenCalledTimes(1);

    await act(async () => server.release());
    expect(server.patchEvent).toHaveBeenCalledTimes(2);
    const now = calendarEventToForm(server.stored());
    expect([now.title, now.location]).toEqual([form.title, ""]);
  });

  it("a date of a series typed back to the series title while its first write is out", async () => {
    const server = fakeServer(standup);
    const autosave = renderAutosave(server);
    const rid = "2033-01-11T09:30:00";
    const form = calendarEventToForm(standup);
    const edit = (title: string) =>
      autosave(
        { mode: "edit", eventId: "standup", recurrenceId: rid, form: { ...form, title } },
        "thisInstance",
      );

    server.hold();
    await act(async () => edit("Standup, moved room"));
    await act(async () => edit(form.title));
    await act(async () => server.release());

    expect(server.patchEvent).toHaveBeenCalledTimes(2);
    expect(server.stored().recurrenceOverrides?.[rid]?.title).toBe(form.title);
  });

  it("after a failed write the next one sends that change again", async () => {
    const server = fakeServer(dentist);
    const autosave = renderAutosave(server);
    const form = { ...calendarEventToForm(dentist), title: "Meet" };

    server.fail();
    await act(async () => autosave({ mode: "edit", eventId: "dentist", form }));
    await act(async () =>
      autosave({ mode: "edit", eventId: "dentist", form: { ...form, description: "Notes" } }),
    );

    expect(server.stored().title).toBe("Meet");
    expect(server.stored().description).toBe("Notes");
  });
});
