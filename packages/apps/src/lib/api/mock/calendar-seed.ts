import { Temporal } from "@js-temporal/polyfill";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { JSCalendarLocalDateTime, JSCalendarWeekday } from "@/lib/jmap-client";
import {
  createCalendarAppBootstrap,
  MOCK_CALENDAR_ANCHOR,
  type CalendarAppBootstrap,
} from "@/lib/api/mock/calendar-bootstrap";

/**
 * TypeScript port of `DevCalendarEventCatalog` (packages/api) for mock-tier Storybook.
 * Same titles, recurrence, and bulk fill as `wgw:calendars:seed-dev --profile=full`.
 * Anchor is pinned so stories stay deterministic (`MOCK_CALENDAR_ANCHOR`).
 */
export const DEV_CALENDAR_SEED_FULL_TARGET = 360;

const CALENDARS = ["default", "home", "work"] as const;

const BULK_TITLES: Record<(typeof CALENDARS)[number], string[]> = {
  work: ["1:1", "Planning", "Review", "Workshop", "Stand-in", "Demo", "Office hours"],
  home: ["Errand", "Family dinner", "School pickup", "Chores", "Walk", "Movie", "Repair"],
  default: ["Hold", "Follow-up", "Admin time", "Reading", "Call", "Buffer", "Note"],
};

function mondayNine(now: Temporal.PlainDate): Temporal.PlainDateTime {
  const daysFromMonday = now.dayOfWeek - 1;
  return now.subtract({ days: daysFromMonday }).toPlainDateTime({
    hour: 9,
    minute: 0,
    second: 0,
  });
}

function local(dt: Temporal.PlainDateTime): JSCalendarLocalDateTime {
  return dt.toString();
}

function dateOnly(d: Temporal.PlainDate): string {
  return d.toString();
}

function weeklyRule(days: JSCalendarWeekday[]) {
  return {
    "@type": "RecurrenceRule" as const,
    frequency: "weekly" as const,
    byDay: days.map((day) => ({ "@type": "NDay" as const, day })),
  };
}

function durationBetween(
  start: Temporal.PlainDateTime | Temporal.PlainDate,
  end: Temporal.PlainDateTime | Temporal.PlainDate,
): string {
  return start.until(end).toString();
}

