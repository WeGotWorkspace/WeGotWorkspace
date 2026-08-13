import { describe, expect, it } from "vitest";
import {
  matchRecurrencePreset,
  nthWeekdayOfMonth,
  recurrencePresetOptionLabel,
  recurrencePresetToRule,
  recurrenceRulesEqual,
} from "@/calendar-core/src/calendar-recurrence-presets";
import { Temporal } from "@js-temporal/polyfill";

describe("nthWeekdayOfMonth", () => {
  it("returns 1–4 or last (-1)", () => {
    expect(nthWeekdayOfMonth(Temporal.PlainDate.from("2033-01-04"))).toBe(1); // first Tue
    expect(nthWeekdayOfMonth(Temporal.PlainDate.from("2033-01-11"))).toBe(2);
    expect(nthWeekdayOfMonth(Temporal.PlainDate.from("2033-01-25"))).toBe(-1); // last Tue
  });
});

describe("recurrencePresetToRule / matchRecurrencePreset", () => {
  const start = "2033-01-12"; // Wednesday

  it("maps daily / weekday / weekly / biweekly presets", () => {
    expect(recurrencePresetToRule("daily", start)).toEqual({
      "@type": "RecurrenceRule",
      frequency: "daily",
    });
    expect(recurrencePresetToRule("weekday", start)?.byDay?.map((d) => d.day)).toEqual([
      "mo",
      "tu",
      "we",
      "th",
      "fr",
    ]);
    expect(recurrencePresetToRule("weekly", start)).toMatchObject({
      frequency: "weekly",
      byDay: [{ day: "we" }],
    });
    expect(recurrencePresetToRule("biweekly", start)).toMatchObject({
      frequency: "weekly",
      interval: 2,
      byDay: [{ day: "we" }],
    });
  });

  it("maps monthly date, monthly nth, and yearly presets", () => {
    expect(recurrencePresetToRule("monthly-date", start)).toEqual({
      "@type": "RecurrenceRule",
      frequency: "monthly",
      byMonthDay: [12],
    });
    expect(recurrencePresetToRule("monthly-nth", start)).toMatchObject({
      frequency: "monthly",
      byDay: [{ day: "we", nthOfPeriod: 2 }],
    });
    expect(recurrencePresetToRule("yearly", start)).toEqual({
      "@type": "RecurrenceRule",
      frequency: "yearly",
      byMonth: ["1"],
      byMonthDay: [12],
    });
  });

  it("round-trips presets through matchRecurrencePreset", () => {
    for (const preset of [
      "daily",
      "weekday",
      "weekly",
      "biweekly",
      "monthly-date",
      "monthly-nth",
      "yearly",
    ] as const) {
      const rule = recurrencePresetToRule(preset, start);
      expect(matchRecurrencePreset(rule ? [rule] : null, start)).toBe(preset);
    }
    expect(matchRecurrencePreset(null, start)).toBe("none");
    expect(matchRecurrencePreset([], start)).toBe("none");
  });

  it("detects custom rules (count, multi-rule, odd byDay)", () => {
    expect(
      matchRecurrencePreset([{ "@type": "RecurrenceRule", frequency: "daily", count: 5 }], start),
    ).toBe("custom");
    expect(
      matchRecurrencePreset(
        [
          { "@type": "RecurrenceRule", frequency: "weekly", byDay: [{ day: "mo" }] },
          { "@type": "RecurrenceRule", frequency: "weekly", byDay: [{ day: "fr" }] },
        ],
        start,
      ),
    ).toBe("custom");
    expect(
      matchRecurrencePreset(
        [
          {
            "@type": "RecurrenceRule",
            frequency: "weekly",
            byDay: [{ day: "mo" }, { day: "we" }],
          },
        ],
        start,
      ),
    ).toBe("custom");
  });

  it("treats bare weekly/yearly as the matching preset", () => {
    expect(matchRecurrencePreset([{ frequency: "weekly" }], start)).toBe("weekly");
    expect(matchRecurrencePreset([{ frequency: "yearly" }], start)).toBe("yearly");
  });
});

describe("recurrenceRulesEqual", () => {
  it("ignores interval 1 vs omitted and byDay order", () => {
    expect(
      recurrenceRulesEqual(
        { frequency: "weekly", interval: 1, byDay: [{ day: "mo" }, { day: "fr" }] },
        { frequency: "weekly", byDay: [{ day: "fr" }, { day: "mo" }] },
      ),
    ).toBe(true);
  });
});

describe("recurrencePresetOptionLabel", () => {
  it("localizes weekday and month-day fragments", () => {
    const start = "2033-01-12";
    expect(recurrencePresetOptionLabel("none", start, "en-US")).toBe("Does not repeat");
    expect(recurrencePresetOptionLabel("weekly", start, "en-US")).toMatch(/Wednesday/);
    expect(recurrencePresetOptionLabel("yearly", start, "en-US")).toMatch(/January/);
    expect(recurrencePresetOptionLabel("custom", start, "en-US")).toBe("Custom");
  });
});
