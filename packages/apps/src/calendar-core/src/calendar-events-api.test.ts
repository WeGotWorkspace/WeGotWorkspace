import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";
import {
  expandEvents,
  isThisInstanceOverride,
  resolveEventEnd,
  type CalendarEvent,
} from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import {
  alignOfflineEventIds,
  calendarInfosToEngineMap,
  createCalendarEventsApi,
  liveHasRemappedOptimisticEvent,
  mergeOfflineCacheEvents,
  persistCalendarEventChanges,
} from "@/calendar-core/src/calendar-events-api";
import { applyCalendarEventPatch } from "@/lib/offline/calendars/calendars-patch-merge";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import { resolveEventMapKey } from "@/lib/calendar-elements/domain/events-api/resolveEventMapKey.js";

function engineEvent(
  id: string,
  summary = "Standup",
  start = "2033-01-10T10:00:00",
): CalendarEvent {
  return {
    eventId: id,
    calendarId: "work",
    data: {
      summary,
      start: Temporal.PlainDateTime.from(start),
      duration: Temporal.Duration.from("PT30M"),
    },
  };
}

function operationsStub(): CalendarAPIOperations {
  return {
    createEvent: vi.fn(
      async (draft) =>
        ({
          "@type": "Event",
          id: draft.id ?? "local-1",
          uid: `urn:uuid:${draft.id ?? "local-1"}`,
          title: draft.title,
          start: draft.start,
          duration: draft.duration,
          calendarIds: { [draft.calendarId]: true },
        }) as JmapCalendarEvent,
    ),
    patchEvent: vi.fn(
      async (eventId) =>
        ({
          "@type": "Event",
          id: eventId,
          uid: `urn:uuid:${eventId}`,
          title: "Patched",
          start: "2033-01-10T11:00:00",
          duration: "PT30M",
          calendarIds: { work: true },
        }) as JmapCalendarEvent,
    ),
    deleteEvent: vi.fn(async () => undefined),
  };
}

