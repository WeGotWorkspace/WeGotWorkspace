import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { EventOperationRequest, EventTarget } from "@/lib/calendar-engine";
import type {
  EventDeleteRequestDetail,
  EventUpdateRequestDetail,
} from "../../types/CalendarEventRequests.js";
import {
  deriveOperation,
  fromCreateRequest,
  fromDeleteRequest,
  fromUpdateRequest,
  moveFromUpdateRequest,
  resizeEndFromUpdateRequest,
  resizeStartFromUpdateRequest,
  toEventTarget,
} from "./adapters.js";

const START = Temporal.PlainDateTime.from("2033-01-10T10:00:00");
const END = Temporal.PlainDateTime.from("2033-01-10T11:00:00");

function updateDetail(
  envelope: Partial<EventUpdateRequestDetail["envelope"]> = {},
): EventUpdateRequestDetail {
  return {
    envelope: { eventId: "ev-1", accountId: "acc", calendarId: "work", ...envelope },
    content: { start: START, end: END, summary: "Standup", color: "#336699" },
  };
}

describe("toEventTarget", () => {
  it("returns an empty key target when the eventId is missing", () => {
    expect(toEventTarget({})).toEqual({ key: "" });
    expect(toEventTarget({ eventId: "", calendarId: "work" })).toEqual({ key: "" });
  });

  it("carries the full reference when an eventId is present", () => {
    expect(
      toEventTarget({
        eventId: "ev-1",
        accountId: "acc",
        calendarId: "work",
        recurrenceId: "20330111T100000",
      }),
    ).toEqual({
      eventId: "ev-1",
      accountId: "acc",
      calendarId: "work",
      recurrenceId: "20330111T100000",
    });
  });
});

describe("fromCreateRequest", () => {
  it("marks the new event as a pending create on the envelope's calendar", () => {
    const input = fromCreateRequest({
      envelope: { accountId: "acc", calendarId: "work" },
      content: { start: START, end: END, summary: "New" },
    });

    expect(input.event.accountId).toBe("acc");
    expect(input.event.calendarId).toBe("work");
    expect(input.event.pendingOp).toBe("created");
    expect(input.event.data).toEqual({ start: START, end: END, summary: "New" });
  });
});

describe("fromUpdateRequest", () => {
  it("patches content and routing fields for a single event", () => {
    const input = fromUpdateRequest(updateDetail());

    expect(input.scope).toBe("single");
    expect(input.target).toEqual({
      eventId: "ev-1",
      accountId: "acc",
      calendarId: "work",
      recurrenceId: undefined,
    });
    expect(input.patch).toMatchObject({
      start: START,
      end: END,
      summary: "Standup",
      color: "#336699",
      calendarId: "work",
      accountId: "acc",
    });
  });

  it("targets the series for a recurring event that is not an exception", () => {
    expect(fromUpdateRequest(updateDetail({ isRecurring: true })).scope).toBe("series");
  });

  it("keeps a recurring exception scoped to the single occurrence", () => {
    expect(fromUpdateRequest(updateDetail({ isRecurring: true, isException: true })).scope).toBe(
      "single",
    );
  });
});

describe("fromDeleteRequest", () => {
  it("removes a single event by default", () => {
    const detail: EventDeleteRequestDetail = {
      envelope: { eventId: "ev-1", accountId: "acc", calendarId: "work" },
    };
    expect(fromDeleteRequest(detail).scope).toBe("single");
  });

  it("removes the whole series for a recurring event, exception or not", () => {
    const detail: EventDeleteRequestDetail = {
      envelope: { eventId: "ev-1", isRecurring: true, recurrenceId: "20330111T100000" },
    };
    expect(fromDeleteRequest(detail).scope).toBe("series");
  });
});

describe("deriveOperation", () => {
  const target: EventTarget = { key: "ev-1" };

  const cases: Array<[EventOperationRequest, string]> = [
    [
      { kind: "create", input: { event: { data: { start: START, end: END, summary: "x" } } } },
      "create",
    ],
    [{ kind: "update", input: { target, scope: "single", patch: {} } }, "update"],
    [
      { kind: "move", input: { target, scope: "single", delta: Temporal.Duration.from("PT1H") } },
      "move",
    ],
    [{ kind: "resizeStart", input: { target, scope: "single", toStart: START } }, "resize-start"],
    [{ kind: "resizeEnd", input: { target, scope: "single", toEnd: END } }, "resize-end"],
    [{ kind: "remove", input: { target, scope: "single" } }, "remove"],
    [{ kind: "addExclusion", input: { target, recurrenceId: "r" } }, "add-exclusion"],
    [{ kind: "removeExclusion", input: { target, recurrenceId: "r" } }, "remove-exclusion"],
    [
      {
        kind: "addException",
        input: { target, recurrenceId: "r", event: { start: START, end: END } },
      },
      "add-exception",
    ],
    [{ kind: "removeException", input: { target, recurrenceId: "r" } }, "remove-exception"],
  ];

  it.each(cases)("maps %o to its operation type", (request, expected) => {
    const operation = deriveOperation(request);
    expect(operation.type).toBe(expected);
    expect(operation.input).toBe(request.input);
  });
});

describe("gesture adapters", () => {
  it("turns an update detail into a move with the given delta", () => {
    const delta = Temporal.Duration.from("PT30M");
    const input = moveFromUpdateRequest(updateDetail({ isRecurring: true }), delta);

    expect(input.delta).toBe(delta);
    expect(input.scope).toBe("series");
  });

  it("resizes the start when the detail carries one", () => {
    expect(resizeStartFromUpdateRequest(updateDetail())?.toStart).toBe(START);
  });

  it("resizes the end when the detail carries one", () => {
    expect(resizeEndFromUpdateRequest(updateDetail())?.toEnd).toBe(END);
  });

  it("returns null when the resized edge is missing", () => {
    const withoutStart = {
      envelope: { eventId: "ev-1" },
      content: { end: END, summary: "x" },
    } as unknown as EventUpdateRequestDetail;
    const withoutEnd = {
      envelope: { eventId: "ev-1" },
      content: { start: START, summary: "x" },
    } as unknown as EventUpdateRequestDetail;

    expect(resizeStartFromUpdateRequest(withoutStart)).toBeNull();
    expect(resizeEndFromUpdateRequest(withoutEnd)).toBeNull();
  });
});
