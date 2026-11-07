import { Temporal } from "@js-temporal/polyfill";
import {
  addUtcWeeks,
  splitBusyPeriodsByWeek,
  utcWeekStartOfInstant,
} from "@/lib/jmap-client/availability/availability-weeks";
import type { JmapBusyPeriod, JmapTeamMember } from "@/lib/jmap-client/availability/types";
import type { AvailabilityWeek } from "@/lib/offline/calendars/availability-cache";
import type { TeamAvailabilityPreset } from "@/calendar-core/src/use-team-availability";

const TEAMMATES = [
  ["ada", "Ada Lovelace"],
  ["grace", "Grace Hopper"],
  ["alan", "Alan Turing"],
  ["margaret", "Margaret Hamilton"],
  ["linus", "Linus Torvalds"],
  ["barbara", "Barbara Liskov"],
  ["ken", "Ken Thompson"],
  ["frances", "Frances Allen"],
  ["dennis", "Dennis Ritchie"],
  ["radia", "Radia Perlman"],
  ["john", "John McCarthy"],
] as const;

export type TeamAvailabilityFixtureOptions = {
  /** Rows in the section, the own row included when `includeSelf`. */
  count: number;
  includeSelf?: boolean;
  /** ISO date the cached weeks centre on (the story's anchor). */
  anchor: string;
  /** Weeks around the anchor that are cached; the rest reads as never fetched. */
  cachedWeeksBefore?: number;
  cachedWeeksAfter?: number;
  fetchedAt?: number;
};

function busy(
  date: Temporal.PlainDate,
  hour: number,
  minutes: number,
  extra: Partial<JmapBusyPeriod> = {},
): JmapBusyPeriod {
  return {
    start: date.toPlainDateTime({ hour, minute: 0 }).toString(),
    timeZone: "Europe/Amsterdam",
    duration: Temporal.Duration.from({ minutes }).toString(),
    showWithoutTime: false,
    ...extra,
  };
}

/** A recognisable week per person: Ada shares details, Grace has a day off, Alan is incomplete. */
function weekPeriods(id: string, index: number, monday: Temporal.PlainDate): JmapBusyPeriod[] {
  const day = (offset: number) => monday.add({ days: offset });
  const periods: JmapBusyPeriod[] = [
    busy(day(index % 5), 9 + (index % 4), 60),
    busy(day((index + 2) % 5), 13 + (index % 3), 90),
  ];
  if (id === "ada") {
    periods.push(
      busy(day(2), 10, 60, { title: "Roadmap review", location: "Room Babbage" }),
      busy(day(3), 15, 30, { title: "1:1 with Grace" }),
    );
  }
  if (id === "grace") {
    periods.push({
      start: day(4).toString(),
      timeZone: null,
      duration: "P1D",
      showWithoutTime: true,
    });
  }
  if (id === "margaret") {
    // Runs past Monday 00:00 UTC into the next week.
    periods.push(busy(day(6), 21, 240, { timeZone: "UTC" }));
  }
  return periods;
}

/**
 * Team availability for stories and screenshots: `count` rows around `anchor`,
 * with cached weeks before and after the anchor week.
 */
export function createTeamAvailabilityFixture({
  count,
  includeSelf = true,
  anchor,
  cachedWeeksBefore = 6,
  cachedWeeksAfter = 6,
  fetchedAt = Date.now(),
}: TeamAvailabilityFixtureOptions): TeamAvailabilityPreset {
  const self: JmapTeamMember = { id: "me", name: "Morgan Reed", isSelf: true, version: "v1" };
  const teammates = TEAMMATES.slice(0, Math.max(0, count - (includeSelf ? 1 : 0))).map(
    ([id, name]): JmapTeamMember => ({ id, name, isSelf: false, version: "v1" }),
  );
  const members = includeSelf ? [self, ...teammates] : teammates;
  const anchorWeek = utcWeekStartOfInstant(
    Temporal.PlainDate.from(anchor).toZonedDateTime("UTC").toInstant(),
  );
  const weeks = Array.from({ length: cachedWeeksBefore + cachedWeeksAfter + 1 }, (_, offset) =>
    addUtcWeeks(anchorWeek, offset - cachedWeeksBefore),
  );
  const rows: AvailabilityWeek[] = [];
  members.forEach((member, index) => {
    const periods = weeks.flatMap((week) =>
      weekPeriods(member.id, index, Temporal.PlainDate.from(week)),
    );
    for (const [weekStart, weekPeriodsList] of splitBusyPeriodsByWeek(periods, weeks)) {
      rows.push({
        username: member.id,
        weekStart,
        periods: weekPeriodsList,
        complete: member.id !== "alan",
        version: member.version,
        fetchedAt,
      });
    }
  });
  return { members, weeks: rows };
}
