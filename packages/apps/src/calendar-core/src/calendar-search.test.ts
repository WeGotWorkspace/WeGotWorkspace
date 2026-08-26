import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { calendarBootstrapWindow } from "@/lib/api/wgw/calendar";
import {
  occurrencesInRange,
  rangeToPlainDateTimeStrings,
  viewDateRange,
  type CalendarOccurrence,
} from "@/calendar-core/src/calendar-event-model";
import { MOCK_CALENDAR_ANCHOR } from "@/lib/api/mock/calendar-bootstrap";
import { createDevCalendarSeedEvents } from "@/lib/api/mock/calendar-seed";
import {
  CALENDAR_SEARCH_SECTION_CAP,
  calendarSearchRange,
  expandSearchOccurrences,
  matchCalendarOccurrences,
  searchCalendarEvents,
  searchOccurrencesToEngineMap,
  unifiedSearchOccurrences,
} from "@/calendar-core/src/calendar-search";

const TODAY = Temporal.PlainDate.from("2026-08-26");
const NOW = Temporal.PlainDateTime.from("2026-08-26T12:00:00");

function wireEvent(overrides: Partial<JmapCalendarEvent> = {}): JmapCalendarEvent {
  return {
    "@type": "Event",
    id: "ev-1",
    uid: "uid-1",
    calendarIds: { work: true },
    title: "Standup",
    start: "2026-08-26T10:00:00",
    duration: "PT30M",
    timeZone: "Etc/UTC",
    ...overrides,
  } as JmapCalendarEvent;
}

function occurrence(
  overrides: Partial<CalendarOccurrence> & Pick<CalendarOccurrence, "eventId" | "start" | "end">,
): CalendarOccurrence {
  return {
    key: overrides.key ?? overrides.eventId,
    calendarId: "work",
    title: "Standup",
    color: "#6366F1",
    allDay: false,
    isRecurring: false,
    ...overrides,
  };
}

describe("calendarSearchRange", () => {
  it("matches calendarBootstrapWindow snapped to month starts", () => {
    const range = calendarSearchRange(TODAY);
    const window = calendarBootstrapWindow(TODAY);
    expect(range.start).toBe("2025-08-01T00:00:00");
    expect(range.end).toBe("2028-08-01T00:00:00");
    expect(range.start).toBe(window.utcStart.toISOString().slice(0, 19));
    expect(range.end).toBe(window.utcEnd.toISOString().slice(0, 19));
  });
});