describe("mergeOfflineCacheEvents", () => {
  it("keeps an in-flight overlay move when the cache is still at the old slot", () => {
    const moved = {
      ...engineEvent("ev-1", "Standup", "2033-01-10T11:00:00"),
      pendingOp: "updated" as const,
    };
    const overlay = new Map<string, CalendarEvent>([["ev-1", moved]]);
    const cache = new Map<string, CalendarEvent>([["ev-1", engineEvent("ev-1")]]);

    const merged = mergeOfflineCacheEvents(overlay, cache);
    expect(merged.get("ev-1")?.data.start.toString()).toBe("2033-01-10T11:00:00");
  });

  it("keeps an in-flight overlay resize when the cache still has the old duration", () => {
    const resized: CalendarEvent = {
      eventId: "ev-1",
      calendarId: "work",
      pendingOp: "updated",
      data: {
        summary: "Standup",
        start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-10T12:00:00"),
      },
    };
    const overlay = new Map<string, CalendarEvent>([["ev-1", resized]]);
    const cache = new Map<string, CalendarEvent>([["ev-1", engineEvent("ev-1")]]);

    const merged = mergeOfflineCacheEvents(overlay, cache);
    expect(resolveEventEnd(merged.get("ev-1")!.data).toString()).toBe("2033-01-10T12:00:00");
    expect(merged.get("ev-1")?.data.start.toString()).toBe("2033-01-10T10:00:00");
  });

  it("lets cache win on a shared key and keeps overlay-only local creates", () => {
    const stale = {
      ...engineEvent("local-1"),
      data: { ...engineEvent("local-1").data, summary: "Stale" },
    };
    const patched = {
      ...engineEvent("local-1"),
      data: { ...engineEvent("local-1").data, summary: "Patched" },
    };
    const overlay = new Map<string, CalendarEvent>([
      ["local-1", stale],
      ["local-2", engineEvent("local-2")],
    ]);
    const cache = new Map<string, CalendarEvent>([["local-1", patched]]);

    const merged = mergeOfflineCacheEvents(overlay, cache);
    expect(merged.get("local-1")?.data.summary).toBe("Patched");
    expect(merged.get("local-2")?.eventId).toBe("local-2");
  });

  it("collapses a remapped local- create onto the cache server id", () => {
    const overlay = new Map<string, CalendarEvent>([["local-temp", engineEvent("local-temp")]]);
    const cache = new Map<string, CalendarEvent>([["ev-server", engineEvent("ev-server")]]);

    expect(liveHasRemappedOptimisticEvent("local-temp", engineEvent("local-temp"), cache)).toBe(
      true,
    );
    const merged = mergeOfflineCacheEvents(overlay, cache);
    expect(merged.has("local-temp")).toBe(false);
    expect(merged.size).toBe(1);
    expect(merged.get("ev-server")?.eventId).toBe("ev-server");
  });

  it("keeps an unmatched local- create when the cache row is a different event", () => {
    const overlay = new Map<string, CalendarEvent>([
      ["local-temp", engineEvent("local-temp", "New", "2033-01-11T09:00:00")],
    ]);
    const cache = new Map<string, CalendarEvent>([["ev-server", engineEvent("ev-server")]]);

    expect(
      liveHasRemappedOptimisticEvent(
        "local-temp",
        engineEvent("local-temp", "New", "2033-01-11T09:00:00"),
        cache,
      ),
    ).toBe(false);
    const merged = mergeOfflineCacheEvents(overlay, cache);
    expect(merged.has("local-temp")).toBe(true);
    expect(merged.get("ev-server")?.eventId).toBe("ev-server");
  });

  it("drops a cache local- row once the remapped server id is present", () => {
    const cache = new Map<string, CalendarEvent>([
      ["local-temp", engineEvent("local-temp")],
      ["ev-server", engineEvent("ev-server")],
    ]);

    const merged = mergeOfflineCacheEvents(undefined, cache);
    expect(merged.has("local-temp")).toBe(false);
    expect(merged.size).toBe(1);
    expect(merged.get("ev-server")?.eventId).toBe("ev-server");
  });

  it("applies a pending overlay slot onto the remapped server key", () => {
    const moved = {
      ...engineEvent("local-temp", "Standup", "2033-01-10T11:00:00"),
      pendingOp: "updated" as const,
    };
    const overlay = new Map<string, CalendarEvent>([["local-temp", moved]]);
    const cache = new Map<string, CalendarEvent>([["ev-server", engineEvent("ev-server")]]);

    const merged = mergeOfflineCacheEvents(overlay, cache);
    expect(merged.has("local-temp")).toBe(false);
    expect(merged.get("ev-server")?.data.start.toString()).toBe("2033-01-10T11:00:00");
    expect(merged.get("ev-server")?.eventId).toBe("ev-server");
  });

  it("alignOfflineEventIds rewrites a JSCalendar uid to the map key", () => {
    const events = new Map<string, CalendarEvent>([
      [
        "local-abc",
        {
          ...engineEvent("urn:uuid:local-abc"),
          eventId: "urn:uuid:local-abc",
        },
      ],
    ]);
    expect(alignOfflineEventIds(events).get("local-abc")?.eventId).toBe("local-abc");
  });
});

