import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { RRuleSet } from "rrule";
import { expandRecurringStarts } from "./rrule-adapter.js";
import { createDailySeriesState } from "../tests/support/mockEvents.js";

describe("expandRecurringStarts memo", () => {
  it("reuses RRule.between for the same event object and range", () => {
    const betweenSpy = vi.spyOn(RRuleSet.prototype, "between");
    const event = createDailySeriesState().get("daily")!;
    const rangeStart = Temporal.PlainDateTime.from("2025-01-13T00:00:00");
    const rangeEnd = Temporal.PlainDateTime.from("2025-01-20T00:00:00");

    const first = expandRecurringStarts(event, rangeStart, rangeEnd, { timezone: "UTC" });
    const second = expandRecurringStarts(event, rangeStart, rangeEnd, { timezone: "UTC" });

    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(0);
    expect(betweenSpy).toHaveBeenCalledTimes(1);
    betweenSpy.mockRestore();
  });

  it("recomputes when the requested range changes", () => {
    const betweenSpy = vi.spyOn(RRuleSet.prototype, "between");
    const event = createDailySeriesState().get("daily")!;
    expandRecurringStarts(
      event,
      Temporal.PlainDateTime.from("2025-01-13T00:00:00"),
      Temporal.PlainDateTime.from("2025-01-16T00:00:00"),
      { timezone: "UTC" },
    );
    expandRecurringStarts(
      event,
      Temporal.PlainDateTime.from("2025-01-16T00:00:00"),
      Temporal.PlainDateTime.from("2025-01-20T00:00:00"),
      { timezone: "UTC" },
    );
    expect(betweenSpy).toHaveBeenCalledTimes(2);
    betweenSpy.mockRestore();
  });

  it("rebuilds RRuleSet when options.timezone changes for the same event", () => {
    const rruleSpy = vi.spyOn(RRuleSet.prototype, "rrule");
    const event = createDailySeriesState().get("daily")!;
    const rangeStart = Temporal.PlainDateTime.from("2025-01-13T00:00:00");
    const rangeEnd = Temporal.PlainDateTime.from("2025-01-20T00:00:00");

    expandRecurringStarts(event, rangeStart, rangeEnd, { timezone: "UTC" });
    expandRecurringStarts(event, rangeStart, rangeEnd, { timezone: "Europe/Amsterdam" });

    expect(rruleSpy).toHaveBeenCalledTimes(2);
    const tzids = rruleSpy.mock.calls.map((call) => {
      const rule = call[0] as {
        options?: { tzid?: string | null };
        origOptions?: { tzid?: string | null };
      };
      return rule.options?.tzid ?? rule.origOptions?.tzid ?? null;
    });
    expect(tzids).toEqual(["UTC", "Europe/Amsterdam"]);
    rruleSpy.mockRestore();
  });
});