describe("matchCalendarOccurrences", () => {
  it("returns empty results for an empty or whitespace-only query", () => {
    const rows = [
      occurrence({
        eventId: "ev-1",
        start: Temporal.PlainDateTime.from("2026-08-26T10:00:00"),
        end: Temporal.PlainDateTime.from("2026-08-26T10:30:00"),
      }),
    ];
    const events = [wireEvent()];
    expect(matchCalendarOccurrences(rows, events, "", NOW)).toEqual({
      upcoming: [],
      past: [],
      truncatedUpcoming: false,
      truncatedPast: false,
    });
    expect(matchCalendarOccurrences(rows, events, "   \t  ", NOW)).toEqual({
      upcoming: [],
      past: [],
      truncatedUpcoming: false,
      truncatedPast: false,
    });
  });

  it("trims the query before matching", () => {
    const rows = [
      occurrence({
        eventId: "ev-1",
        title: "Standup",
        start: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
        end: Temporal.PlainDateTime.from("2026-08-26T13:30:00"),
      }),
    ];
    const results = matchCalendarOccurrences(rows, [wireEvent()], "  standup  ", NOW);
    expect(results.upcoming).toHaveLength(1);
    expect(results.upcoming[0]?.title).toBe("Standup");
  });

  it("matches case-insensitively", () => {
    const rows = [
      occurrence({
        eventId: "ev-1",
        title: "Client Call",
        start: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
        end: Temporal.PlainDateTime.from("2026-08-26T13:30:00"),
      }),
    ];
    expect(matchCalendarOccurrences(rows, [wireEvent()], "CLIENT call", NOW).upcoming).toHaveLength(
      1,
    );
  });

  it("matches a leading title token as a substring (sprint ⊂ sprint retro)", () => {
    const rows = [
      occurrence({
        eventId: "retro",
        title: "Sprint retro",
        start: Temporal.PlainDateTime.from("2026-08-28T15:00:00"),
        end: Temporal.PlainDateTime.from("2026-08-28T16:00:00"),
      }),
    ];
    const events = [wireEvent({ id: "retro", uid: "retro", title: "Sprint retro" })];
    const results = matchCalendarOccurrences(rows, events, "sprint", NOW);
    expect(results.upcoming).toHaveLength(1);
    expect(results.upcoming[0]?.title).toBe("Sprint retro");
  });

  it("requires an exact substring, not tokenized word order", () => {
    const rows = [
      occurrence({
        eventId: "ev-1",
        title: "Client call",
        start: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
        end: Temporal.PlainDateTime.from("2026-08-26T13:30:00"),
      }),
    ];
    const events = [wireEvent({ title: "Client call" })];
    expect(matchCalendarOccurrences(rows, events, "client call", NOW).upcoming).toHaveLength(1);
    expect(matchCalendarOccurrences(rows, events, "call client", NOW).upcoming).toHaveLength(0);
    expect(matchCalendarOccurrences(rows, events, "call client", NOW).past).toHaveLength(0);
  });

  it("matches title, location, and master description independently", () => {
    const titleRow = occurrence({
      eventId: "title",
      title: "Design review",
      start: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T13:30:00"),
    });
    const locationRow = occurrence({
      eventId: "loc",
      title: "Unrelated",
      location: "Room 4",
      start: Temporal.PlainDateTime.from("2026-08-26T14:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T14:30:00"),
    });
    const descriptionRow = occurrence({
      eventId: "desc",
      title: "Unrelated",
      start: Temporal.PlainDateTime.from("2026-08-26T15:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T15:30:00"),
    });
    const events = [
      wireEvent({ id: "title", uid: "uid-title", title: "Design review" }),
      wireEvent({ id: "loc", uid: "uid-loc", title: "Unrelated" }),
      wireEvent({
        id: "desc",
        uid: "uid-desc",
        title: "Unrelated",
        description: "Bring the standup notes",
      }),
    ];

    expect(
      matchCalendarOccurrences([titleRow, locationRow, descriptionRow], events, "design", NOW)
        .upcoming,
    ).toEqual([titleRow]);
    expect(
      matchCalendarOccurrences([titleRow, locationRow, descriptionRow], events, "room 4", NOW)
        .upcoming,
    ).toEqual([locationRow]);
    expect(
      matchCalendarOccurrences([titleRow, locationRow, descriptionRow], events, "standup", NOW)
        .upcoming,
    ).toEqual([descriptionRow]);
  });

  it("falls back to joined wire location names when the occurrence location is empty", () => {
    const row = occurrence({
      eventId: "ev-1",
      title: "Meet",
      start: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T13:30:00"),
    });
    const events = [
      wireEvent({
        locations: {
          a: { "@type": "Location", name: "HQ lobby" },
          b: { "@type": "Location", name: "Room 2" },
        },
      }),
    ];
    expect(matchCalendarOccurrences([row], events, "hq lobby", NOW).upcoming).toHaveLength(1);
    expect(matchCalendarOccurrences([row], events, "room 2", NOW).upcoming).toHaveLength(1);
  });

  it("does not search attendees or occurrence description overrides", () => {
    const row = occurrence({
      eventId: "ev-1",
      title: "Meet",
      start: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T13:30:00"),
    });
    const events = [
      wireEvent({
        description: "Master agenda",
        participants: {
          alice: {
            "@type": "Participant",
            name: "Alice Attendee",
            email: "alice@example.test",
            roles: { attendee: true },
          },
        },
        recurrenceOverrides: {
          "2026-08-26T13:00:00": { description: "Override-only secret" },
        },
      }),
    ];
    expect(matchCalendarOccurrences([row], events, "alice", NOW).upcoming).toHaveLength(0);
    expect(matchCalendarOccurrences([row], events, "secret", NOW).upcoming).toHaveLength(0);
    expect(matchCalendarOccurrences([row], events, "agenda", NOW).upcoming).toHaveLength(1);
  });

  it("splits upcoming and past by end vs now and sorts each section", () => {
    const later = occurrence({
      eventId: "later",
      title: "Later",
      start: Temporal.PlainDateTime.from("2026-08-27T10:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-27T11:00:00"),
    });
    const sooner = occurrence({
      eventId: "sooner",
      title: "Sooner",
      start: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T13:30:00"),
    });
    const inProgress = occurrence({
      eventId: "now",
      title: "In progress",
      start: Temporal.PlainDateTime.from("2026-08-26T11:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
    });
    const yesterday = occurrence({
      eventId: "yest",
      title: "Yesterday",
      start: Temporal.PlainDateTime.from("2026-08-25T10:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-25T11:00:00"),
    });
    const lastWeek = occurrence({
      eventId: "old",
      title: "Last week",
      start: Temporal.PlainDateTime.from("2026-08-19T10:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-19T11:00:00"),
    });
    const endingNow = occurrence({
      eventId: "end-now",
      title: "Ending now",
      start: Temporal.PlainDateTime.from("2026-08-26T11:00:00"),
      end: NOW,
    });

    const results = matchCalendarOccurrences(
      [later, lastWeek, sooner, yesterday, inProgress, endingNow],
      [
        wireEvent({ id: "later", uid: "later", title: "Later" }),
        wireEvent({ id: "sooner", uid: "sooner", title: "Sooner" }),
        wireEvent({ id: "now", uid: "now", title: "In progress" }),
        wireEvent({ id: "yest", uid: "yest", title: "Yesterday" }),
        wireEvent({ id: "old", uid: "old", title: "Last week" }),
        wireEvent({ id: "end-now", uid: "end-now", title: "Ending now" }),
      ],
      "e",
      NOW,
    );

    expect(results.upcoming.map((row) => row.eventId)).toEqual(["now", "sooner", "later"]);
    expect(results.past.map((row) => row.eventId)).toEqual(["end-now", "yest", "old"]);
  });

  it("caps each section at 100 and sets truncation flags independently", () => {
    const upcoming = Array.from({ length: CALENDAR_SEARCH_SECTION_CAP + 2 }, (_, index) =>
      occurrence({
        eventId: `up-${index}`,
        key: `up-${index}`,
        title: "Overflow",
        start: Temporal.PlainDateTime.from("2026-08-26T13:00:00").add({ minutes: index }),
        end: Temporal.PlainDateTime.from("2026-08-26T13:30:00").add({ minutes: index }),
      }),
    );
    const past = Array.from({ length: CALENDAR_SEARCH_SECTION_CAP + 1 }, (_, index) =>
      occurrence({
        eventId: `past-${index}`,
        key: `past-${index}`,
        title: "Overflow",
        start: Temporal.PlainDateTime.from("2026-08-25T10:00:00").subtract({ minutes: index }),
        end: Temporal.PlainDateTime.from("2026-08-25T10:30:00").subtract({ minutes: index }),
      }),
    );
    const events = [...upcoming, ...past].map((row) =>
      wireEvent({ id: row.eventId, uid: row.eventId, title: "Overflow" }),
    );

    const results = matchCalendarOccurrences([...upcoming, ...past], events, "overflow", NOW);
    expect(results.upcoming).toHaveLength(CALENDAR_SEARCH_SECTION_CAP);
    expect(results.past).toHaveLength(CALENDAR_SEARCH_SECTION_CAP);
    expect(results.truncatedUpcoming).toBe(true);
    expect(results.truncatedPast).toBe(true);
    expect(results.upcoming[0]?.eventId).toBe("up-0");
    expect(results.past[0]?.eventId).toBe("past-0");
  });

  it("omits truncation flags when a section has 100 or fewer matches", () => {
    const row = occurrence({
      eventId: "ev-1",
      title: "Solo",
      start: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T13:30:00"),
    });
    const results = matchCalendarOccurrences([row], [wireEvent({ title: "Solo" })], "solo", NOW);
    expect(results.truncatedUpcoming).toBe(false);
    expect(results.truncatedPast).toBe(false);
  });
});

describe("expandSearchOccurrences", () => {
  it("expands over the bootstrap window, not a visible week", () => {
    const far = wireEvent({
      id: "far",
      uid: "far",
      title: "Client call",
      start: "2027-03-15T10:00:00",
    });
    const weekRange = rangeToPlainDateTimeStrings(viewDateRange("week", TODAY.toString()));
    expect(occurrencesInRange([far], weekRange)).toHaveLength(0);

    const expanded = expandSearchOccurrences([far], { today: TODAY });
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.title).toBe("Client call");

    const results = searchCalendarEvents([far], "client", { today: TODAY, now: NOW });
    expect(results.upcoming).toHaveLength(1);
  });

  it("respects visibleCalendarIds", () => {
    const events = [
      wireEvent({ id: "work", uid: "work", title: "Work standup" }),
      wireEvent({
        id: "home",
        uid: "home",
        title: "Home standup",
        calendarIds: { home: true },
      }),
    ];
    const expanded = expandSearchOccurrences(events, {
      today: TODAY,
      visibleCalendarIds: new Set(["home"]),
    });
    expect(expanded.map((row) => row.eventId)).toEqual(["home"]);
  });

  it("finds Sprint retro on the non-default calendar when both calendars are visible", () => {
    const events = [
      wireEvent({
        id: "personal-hold",
        uid: "personal-hold",
        title: "Hold",
        calendarIds: { default: true },
      }),
      wireEvent({
        id: "work-retro",
        uid: "work-retro",
        title: "Sprint retro",
        calendarIds: { work: true },
      }),
    ];
    const visible = new Set(["default", "work"]);
    const results = searchCalendarEvents(events, "sprint", {
      today: TODAY,
      now: NOW,
      visibleCalendarIds: visible,
    });
    expect([...results.upcoming, ...results.past].map((row) => row.title)).toContain(
      "Sprint retro",
    );

    const hiddenWork = searchCalendarEvents(events, "sprint", {
      today: TODAY,
      now: NOW,
      visibleCalendarIds: new Set(["default"]),
    });
    expect([...hiddenWork.upcoming, ...hiddenWork.past].map((row) => row.title)).not.toContain(
      "Sprint retro",
    );
  });

  it("uses each event’s calendar color, not the default Calendar chip", () => {
    // Live Dec 2026 week: default is named "Calendar" (#6366f1); Home/Work have no event.color.
    const calendars = [
      { id: "default", name: "Calendar", color: "#6366f1" },
      { id: "home", name: "Home", color: "#0ea5e9" },
      { id: "work", name: "Work", color: "#22c55e" },
    ];
    const events = [
      wireEvent({
        id: "dev-seed-0131",
        uid: "dev-seed-0131",
        title: "Errand #113",
        calendarIds: { home: true },
        start: "2026-12-14T10:00:00",
      }),
      wireEvent({
        id: "dev-seed-0132",
        uid: "dev-seed-0132",
        title: "Planning #114",
        calendarIds: { work: true },
        start: "2026-12-15T11:30:00",
      }),
    ];
    const visible = new Set(["default", "home", "work"]);
    const errand = searchCalendarEvents(events, "errand", {
      today: TODAY,
      now: NOW,
      calendars,
      visibleCalendarIds: visible,
    });
    const homeHit = [...errand.upcoming, ...errand.past].find((row) => row.title === "Errand #113");
    expect(homeHit?.calendarId).toBe("home");
    expect(homeHit?.color).toBe("#0ea5e9");

    const planning = searchCalendarEvents(events, "planning", {
      today: TODAY,
      now: NOW,
      calendars,
      visibleCalendarIds: visible,
    });
    const workHit = [...planning.upcoming, ...planning.past].find(
      (row) => row.title === "Planning #114",
    );
    expect(workHit?.calendarId).toBe("work");
    expect(workHit?.color).toBe("#22c55e");
  });

  it("finds Focus block and Weekly team sync on the 2026-08-31 seed week", () => {
    // Live seed: daily count:8 Focus block + weekly MO sync, dtstart Monday 2026-08-24.
    const today = Temporal.PlainDate.from("2026-08-27");
    const now = Temporal.PlainDateTime.from("2026-08-27T12:00:00");
    const seed = createDevCalendarSeedEvents(today);
    const visibleRange = rangeToPlainDateTimeStrings(viewDateRange("week", "2026-08-31"));

    const focus = searchCalendarEvents(seed, "focus", { today, now, visibleRange });
    const focusHits = [...focus.upcoming, ...focus.past];
    const aug31Focus = focusHits.find((row) => row.start.toString().startsWith("2026-08-31"));
    expect(aug31Focus?.title).toBe("Focus block");
    expect(aug31Focus?.end.toString()).toBe("2026-08-31T14:00:00");

    const sync = searchCalendarEvents(seed, "sync", { today, now, visibleRange });
    const aug31Sync = [...sync.upcoming, ...sync.past].find((row) =>
      row.start.toString().startsWith("2026-08-31"),
    );
    expect(aug31Sync?.title).toBe("Weekly team sync");
    expect(aug31Sync?.end.toString()).toBe("2026-08-31T12:00:00");

    const weekly = searchCalendarEvents(seed, "weekly", { today, now, visibleRange });
    expect(
      [...weekly.upcoming, ...weekly.past].some((row) => row.title === "Weekly team sync"),
    ).toBe(true);
  });

  it("keeps unscoped events that week view would still paint", () => {
    const unscoped = wireEvent({
      id: "unscoped-retro",
      uid: "unscoped-retro",
      title: "Sprint retro",
      calendarIds: {},
    });
    const results = searchCalendarEvents([unscoped], "sprint", {
      today: TODAY,
      now: NOW,
      visibleCalendarIds: new Set(["default", "work"]),
    });
    expect([...results.upcoming, ...results.past].map((row) => row.title)).toContain(
      "Sprint retro",
    );
  });

  it("finds Sprint retro for query sprint with the story browse week (today+14)", () => {
    const today = Temporal.Now.plainDateISO();
    const now = Temporal.Now.plainDateTimeISO();
    const seed = createDevCalendarSeedEvents(today);
    const visibleRange = rangeToPlainDateTimeStrings(
      viewDateRange("week", today.add({ days: 14 }).toString()),
    );
    const results = searchCalendarEvents(seed, "sprint", { visibleRange, now });
    expect([...results.upcoming, ...results.past].map((row) => row.title)).toContain(
      "Sprint retro",
    );
  });

  it("finds a current-week Sprint retro for query sprint via the seed path", () => {
    const seed = createDevCalendarSeedEvents(TODAY);
    const retro = seed.find((event) => event.title === "Sprint retro");
    expect(retro).toBeDefined();

    const weekRange = rangeToPlainDateTimeStrings(viewDateRange("week", TODAY.toString()));
    const weekHits = occurrencesInRange([retro!], weekRange);
    expect(weekHits.some((row) => row.title === "Sprint retro")).toBe(true);

    const results = searchCalendarEvents(seed, "sprint", { today: TODAY, now: NOW });
    const titles = [...results.upcoming, ...results.past].map((row) => row.title);
    expect(titles).toContain("Sprint retro");
  });

  it("finds a visible Sprint retro whose instances sit outside the Now bootstrap window", () => {
    const seed = createDevCalendarSeedEvents();
    const retro = seed.find((event) => event.title === "Sprint retro");
    expect(retro).toBeDefined();

    const visibleRange = rangeToPlainDateTimeStrings(viewDateRange("month", MOCK_CALENDAR_ANCHOR));
    expect(
      occurrencesInRange([retro!], visibleRange).some((row) => row.title === "Sprint retro"),
    ).toBe(true);
    const nowWindowOnly = searchCalendarEvents(seed, "sprint", { today: TODAY, now: NOW });
    expect([...nowWindowOnly.upcoming, ...nowWindowOnly.past]).toHaveLength(0);

    const results = searchCalendarEvents(seed, "sprint", {
      today: TODAY,
      now: NOW,
      visibleRange,
    });
    expect([...results.upcoming, ...results.past].map((row) => row.title)).toContain(
      "Sprint retro",
    );
  });

  it("expands recurring series into multiple in-window rows", () => {
    const series = wireEvent({
      title: "Daily standup",
      start: "2026-08-24T10:00:00",
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 4 }],
    });
    const expanded = expandSearchOccurrences([series], { today: TODAY });
    expect(expanded).toHaveLength(4);
    expect(new Set(expanded.map((row) => row.eventId))).toEqual(new Set(["ev-1"]));

    const results = searchCalendarEvents([series], "standup", { today: TODAY, now: NOW });
    expect(results.upcoming.length + results.past.length).toBe(4);
    expect(results.past.length).toBeGreaterThan(0);
    expect(results.upcoming.length).toBeGreaterThan(0);
  });
});