describe("createCalendarEventsApi", () => {
  const calendars = [{ id: "work", name: "Work", color: "#0ea5e9", isDefault: true }];

  it("joins cached CalendarInfo colors into getCalendars()", () => {
    const context = createCalendarEventsApi({
      getEvents: () => new Map(),
      calendars,
      operations: operationsStub(),
    });

    expect(calendarInfosToEngineMap(calendars).get("work")?.color).toBe("#0ea5e9");
    expect(context.getCalendars().get("work")?.color).toBe("#0ea5e9");
  });

  it("routes create through hybrid operations", async () => {
    const operations = operationsStub();
    const context = createCalendarEventsApi({
      getEvents: () => new Map(),
      calendars,
      operations,
    });

    context.create({
      event: {
        calendarId: "work",
        data: {
          summary: "New",
          start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
          duration: Temporal.Duration.from("PT1H"),
        },
      },
    });

    await vi.waitFor(() => expect(operations.createEvent).toHaveBeenCalled());
  });

  it("stamps a temp id on create so a later move/patch uses that id", async () => {
    const operations = operationsStub();
    const overlay: { current?: Map<string, CalendarEvent> } = {};
    const context = createCalendarEventsApi({
      getEvents: () => overlay.current ?? new Map(),
      calendars,
      operations,
      onEventsChanged: (events) => {
        overlay.current = events;
      },
    });

    const created = context.create({
      event: {
        calendarId: "work",
        data: {
          summary: "New",
          start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
          duration: Temporal.Duration.from("PT1H"),
        },
      },
    });
    const createdKey = [...created.nextState.keys()][0];
    expect(createdKey).toMatch(/^local-/);
    expect(created.nextState.get(createdKey)?.eventId).toBe(createdKey);

    await vi.waitFor(() => {
      expect(operations.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: createdKey, calendarId: "work", title: "New" }),
      );
    });

    context.move({
      target: { key: createdKey },
      scope: "single",
      delta: Temporal.Duration.from("PT1H"),
    });

    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenCalledWith(
        createdKey,
        expect.objectContaining({ start: "2033-01-11T10:00:00" }),
      );
    });
  });

  it("patches by engine map key when eventId is a JSCalendar uid", async () => {
    const operations = operationsStub();
    const events = new Map<string, CalendarEvent>([
      [
        "local-abc",
        {
          eventId: "urn:uuid:local-abc",
          calendarId: "work",
          data: {
            summary: "Standup",
            start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
            duration: Temporal.Duration.from("PT30M"),
          },
        },
      ],
    ]);
    const context = createCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations,
    });

    context.move({
      target: { key: "local-abc" },
      scope: "single",
      delta: Temporal.Duration.from("PT1H"),
    });

    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenCalledWith(
        "local-abc",
        expect.objectContaining({ start: "2033-01-10T11:00:00" }),
      );
    });
  });

  it("addException patches recurrenceOverrides on the master instead of creating (#609)", async () => {
    const operations = operationsStub();
    const events = new Map<string, CalendarEvent>([
      [
        "ev-1",
        {
          eventId: "ev-1",
          calendarId: "work",
          isRecurring: true,
          data: {
            summary: "Daily",
            start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
            duration: Temporal.Duration.from("PT30M"),
            recurrenceRule: { freq: "DAILY", interval: 1, count: 3 },
          },
        },
      ],
    ]);
    const context = createCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations,
    });

    context.addException({
      target: { key: "ev-1" },
      recurrenceId: "20330111T100000",
      event: {
        start: Temporal.PlainDateTime.from("2033-01-11T11:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-11T11:30:00"),
        summary: "Daily",
        calendarId: "work",
      },
    });

    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenCalled();
    });
    expect(operations.createEvent).not.toHaveBeenCalled();
    expect(operations.patchEvent).toHaveBeenCalledWith(
      "ev-1",
      expect.objectContaining({
        recurrenceOverrides: expect.objectContaining({
          "2033-01-11T10:00:00": expect.objectContaining({
            start: "2033-01-11T11:00:00",
          }),
        }),
      }),
    );
  });

  it("moving a detached exception patches only that override, not the series start (#609)", async () => {
    const operations = operationsStub();
    const events = new Map<string, CalendarEvent>([
      [
        "ev-1",
        {
          eventId: "ev-1",
          calendarId: "work",
          isRecurring: true,
          data: {
            summary: "Daily",
            start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
            duration: Temporal.Duration.from("PT30M"),
            recurrenceRule: { freq: "DAILY", interval: 1, count: 3 },
          },
        },
      ],
    ]);
    const context = createCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations,
    });

    context.addException({
      target: { key: "ev-1" },
      recurrenceId: "20330111T100000",
      event: {
        start: Temporal.PlainDateTime.from("2033-01-11T11:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-11T11:30:00"),
        summary: "Daily",
        calendarId: "work",
      },
    });
    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenCalled();
    });
    vi.mocked(operations.patchEvent).mockClear();

    context.move({
      target: { key: "ev-1::20330111T100000" },
      scope: "single",
      delta: Temporal.Duration.from("PT2H"),
    });

    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenCalled();
    });
    expect(operations.createEvent).not.toHaveBeenCalled();
    expect(operations.patchEvent).toHaveBeenCalledWith(
      "ev-1",
      expect.objectContaining({
        recurrenceOverrides: expect.objectContaining({
          "2033-01-11T10:00:00": expect.objectContaining({
            start: "2033-01-11T13:00:00",
          }),
        }),
      }),
    );
    const lastPatch = vi.mocked(operations.patchEvent).mock.calls.at(-1)?.[1];
    expect(lastPatch?.start).toBeUndefined();
  });

  it("second exception move still excludes the original rid after persist+reload", async () => {
    const range = {
      start: Temporal.PlainDateTime.from("2033-01-10T00:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-13T00:00:00"),
    };
    const masterWire = {
      "@type": "Event",
      id: "ev-1",
      uid: "urn:uuid:ev-1",
      title: "Daily",
      start: "2033-01-10T10:00:00",
      duration: "PT30M",
      calendarIds: { work: true },
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 3 }],
    } as JmapCalendarEvent;

    let wire = masterWire;
    const operations = operationsStub();
    vi.mocked(operations.patchEvent).mockImplementation(async (_id, patch) => {
      wire = applyCalendarEventPatch(wire, patch);
      return wire;
    });

    const overlay: { current?: Map<string, CalendarEvent> } = {};
    const context = createCalendarEventsApi({
      getEvents: () => overlay.current ?? calendarEventsToEngineMap([wire]),
      calendars,
      operations,
      onEventsChanged: (events) => {
        overlay.current = events;
      },
    });

    context.addException({
      target: { key: "ev-1" },
      recurrenceId: "20330111T100000",
      event: {
        start: Temporal.PlainDateTime.from("2033-01-11T11:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-11T11:30:00"),
        summary: "Daily",
        calendarId: "work",
      },
    });
    await vi.waitFor(() => expect(operations.patchEvent).toHaveBeenCalled());
    context.replaceEvents(calendarEventsToEngineMap([wire]));

    const afterFirst = expandEvents(context.getEvents(), range);
    expect([...afterFirst.values()].map((event) => event.data.start.toString()).sort()).toEqual([
      "2033-01-10T10:00:00",
      "2033-01-11T11:00:00",
      "2033-01-12T10:00:00",
    ]);

    const eventKey = resolveEventMapKey(context.getEvents(), {
      eventId: "ev-1",
      recurrenceId: "20330111T110000",
    });
    vi.mocked(operations.patchEvent).mockClear();
    context.move({
      target: { key: eventKey ?? "ev-1" },
      scope: "single",
      delta: Temporal.Duration.from("PT2H"),
    });
    await vi.waitFor(() => expect(operations.patchEvent).toHaveBeenCalled());
    context.replaceEvents(calendarEventsToEngineMap([wire]));

    const afterSecond = expandEvents(context.getEvents(), range);
    expect([...afterSecond.values()].map((event) => event.data.start.toString()).sort()).toEqual([
      "2033-01-10T10:00:00",
      "2033-01-11T13:00:00",
      "2033-01-12T10:00:00",
    ]);
    expect(wire.start).toBe("2033-01-10T10:00:00");
    expect(wire.recurrenceOverrides?.["2033-01-11T10:00:00"]).toEqual(
      expect.objectContaining({ start: "2033-01-11T13:00:00" }),
    );
  });

  it("persists a :: occurrence row as overrides when isThisInstanceOverride is false", async () => {
    const operations = operationsStub();
    const master: CalendarEvent = {
      eventId: "ev-1",
      calendarId: "work",
      isRecurring: true,
      data: {
        summary: "Daily",
        start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
        duration: Temporal.Duration.from("PT30M"),
        recurrenceRule: { freq: "DAILY", interval: 1, count: 3 },
        exclusionDates: new Set(["20330111T100000"]),
      },
    };
    const exception: CalendarEvent = {
      eventId: "ev-1",
      calendarId: "work",
      recurrenceId: "20330111T100000",
      data: {
        summary: "Daily",
        start: Temporal.PlainDateTime.from("2033-01-11T13:00:00"),
        duration: Temporal.Duration.from("PT30M"),
        recurrenceRule: { freq: "DAILY", interval: 1, count: 3 },
        exclusionDates: new Set(["20330111T100000"]),
      },
    };
    const nextState = new Map<string, CalendarEvent>([
      ["ev-1", master],
      ["ev-1::20330111T100000", exception],
    ]);
    expect(isThisInstanceOverride(nextState, "ev-1::20330111T100000")).toBe(false);

    await persistCalendarEventChanges(operations, {
      nextState,
      changes: [
        { type: "updated", key: "ev-1::20330111T100000", before: exception, after: exception },
      ],
      effects: [],
    });

    expect(operations.createEvent).not.toHaveBeenCalled();
    expect(operations.patchEvent).toHaveBeenCalledWith(
      "ev-1",
      expect.objectContaining({
        recurrenceOverrides: expect.objectContaining({
          "2033-01-11T10:00:00": expect.objectContaining({
            start: "2033-01-11T13:00:00",
          }),
        }),
      }),
    );
    expect(vi.mocked(operations.patchEvent).mock.calls.at(-1)?.[1]?.start).toBeUndefined();
  });

  it("addExclusion patches excluded recurrenceOverrides on the master (#609)", async () => {
    const operations = operationsStub();
    const events = new Map<string, CalendarEvent>([
      [
        "ev-1",
        {
          eventId: "ev-1",
          calendarId: "work",
          isRecurring: true,
          data: {
            summary: "Daily",
            start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
            duration: Temporal.Duration.from("PT30M"),
            recurrenceRule: { freq: "DAILY", interval: 1, count: 3 },
          },
        },
      ],
    ]);
    const context = createCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations,
    });

    context.addExclusion({
      target: { key: "ev-1" },
      recurrenceId: "20330111T100000",
    });

    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenCalled();
    });
    expect(operations.createEvent).not.toHaveBeenCalled();
    expect(operations.patchEvent).toHaveBeenCalledWith(
      "ev-1",
      expect.objectContaining({
        recurrenceOverrides: {
          "2033-01-11T10:00:00": { excluded: true },
        },
      }),
    );
  });

  it("routes patch and delete through hybrid operations", async () => {
    const operations = operationsStub();
    const events = new Map<string, CalendarEvent>([["ev-1", engineEvent("ev-1")]]);
    const onPersisted = vi.fn();
    const context = createCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations,
      onPersisted,
    });

    context.update({
      target: { key: "ev-1" },
      scope: "single",
      patch: { summary: "Moved" },
    });
    await vi.waitFor(() => expect(operations.patchEvent).toHaveBeenCalled());

    const deleteContext = createCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations,
      onPersisted,
    });
    deleteContext.remove({ target: { key: "ev-1" }, scope: "single" });

    await vi.waitFor(() => {
      expect(operations.deleteEvent).toHaveBeenCalledWith("ev-1");
      expect(onPersisted).toHaveBeenCalled();
    });
  });

  it("replaceEvents applies a dialog title patch and notifies listeners", () => {
    const onEventsChanged = vi.fn();
    const events = new Map<string, CalendarEvent>([["ev-1", engineEvent("ev-1")]]);
    const context = createCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations: operationsStub(),
      onEventsChanged,
    });

    context.replaceEvents(
      new Map([
        [
          "ev-1",
          {
            ...engineEvent("ev-1"),
            data: { ...engineEvent("ev-1").data, summary: "Renamed offline" },
          },
        ],
      ]),
    );

    expect(context.getEvents().get("ev-1")?.data.summary).toBe("Renamed offline");
    expect(onEventsChanged).toHaveBeenCalledTimes(1);
    expect(onEventsChanged.mock.calls[0]?.[0]).not.toBe(events);
    expect(onEventsChanged.mock.calls[0]?.[0].get("ev-1")?.data.summary).toBe("Renamed offline");
  });

  it("replaceEvents overlays cache fields onto a stale create row", () => {
    const onEventsChanged = vi.fn();
    const overlay: { current?: Map<string, CalendarEvent> } = {};
    const context = createCalendarEventsApi({
      getEvents: () => overlay.current ?? new Map(),
      calendars,
      operations: operationsStub(),
      onEventsChanged: (events) => {
        overlay.current = events;
        onEventsChanged(events);
      },
    });

    const created = context.create({
      event: {
        calendarId: "work",
        data: {
          summary: "New",
          start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
          duration: Temporal.Duration.from("PT1H"),
        },
      },
    });
    const createdKey = [...created.nextState.keys()][0]!;
    onEventsChanged.mockClear();

    context.replaceEvents(
      new Map([
        [
          createdKey,
          {
            eventId: "urn:uuid:other",
            calendarId: "work",
            data: {
              summary: "Renamed offline",
              start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
              duration: Temporal.Duration.from("PT1H"),
            },
          },
        ],
      ]),
    );

    const row = context.getEvents().get(createdKey);
    expect(row?.data.summary).toBe("Renamed offline");
    expect(row?.eventId).toBe(createdKey);
    expect(onEventsChanged).toHaveBeenCalled();
  });

  it("replaceEvents drops a remapped local- overlay key so reconnect paints one card", () => {
    const overlay: { current?: Map<string, CalendarEvent> } = {};
    const context = createCalendarEventsApi({
      getEvents: () => overlay.current ?? new Map([["local-temp", engineEvent("local-temp")]]),
      calendars,
      operations: operationsStub(),
      onEventsChanged: (events) => {
        overlay.current = events;
      },
    });

    context.replaceEvents(new Map([["ev-server", engineEvent("ev-server")]]));

    expect(context.getEvents().has("local-temp")).toBe(false);
    expect(context.getEvents().size).toBe(1);
    expect(context.getEvents().get("ev-server")?.eventId).toBe("ev-server");
  });

  it("replaceEvents does not revert an in-flight resize to the stale cache duration", () => {
    const events = new Map<string, CalendarEvent>([["ev-1", engineEvent("ev-1")]]);
    const context = createCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations: operationsStub(),
    });

    context.resizeEnd({
      target: { key: "ev-1" },
      scope: "single",
      toEnd: Temporal.PlainDateTime.from("2033-01-10T12:00:00"),
    });
    expect(resolveEventEnd(context.getEvents().get("ev-1")!.data).toString()).toBe(
      "2033-01-10T12:00:00",
    );

    context.replaceEvents(new Map([["ev-1", engineEvent("ev-1")]]));

    expect(resolveEventEnd(context.getEvents().get("ev-1")!.data).toString()).toBe(
      "2033-01-10T12:00:00",
    );
  });

  it("resizeEnd persists the new duration instead of the default hour", async () => {
    const operations = operationsStub();
    const events = new Map<string, CalendarEvent>([["ev-1", engineEvent("ev-1")]]);
    const context = createCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations,
    });

    context.resizeEnd({
      target: { key: "ev-1" },
      scope: "single",
      toEnd: Temporal.PlainDateTime.from("2033-01-10T12:00:00"),
    });

    await vi.waitFor(() => {
      expect(operations.patchEvent).toHaveBeenCalledWith(
        "ev-1",
        expect.objectContaining({
          start: "2033-01-10T10:00:00",
          duration: "PT2H",
        }),
      );
    });
  });

  it("apply(move) works after a cache replace from a dialog create", () => {
    const onEventsChanged = vi.fn();
    const context = createCalendarEventsApi({
      getEvents: () => new Map(),
      calendars,
      operations: operationsStub(),
      onEventsChanged,
    });

    context.replaceEvents(
      new Map([
        [
          "local-abc",
          {
            eventId: "urn:uuid:local-abc",
            calendarId: "work",
            data: {
              summary: "New",
              start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
              duration: Temporal.Duration.from("PT1H"),
            },
          },
        ],
      ]),
    );
    expect(context.getEvents().get("local-abc")?.eventId).toBe("local-abc");
    onEventsChanged.mockClear();

    context.move({
      target: { key: "local-abc" },
      scope: "single",
      delta: Temporal.Duration.from("PT1H"),
    });

    expect(context.getEvents().get("local-abc")?.data.start.toString()).toBe("2033-01-11T10:00:00");
    expect(onEventsChanged).toHaveBeenCalled();
  });

  it("move after offline create updates the same map row", () => {
    const onEventsChanged = vi.fn();
    const overlay: { current?: Map<string, CalendarEvent> } = {};
    const context = createCalendarEventsApi({
      getEvents: () => overlay.current ?? new Map(),
      calendars,
      operations: operationsStub(),
      onEventsChanged: (events) => {
        overlay.current = events;
        onEventsChanged(events);
      },
    });

    const created = context.create({
      event: {
        calendarId: "work",
        data: {
          summary: "New",
          start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
          duration: Temporal.Duration.from("PT1H"),
        },
      },
    });
    const createdKey = [...created.nextState.keys()][0]!;
    expect(created.nextState.get(createdKey)?.eventId).toBe(createdKey);
    onEventsChanged.mockClear();

    const moved = context.move({
      target: { key: createdKey },
      scope: "single",
      delta: Temporal.Duration.from("PT1H"),
    });

    expect(moved.changes.some((change) => change.type === "updated")).toBe(true);
    expect(context.getEvents().get(createdKey)?.data.start.toString()).toBe("2033-01-11T10:00:00");
    expect(onEventsChanged).toHaveBeenCalled();
  });

  it.each([true, false] as const)(
    "create / move / delete use the same EventsAPI when online is %s",
    async (online) => {
      void online;
      const operations = operationsStub();
      const overlay: { current?: Map<string, CalendarEvent> } = {};
      const context = createCalendarEventsApi({
        getEvents: () => overlay.current ?? new Map(),
        calendars,
        operations,
        onEventsChanged: (events) => {
          overlay.current = events;
        },
      });

      const created = context.create({
        event: {
          calendarId: "work",
          data: {
            summary: "Same API",
            start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
            duration: Temporal.Duration.from("PT1H"),
          },
        },
      });
      const createdKey = [...created.nextState.keys()][0]!;
      context.move({
        target: { key: createdKey },
        scope: "single",
        delta: Temporal.Duration.from("PT1H"),
      });
      context.remove({ target: { key: createdKey }, scope: "single" });

      await vi.waitFor(() => {
        expect(operations.createEvent).toHaveBeenCalled();
        expect(operations.patchEvent).toHaveBeenCalled();
        expect(operations.deleteEvent).toHaveBeenCalledWith(createdKey);
      });
      expect(context.getEvents().has(createdKey)).toBe(false);
    },
  );
});
