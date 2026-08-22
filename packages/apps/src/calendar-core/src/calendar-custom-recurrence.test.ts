import { describe, expect, it } from "vitest";
import {
  customRecurrenceDayKind,
  customRecurrenceFrequencyOptions,
  customRecurrenceInterval,
  customRecurrenceOrdinal,
  customRecurrenceRepeatMode,
  customRecurrenceShowsByDay,
  patchCustomRecurrenceOrdinal,
  patchCustomRecurrenceRule,
  seedCustomRecurrenceRules,
  setCustomRecurrenceRepeatMode,
  toggleCustomRecurrenceDay,
  toggleCustomRecurrenceMonth,
  toggleCustomRecurrenceMonthDay,
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
    expect(
      customRecurrenceShowsByDay({
        frequency: "daily",
        byDay: [{ "@type": "NDay", day: "mo" }],
      }),
    ).toBe(false);
    expect(customRecurrenceShowsByDay({ frequency: "monthly" })).toBe(false);
  });

  it("clears leftover by-day when switching to daily", () => {
    const next = patchCustomRecurrenceRule(
      {
        "@type": "RecurrenceRule",
        frequency: "weekly",
        byDay: [{ "@type": "NDay", day: "we" }],
      },
      { frequency: "daily" },
      "2033-01-12",
    );
    expect(next).toEqual({ "@type": "RecurrenceRule", frequency: "daily" });
  });

  it("seeds month days when switching to monthly", () => {
    const next = patchCustomRecurrenceRule(
      { "@type": "RecurrenceRule", frequency: "daily" },
      { frequency: "monthly" },
      "2033-01-12",
    );
    expect(customRecurrenceRepeatMode(next)).toBe("month-days");
    expect(next.byMonthDay).toEqual([12]);
    expect(next.byDay).toBeUndefined();
  });

  it("seeds year months when switching to yearly", () => {
    const next = patchCustomRecurrenceRule(
      { "@type": "RecurrenceRule", frequency: "daily" },
      { frequency: "yearly" },
      "2033-01-12",
    );
    expect(customRecurrenceRepeatMode(next)).toBe("year-months");
    expect(next.byMonth).toEqual(["1"]);
    expect(next.byMonthDay).toEqual([12]);
  });
});

describe("month-day / year-month / ordinal custom rules", () => {
  it("toggles month days and refuses to clear the last one", () => {
    const monthly = {
      "@type": "RecurrenceRule" as const,
      frequency: "monthly" as const,
      byMonthDay: [12],
    };
    const withFifteenth = toggleCustomRecurrenceMonthDay(monthly, 15);
    expect(withFifteenth.byMonthDay).toEqual([12, 15]);
    expect(toggleCustomRecurrenceMonthDay(monthly, 12)).toEqual(monthly);
  });

  it("toggles year months and refuses to clear the last one", () => {
    const yearly = {
      "@type": "RecurrenceRule" as const,
      frequency: "yearly" as const,
      byMonth: ["1"],
      byMonthDay: [12],
    };
    const withMarch = toggleCustomRecurrenceMonth(yearly, 3);
    expect(withMarch.byMonth).toEqual(["1", "3"]);
    expect(toggleCustomRecurrenceMonth(yearly, 1)).toEqual(yearly);
  });

  it("writes nth weekday with nthOfPeriod and weekday-kind with bySetPosition", () => {
    const monthly = {
      "@type": "RecurrenceRule" as const,
      frequency: "monthly" as const,
      byMonthDay: [12],
    };
    const secondWednesday = patchCustomRecurrenceOrdinal(
      monthly,
      { nth: 2, kind: "we" },
      "2033-01-12",
    );
    expect(secondWednesday.byMonthDay).toBeUndefined();
    expect(secondWednesday.byDay).toEqual([{ "@type": "NDay", day: "we", nthOfPeriod: 2 }]);
    expect(customRecurrenceOrdinal(secondWednesday)).toBe(2);
    expect(customRecurrenceDayKind(secondWednesday)).toBe("we");

    const firstWeekday = patchCustomRecurrenceOrdinal(
      secondWednesday,
      { nth: 1, kind: "weekday" },
      "2033-01-12",
    );
    expect(firstWeekday.byDay?.map((entry) => entry.day)).toEqual(["mo", "tu", "we", "th", "fr"]);
    expect(firstWeekday.bySetPosition).toEqual([1]);
    expect(customRecurrenceDayKind(firstWeekday)).toBe("weekday");
  });

  it("switches monthly between month days and last-weekend ordinal", () => {
    const monthly = {
      "@type": "RecurrenceRule" as const,
      frequency: "monthly" as const,
      byMonthDay: [12],
    };
    const ordinal = setCustomRecurrenceRepeatMode(monthly, "ordinal", "2033-01-12");
    expect(customRecurrenceRepeatMode(ordinal)).toBe("ordinal");
    expect(ordinal.byMonthDay).toBeUndefined();
    const lastWeekend = patchCustomRecurrenceOrdinal(
      ordinal,
      { nth: -1, kind: "weekend" },
      "2033-01-12",
    );
    expect(lastWeekend.bySetPosition).toEqual([-1]);
    expect(customRecurrenceDayKind(lastWeekend)).toBe("weekend");
    expect(
      setCustomRecurrenceRepeatMode(lastWeekend, "month-days", "2033-01-12").byMonthDay,
    ).toEqual([12]);
  });
});
