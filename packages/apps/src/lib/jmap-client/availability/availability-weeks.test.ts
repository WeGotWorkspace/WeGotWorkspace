import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  busyPeriodUtcWeeks,
  contiguousUtcWeekRuns,
  mergeWeekPeriods,
  planAvailabilityCalls,
  prefetchUtcWeeks,
  splitBusyPeriodsByWeek,
  utcWeeksForDates,
} from "@/lib/jmap-client/availability/availability-weeks";
import type { JmapBusyPeriod } from "@/lib/jmap-client/availability/types";

const people = (count: number) => Array.from({ length: count }, (_, index) => `user${index + 1}`);

function yearWeeks(year: number) {
  return utcWeeksForDates(
    Temporal.PlainDate.from({ year, month: 1, day: 1 }),
    Temporal.PlainDate.from({ year: year + 1, month: 1, day: 1 }),
  );
}

describe("availability weeks", () => {
  it("names weeks by their Monday in UTC and widens dates by a day each side", () => {
    // Sun 15 Nov – Sun 22 Nov 2026 (exclusive) touches Mon 9, 16 and 23 Nov.
    expect(
      utcWeeksForDates(
        Temporal.PlainDate.from("2026-11-15"),
        Temporal.PlainDate.from("2026-11-22"),
      ),
    ).toEqual(["2026-11-09", "2026-11-16"]);
    expect(
      utcWeeksForDates(
        Temporal.PlainDate.from("2026-11-16"),
        Temporal.PlainDate.from("2026-11-23"),
      ),
    ).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"]);
  });

  it("prefetches the current week plus the next four", () => {
    expect(prefetchUtcWeeks(Temporal.Instant.from("2026-11-11T08:00:00Z"))).toEqual([
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
      "2026-12-07",
    ]);
  });

  it("covers a 54-week year in one run the server accepts", () => {
    // 1 Jan 2029 is a Monday: the day before reaches back into the previous week.
    const weeks = yearWeeks(2029);
    expect(weeks).toHaveLength(54);
    const runs = contiguousUtcWeekRuns(weeks);
    expect(runs).toHaveLength(1);
    const [plan] = planAvailabilityCalls(["alice"], weeks);
    expect(plan).toMatchObject({
      utcStart: "2028-12-25T00:00:00Z",
      utcEnd: "2030-01-07T00:00:00Z",
    });
    expect(new Date(plan!.utcStart).getUTCDay()).toBe(1);
  });

  it("never asks for more than 54 weeks in one call", () => {
    const weeks = Array.from({ length: 60 }, (_, index) =>
      Temporal.PlainDate.from("2026-01-05").add({ weeks: index }).toString(),
    );
    expect(contiguousUtcWeekRuns(weeks).map((run) => run.length)).toEqual([54, 6]);
  });

  it("splits gaps into separate runs", () => {
    expect(contiguousUtcWeekRuns(["2026-11-23", "2026-11-09", "2026-11-16", "2027-01-04"])).toEqual(
      [["2026-11-09", "2026-11-16", "2026-11-23"], ["2027-01-04"]],
    );
  });

  it("asks for a year of 12 teammates in two calls within 540 person-weeks", () => {
    const weeks = yearWeeks(2027);
    const plans = planAvailabilityCalls(people(12), weeks);
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan.ids.length * plan.weeks.length).toBeLessThanOrEqual(540);
    }
    expect(plans.flatMap((plan) => plan.ids)).toEqual(people(12));
  });

  it("keeps at most 50 people in one call", () => {
    const plans = planAvailabilityCalls(people(120), ["2026-11-09"]);
    expect(plans.map((plan) => plan.ids.length)).toEqual([50, 50, 20]);
  });

  it("asks nothing for nobody", () => {
    expect(planAvailabilityCalls([], ["2026-11-09"])).toEqual([]);
  });

  it("files a period across Monday 00:00 UTC under both weeks", () => {
    const overnight: JmapBusyPeriod = {
      start: "2026-11-15T22:00:00",
      timeZone: "UTC",
      duration: "PT4H",
      showWithoutTime: false,
    };
    expect(busyPeriodUtcWeeks(overnight)).toEqual(["2026-11-09", "2026-11-16"]);
    const byWeek = splitBusyPeriodsByWeek([overnight], ["2026-11-09", "2026-11-16", "2026-11-23"]);
    expect(byWeek.get("2026-11-09")).toEqual([overnight]);
    expect(byWeek.get("2026-11-16")).toEqual([overnight]);
    expect(byWeek.get("2026-11-23")).toEqual([]);
  });

  it("reads a UTC start with Z as an exact instant", () => {
    expect(
      busyPeriodUtcWeeks({
        start: "2026-11-15T23:30:00Z",
        timeZone: null,
        duration: "PT15M",
        showWithoutTime: false,
      }),
    ).toEqual(["2026-11-09"]);
  });

  it("uses the period's own zone", () => {
    // 00:30 Monday in Amsterdam is still Sunday in UTC.
    expect(
      busyPeriodUtcWeeks({
        start: "2026-11-16T00:30:00",
        timeZone: "Europe/Amsterdam",
        duration: "PT15M",
        showWithoutTime: false,
      }),
    ).toEqual(["2026-11-09"]);
  });

  it("files an all-day Monday under the week before too, for viewers west of UTC", () => {
    expect(
      busyPeriodUtcWeeks({
        start: "2026-11-16T00:00:00",
        timeZone: null,
        duration: "P1D",
        showWithoutTime: true,
      }),
    ).toEqual(["2026-11-09", "2026-11-16"]);
  });

  it("merges cached weeks without repeating a period stored under two weeks", () => {
    const overnight: JmapBusyPeriod = {
      start: "2026-11-15T22:00:00",
      timeZone: "UTC",
      duration: "PT4H",
      showWithoutTime: false,
    };
    const twin = { ...overnight };
    const later: JmapBusyPeriod = { ...overnight, start: "2026-11-17T09:00:00", duration: "PT1H" };
    const weeks = [
      { weekStart: "2026-11-16", periods: [overnight, later] },
      { weekStart: "2026-11-09", periods: [overnight, twin] },
    ];
    expect(mergeWeekPeriods(weeks)).toEqual([overnight, twin, later]);
    // Offline with only the second week cached, the period still shows.
    expect(mergeWeekPeriods([weeks[0]!])).toEqual([overnight, later]);
  });
});
