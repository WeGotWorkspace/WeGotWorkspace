import { Temporal } from "@js-temporal/polyfill";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEventEnd } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations, CalendarUIData } from "@/calendar-core/src/calendar-types";
import { useCalendarSurface } from "@/calendar-core/src/use-calendar-surface";

const adapterGetEvents = vi.fn(() => new Map());

vi.mock("@/lib/jmap-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jmap-client")>("@/lib/jmap-client");
  class MockAdapter {
    getEvents = adapterGetEvents;
    initialize = vi.fn(async () => undefined);
    startPolling = vi.fn();
    stopPolling = vi.fn();
    sync = vi.fn(async () => undefined);
    flush = vi.fn(async () => undefined);
    jmapIdForKey = vi.fn((key: string) => key);
  }
  return { ...actual, JmapEventsAdapter: MockAdapter };
});

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

const dentist: JmapCalendarEvent = {
  "@type": "Event",
  id: "dentist",
  uid: "urn:uuid:dentist",
  title: "Dentist",
  start: "2033-01-12T11:00:00",
  duration: "PT45M",
  calendarIds: { work: true },
} as JmapCalendarEvent;

const data: CalendarUIData = {
  calendars: [{ id: "work", name: "Work", color: "#0ea5e9", isDefault: true }],
  events: [dentist],
};

const fakeClient = {} as import("@/lib/jmap-client").JmapClient;

describe("useCalendarSurface", () => {
  beforeEach(() => {
    adapterGetEvents.mockReset();
    adapterGetEvents.mockReturnValue(new Map());
  });

  it.each([true, false] as const)(
    "uses the same EventsAPI context when online is %s and never paints adapter.getEvents",
    async (online) => {
      void online;
      const operations = operationsStub();
      const { result } = renderHook(() =>
        useCalendarSurface(fakeClient, data, "ada@example.com", { operations }),
      );

      expect(result.current.contextValue).toBeDefined();
      expect(result.current.contextValue).not.toBeInstanceOf(
        (await import("@/lib/jmap-client")).JmapEventsAdapter,
      );
      expect(result.current.events.get("dentist")?.eventId).toBe("dentist");

      act(() => {
        result.current.contextValue?.create({
          event: {
            calendarId: "work",
            data: {
              summary: "New",
              start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
              duration: Temporal.Duration.from("PT1H"),
            },
          },
        });
      });

      await waitFor(() => expect(operations.createEvent).toHaveBeenCalled());
      expect(adapterGetEvents).not.toHaveBeenCalled();
      expect(
        [...result.current.events.values()].some((event) => event.data.summary === "New"),
      ).toBe(true);
    },
  );

  it("keeps painted cards when bootstrap events go empty (reconnect must not wipe)", () => {
    const operations = operationsStub();
    const { result, rerender } = renderHook(
      ({ next }: { next: CalendarUIData }) =>
        useCalendarSurface(fakeClient, next, "ada@example.com", { operations }),
      { initialProps: { next: data } },
    );

    expect(result.current.events.size).toBeGreaterThan(0);

    rerender({ next: { ...data, events: [] } });

    expect(result.current.events.size).toBeGreaterThan(0);
    expect(result.current.events.get("dentist")?.eventId).toBe("dentist");
  });

  it("keeps an offline delete off the grid when cache is stale", async () => {
    const operations = operationsStub();
    const { result } = renderHook(() =>
      useCalendarSurface(fakeClient, data, "ada@example.com", { operations }),
    );

    act(() => {
      result.current.contextValue?.remove({ target: { key: "dentist" }, scope: "single" });
    });

    await waitFor(() => expect(operations.deleteEvent).toHaveBeenCalledWith("dentist"));
    expect(result.current.events.has("dentist")).toBe(false);
  });

  it("does not snap a pending move back to the stale cache slot", () => {
    const operations = operationsStub();
    const { result } = renderHook(() =>
      useCalendarSurface(fakeClient, data, "ada@example.com", { operations }),
    );

    act(() => {
      result.current.contextValue?.move({
        target: { key: "dentist" },
        scope: "single",
        delta: Temporal.Duration.from("PT1H"),
      });
    });

    expect(result.current.events.get("dentist")?.data.start.toString()).toBe("2033-01-12T12:00:00");
  });

  it("does not snap a pending resize back to the stale cache duration", () => {
    const operations = operationsStub();
    const { result, rerender } = renderHook(
      ({ next }: { next: CalendarUIData }) =>
        useCalendarSurface(fakeClient, next, "ada@example.com", { operations }),
      { initialProps: { next: data } },
    );

    act(() => {
      result.current.contextValue?.resizeEnd({
        target: { key: "dentist" },
        scope: "single",
        toEnd: Temporal.PlainDateTime.from("2033-01-12T13:00:00"),
      });
    });
    expect(resolveEventEnd(result.current.events.get("dentist")!.data).toString()).toBe(
      "2033-01-12T13:00:00",
    );

    rerender({ next: { ...data, events: [{ ...dentist }] } });

    expect(resolveEventEnd(result.current.events.get("dentist")!.data).toString()).toBe(
      "2033-01-12T13:00:00",
    );
  });

  it("keeps an in-flight resize when operations identity changes (bootstrap refresh)", () => {
    const { result, rerender } = renderHook(
      ({ ops, next }: { ops: CalendarAPIOperations; next: CalendarUIData }) =>
        useCalendarSurface(fakeClient, next, "ada@example.com", { operations: ops }),
      { initialProps: { ops: operationsStub(), next: data } },
    );

    act(() => {
      result.current.contextValue?.resizeEnd({
        target: { key: "dentist" },
        scope: "single",
        toEnd: Temporal.PlainDateTime.from("2033-01-12T13:00:00"),
      });
    });

    rerender({ ops: operationsStub(), next: { ...data, events: [{ ...dentist }] } });

    expect(resolveEventEnd(result.current.events.get("dentist")!.data).toString()).toBe(
      "2033-01-12T13:00:00",
    );
  });
});