describe("unifiedSearchOccurrences", () => {
  it("reverses capped past then appends upcoming for one chronological agenda", () => {
    const pastNewer = occurrence({
      eventId: "yest",
      start: Temporal.PlainDateTime.from("2026-08-25T10:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-25T11:00:00"),
    });
    const pastOlder = occurrence({
      eventId: "old",
      start: Temporal.PlainDateTime.from("2026-08-19T10:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-19T11:00:00"),
    });
    const upcomingSoon = occurrence({
      eventId: "soon",
      start: Temporal.PlainDateTime.from("2026-08-26T13:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T13:30:00"),
    });
    const upcomingLater = occurrence({
      eventId: "later",
      start: Temporal.PlainDateTime.from("2026-08-27T10:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-27T11:00:00"),
    });
    expect(
      unifiedSearchOccurrences({
        past: [pastNewer, pastOlder],
        upcoming: [upcomingSoon, upcomingLater],
        truncatedUpcoming: false,
        truncatedPast: false,
      }).map((row) => row.eventId),
    ).toEqual(["old", "yest", "soon", "later"]);
  });
});

describe("searchOccurrencesToEngineMap", () => {
  it("maps occurrence keys into engine instances for the list view", () => {
    const row = occurrence({
      key: "design-review::2026-08-26",
      eventId: "design-review",
      title: "Design review",
      location: "Room 4",
      start: Temporal.PlainDateTime.from("2026-08-26T10:00:00"),
      end: Temporal.PlainDateTime.from("2026-08-26T11:00:00"),
    });
    const map = searchOccurrencesToEngineMap([row]);
    expect(map.get("design-review::2026-08-26")?.data.summary).toBe("Design review");
    expect(map.get("design-review::2026-08-26")?.data.location).toBe("Room 4");
    expect(map.get("design-review::2026-08-26")?.data.end?.toString()).toBe("2026-08-26T11:00:00");
  });
});
