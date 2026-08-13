import { describe, expect, it } from "vitest";
import {
  eventIsRecurringSeries,
  splitOccurrenceKey,
  truncateRecurrenceRules,
  untilBeforeRecurrenceId,
} from "@/calendar-core/src/calendar-recurrence-scope";

describe("calendar-recurrence-scope", () => {
  it("splits occurrence keys", () => {
    expect(splitOccurrenceKey("master")).toEqual({ masterId: "master" });
    expect(splitOccurrenceKey("master::2026-01-01T10:00:00")).toEqual({
      masterId: "master",
      recurrenceId: "2026-01-01T10:00:00",
    });
  });

  it("detects recurring series from wire rules", () => {
    expect(eventIsRecurringSeries({ recurrenceRules: undefined })).toBe(false);
    expect(
      eventIsRecurringSeries({
        recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "weekly" }],
      }),
    ).toBe(true);
  });

  it("computes until before a timed recurrence id", () => {
    expect(untilBeforeRecurrenceId("2033-01-12T10:00:00", false)).toBe("2033-01-12T09:59:59");
  });

  it("computes until before an all-day recurrence id", () => {
    expect(untilBeforeRecurrenceId("2033-01-12", true)).toBe("2033-01-11");
  });

  it("truncates recurrence rules with until and drops count", () => {
    expect(
      truncateRecurrenceRules(
        [{ "@type": "RecurrenceRule", frequency: "weekly", count: 10 }],
        "2033-01-11",
      ),
    ).toEqual([{ "@type": "RecurrenceRule", frequency: "weekly", until: "2033-01-11" }]);
  });
});
