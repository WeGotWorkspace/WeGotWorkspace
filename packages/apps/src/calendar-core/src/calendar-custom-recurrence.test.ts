import { describe, expect, it } from "vitest";
import {
  customRecurrenceFrequencyOptions,
  customRecurrenceInterval,
  customRecurrenceShowsByDay,
  patchCustomRecurrenceRule,
  seedCustomRecurrenceRules,
  toggleCustomRecurrenceDay,
} from "@/calendar-core/src/calendar-custom-recurrence";

describe("seedCustomRecurrenceRules", () => {
  it("seeds weekly on the start weekday from Does not repeat", () => {
    expect(
      seedCustomRecurrenceRules({
        recurrencePreset: "none",
        startDate: "2033-01-12",
      }),
    ).toEqual([
      {
        "@type": "RecurrenceRule",
        frequency: "weekly",
        byDay: [{ "@type": "NDay", day: "we" }],
      },
    ]);
  });

  it("seeds from the current named preset", () => {
    expect(
      seedCustomRecurrenceRules({
        recurrencePreset: "daily",
        startDate: "2033-01-12",
      }),
    ).toEqual([{ "@type": "RecurrenceRule", frequency: "daily" }]);
  });

  it("keeps an existing custom rule", () => {
    const custom = [
      {
        "@type": "RecurrenceRule" as const,
        frequency: "monthly" as const,
        interval: 2,
      },
    ];
    expect(
      seedCustomRecurrenceRules({
        recurrencePreset: "custom",
        startDate: "2033-01-12",
        customRecurrenceRules: custom,
      }),
    ).toBe(custom);
  });
});

describe("patchCustomRecurrenceRule / toggleCustomRecurrenceDay", () => {
  it("omits interval 1 and stores interval 2", () => {
    const daily = { "@type": "RecurrenceRule" as const, frequency: "daily" as const };
    expect(
      patchCustomRecurrenceRule(daily, { interval: 1 }, "2033-01-12").interval,
    ).toBeUndefined();
    expect(patchCustomRecurrenceRule(daily, { interval: 2 }, "2033-01-12").interval).toBe(2);
  });

  it("seeds by-day when switching to weekly", () => {
    const next = patchCustomRecurrenceRule(
      { "@type": "RecurrenceRule", frequency: "daily" },
      { frequency: "weekly" },
      "2033-01-12",
    );
    expect(next.byDay).toEqual([{ "@type": "NDay", day: "we" }]);
  });

  it("toggles weekdays and refuses to clear the last weekly day", () => {
    const weekly = {
      "@type": "RecurrenceRule" as const,
      frequency: "weekly" as const,
      byDay: [{ "@type": "NDay" as const, day: "we" as const }],
    };
    const withMonday = toggleCustomRecurrenceDay(weekly, "mo");
    expect(withMonday.byDay?.map((entry) => entry.day)).toEqual(["we", "mo"]);
    expect(toggleCustomRecurrenceDay(weekly, "we")).toEqual(weekly);
  });

  it("lists an unmatched frequency first so reopen does not flatten it", () => {
    expect(customRecurrenceFrequencyOptions("hourly")).toEqual([
      "hourly",
      "daily",
      "weekly",
      "monthly",
      "yearly",
    ]);
    expect(customRecurrenceInterval({ frequency: "weekly" })).toBe(1);
    expect(customRecurrenceShowsByDay({ frequency: "daily" })).toBe(false);
    expect(customRecurrenceShowsByDay({ frequency: "weekly" })).toBe(true);
  });
});