export function createDevCalendarSeedEvents(
  now: Temporal.PlainDate = Temporal.PlainDate.from(MOCK_CALENDAR_ANCHOR),
): JmapCalendarEvent[] {
  let nextIndex = 1;
  const monday = mondayNine(now);
  const events: JmapCalendarEvent[] = [];

  const add = (
    calendarId: (typeof CALENDARS)[number],
    event: Omit<JmapCalendarEvent, "@type" | "id" | "uid" | "calendarIds">,
  ) => {
    const n = String(nextIndex++).padStart(4, "0");
    const uid = `dev-seed-${n}`;
    events.push({
      ...event,
      "@type": "Event",
      id: uid,
      uid,
      calendarIds: { [calendarId]: true },
      timeZone: event.showWithoutTime ? undefined : (event.timeZone ?? "Etc/UTC"),
    } as JmapCalendarEvent);
  };

  add("work", {
    title: "Daily standup",
    description: "Engineering standup — one late, one cancelled.",
    start: local(monday),
    duration: "PT30M",
    recurrenceRules: [weeklyRule(["mo", "tu", "we", "th", "fr"])],
    recurrenceOverrides: {
      [local(monday.add({ days: 7 }))]: { excluded: true },
      [local(monday.add({ days: 14 }))]: {
        start: local(monday.add({ days: 14, hours: 5 })),
        duration: "PT30M",
        title: "Daily standup (late)",
      },
      [local(monday.add({ days: 21 }))]: { excluded: true },
    },
  });

  add("work", {
    title: "Weekly team sync",
    start: local(monday.with({ hour: 11 })),
    duration: "PT1H",
    recurrenceRules: [weeklyRule(["mo"])],
    locations: { room: { "@type": "Location", name: "Room A" } },
  });

  add("work", {
    title: "Design review",
    start: local(monday.with({ hour: 10 })),
    duration: "PT1H",
    status: "confirmed",
  });

  add("work", {
    title: "Customer call (overlap)",
    start: local(monday.with({ hour: 10, minute: 30 })),
    duration: "PT1H",
    status: "tentative",
    freeBusyStatus: "tentative",
  });

  add("work", {
    title: "Sprint retro",
    start: local(monday.with({ hour: 15 })),
    duration: "PT1H",
    recurrenceRules: [
      {
        "@type": "RecurrenceRule",
        frequency: "monthly",
        byDay: [{ "@type": "NDay", day: "fr", nthOfPeriod: -1 }],
      },
    ],
  });

  const birthday = Temporal.PlainDate.from({ year: monday.year, month: 8, day: 21 });
  add("home", {
    title: "Ada birthday",
    start: dateOnly(birthday),
    duration: "P1D",
    showWithoutTime: true,
    recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "yearly" }],
  });

  const tripStart = monday.toPlainDate().add({ days: 4 });
  add("home", {
    title: "Weekend trip",
    start: dateOnly(tripStart),
    duration: durationBetween(tripStart, tripStart.add({ days: 3 })),
    showWithoutTime: true,
    freeBusyStatus: "free",
  });

  add("home", {
    title: "Yoga",
    start: local(monday.with({ hour: 18, minute: 30 })),
    duration: "PT1H",
    recurrenceRules: [weeklyRule(["we"])],
  });

  const holiday = monday.toPlainDate().add({ days: 11 });
  add("home", {
    title: "Public holiday",
    start: dateOnly(holiday),
    duration: "P1D",
    showWithoutTime: true,
  });

  add("default", {
    title: "Dentist",
    start: local(monday.add({ days: 2 }).with({ hour: 8 })),
    duration: "PT45M",
  });

  add("default", {
    title: "Amsterdam catch-up",
    start: local(monday.add({ days: 1 }).with({ hour: 10 })),
    duration: "PT1H",
    timeZone: "Europe/Amsterdam",
  });

  add("default", {
    title: "Private note",
    start: local(monday.add({ days: 3 }).with({ hour: 20 })),
    duration: "PT30M",
    privacy: "private",
  });

  add("default", {
    title: "Focus block",
    start: local(monday.with({ hour: 13 })),
    duration: "PT1H",
    recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 8 }],
  });

  add("default", {
    title: "Board meeting",
    start: local(monday.with({ hour: 16 })),
    duration: "PT90M",
    recurrenceRules: [
      {
        "@type": "RecurrenceRule",
        frequency: "monthly",
        byDay: [{ "@type": "NDay", day: "mo", nthOfPeriod: 2 }],
      },
    ],
  });

  add("default", {
    title: "Vendor walkthrough",
    start: local(monday.add({ days: 2 }).with({ hour: 14 })),
    duration: "PT1H",
    locations: { hq: { "@type": "Location", name: "HQ lobby" } },
    links: {
      meet: {
        "@type": "Link",
        href: "https://meet.example.test/vendor",
        rel: "describedby",
      },
    },
  });

  add("default", {
    title: "Interview loop",
    start: local(monday.add({ days: 3 }).with({ hour: 9 })),
    duration: "PT3H",
    participants: {
      alice: {
        "@type": "Participant",
        name: "Alice",
        email: "alice@localhost",
        roles: { attendee: true },
        participationStatus: "accepted",
      },
      bob: {
        "@type": "Participant",
        name: "Bob",
        email: "bob@localhost",
        roles: { optional: true },
        participationStatus: "needs-action",
      },
    },
  });

  add("default", {
    title: "Cancelled kickoff",
    start: local(monday.add({ days: 8 }).with({ hour: 9 })),
    duration: "PT1H",
    status: "cancelled",
  });

  add("default", {
    title: "Hard-start briefing",
    start: local(monday.add({ days: 1 }).with({ hour: 9 })),
    duration: "PT30M",
  });

  const need = Math.max(0, DEV_CALENDAR_SEED_FULL_TARGET - events.length);
  for (let i = 0; i < need; i++) {
    const calendarId = CALENDARS[i % CALENDARS.length];
    const day = monday.toPlainDate().add({ days: i % 240 });
    const hour = 8 + (i % 10);
    const title = `${BULK_TITLES[calendarId][i % BULK_TITLES[calendarId].length]} #${i + 1}`;
    const allDay = i % 11 === 0;
    const extra: Partial<JmapCalendarEvent> = {};

    if (i % 17 === 0) extra.status = "tentative";
    if (i % 19 === 0) {
      extra.locations = { place: { "@type": "Location", name: `Cafe ${i}` } };
    }
    if (i % 29 === 0 && !allDay) {
      extra.recurrenceRules = [weeklyRule(["tu"])];
    }

    if (allDay) {
      add(calendarId, {
        title,
        description: "Dev seed bulk event.",
        start: dateOnly(day),
        duration: "P1D",
        showWithoutTime: true,
        ...extra,
      });
    } else {
      const start = day.toPlainDateTime({ hour, minute: i % 2 === 0 ? 0 : 30 });
      add(calendarId, {
        title,
        description: "Dev seed bulk event.",
        start: local(start),
        duration: i % 7 === 0 ? "PT2H" : "PT1H",
        ...extra,
      });
    }
  }

  return events;
}

/** Sparse Default stories stay on `createCalendarAppBootstrap`; this is the dense catalog. */
export function createSeededCalendarAppBootstrap(
  now: string | Temporal.PlainDate = MOCK_CALENDAR_ANCHOR,
): CalendarAppBootstrap {
  const base = createCalendarAppBootstrap();
  const anchor = typeof now === "string" ? Temporal.PlainDate.from(now) : now;
  const hasHome = base.data.calendars.some((calendar) => calendar.id === "home");

  return {
    ...base,
    data: {
      ...base.data,
      calendars: hasHome
        ? base.data.calendars
        : [
            ...base.data.calendars,
            {
              id: "home",
              name: "Home",
              color: "#14b8a6",
              mayWrite: true,
              mayDelete: true,
              sortOrder: 3,
            },
          ],
      events: createDevCalendarSeedEvents(anchor),
    },
  };
}
