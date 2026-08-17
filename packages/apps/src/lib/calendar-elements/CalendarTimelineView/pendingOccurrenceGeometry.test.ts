import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  occurrenceTimesWithPending,
  pendingCreateRetention,
  pendingOccurrenceRetention,
  shouldRevertPendingGeometry,
  type PendingCreateGeometry,
  type PendingOccurrenceGeometry,
} from "./pendingOccurrenceGeometry.js";

const key = "series-1::2026-08-17T10:00:00";

function dt(iso: string): Temporal.PlainDateTime {
  return Temporal.PlainDateTime.from(iso);
}

function pending(
  start = "2026-08-17T11:00:00",
  end = "2026-08-17T12:00:00",
): PendingOccurrenceGeometry {
  return { key, start: dt(start), end: dt(end) };
}

describe("occurrenceTimesWithPending", () => {
  it("returns engine times when nothing is pending", () => {
    const engine = { start: dt("2026-08-17T10:00:00"), end: dt("2026-08-17T11:00:00") };
    expect(occurrenceTimesWithPending(key, engine, null)).toEqual(engine);
  });

  it("overrides the matching occurrence with the suggested range", () => {
    const engine = { start: dt("2026-08-17T10:00:00"), end: dt("2026-08-17T11:00:00") };
    const next = pending();
    expect(occurrenceTimesWithPending(key, engine, next)).toEqual({
      start: next.start,
      end: next.end,
    });
  });

  it("leaves other occurrences on their engine times", () => {
    const engine = { start: dt("2026-08-18T10:00:00"), end: dt("2026-08-18T11:00:00") };
    expect(occurrenceTimesWithPending("other", engine, pending())).toEqual(engine);
  });
});

describe("pendingOccurrenceRetention", () => {
  it("keeps the overlay while the engine still has the original slot", () => {
    const map = new Map([
      [key, { start: dt("2026-08-17T10:00:00"), end: dt("2026-08-17T11:00:00") }],
    ]);
    expect(pendingOccurrenceRetention(pending(), map)).toBe("keep");
  });

  it("clears once the engine stores the suggested times", () => {
    const next = pending();
    const map = new Map([[key, { start: next.start, end: next.end }]]);
    expect(pendingOccurrenceRetention(next, map)).toBe("clear");
  });

  it("clears when the occurrence key is gone (this-and-future fork)", () => {
    expect(pendingOccurrenceRetention(pending(), new Map())).toBe("clear");
  });
});

describe("shouldRevertPendingGeometry", () => {
  it("reverts only when the update was cancelled or unhandled", () => {
    expect(shouldRevertPendingGeometry({ handled: true, accepted: false })).toBe(true);
    expect(shouldRevertPendingGeometry({ handled: false, accepted: true })).toBe(true);
    expect(shouldRevertPendingGeometry({ handled: true, accepted: true })).toBe(false);
  });
});

describe("pendingCreateRetention", () => {
  const createPending = (
    start = "2026-08-17T11:00:00",
    end = "2026-08-17T12:00:00",
    allDay = false,
  ): PendingCreateGeometry => ({
    start: dt(start),
    end: dt(end),
    allDay,
  });

  it("keeps the create card while no engine event occupies the slot", () => {
    expect(pendingCreateRetention(createPending(), [])).toBe("keep");
    expect(
      pendingCreateRetention(createPending(), [
        { start: dt("2026-08-17T09:00:00"), end: dt("2026-08-17T10:00:00"), allDay: false },
      ]),
    ).toBe("keep");
  });

  it("clears once a real event matches the suggested range", () => {
    const pending = createPending();
    expect(
      pendingCreateRetention(pending, [{ start: pending.start, end: pending.end, allDay: false }]),
    ).toBe("clear");
  });

  it("does not treat an all-day event as filling a timed create slot", () => {
    const pending = createPending("2026-08-17T00:00:00", "2026-08-18T00:00:00", false);
    expect(
      pendingCreateRetention(pending, [{ start: pending.start, end: pending.end, allDay: true }]),
    ).toBe("keep");
  });
});
