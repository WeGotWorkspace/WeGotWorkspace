import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { formToDraft } from "@/calendar-core/src/calendar-editor-model";
import { CALENDAR_MEET_LINK_KEY } from "@/calendar-core/src/calendar-meet-link";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { buildMeetMeetingInviteLink } from "@/meet-core/src/meet-route-search";
import {
  calendarEventLooksScheduled,
  calendarEventsForMeetingChannel,
  calendarEventTimeWindow,
  formatUpcomingMeetStart,
  formatUpcomingMeetWhen,
  INSTANT_MEETING_DURATION_MINUTES,
  leftoverBelongsInTodaySidebar,
  leftoverMeetingStartLabel,
  leftoverUpcomingMeetings,
  meetUpcomingJoinTarget,
  meetWindowIsTodayAndNotEnded,
  preferredCalendarEventForMeeting,
  relativeLabelForCalendarEvent,
  relativeLabelForMeetingChannel,
  clockLabelForMeetingChannel,
  todaySidebarMeetingChannels,
  seedEditMeetingForm,
  seedInstantMeetingForm,
  shouldAutoJoinScheduledMeeting,
  upcomingEventIdsForChannel,
  upcomingMeetEvents,
  upcomingMeetingsForSidebar,
} from "@/meet-core/src/meet-calendar-meeting";
import { meetLabels } from "@/meet-core/src/meet-labels";

const ORIGIN = "https://workspace.example.com";
const ROOM = "h8y8-ewp6-al8n";
const HREF = `${ORIGIN}/meet?room=${ROOM}`;

function event(
  partial: Partial<JmapCalendarEvent> & Pick<JmapCalendarEvent, "id" | "start" | "duration">,
): JmapCalendarEvent {
  return {
    "@type": "Event",
    uid: `urn:uuid:${partial.id}`,
    calendarIds: { default: true },
    title: partial.title ?? partial.id,
    timeZone: "UTC",
    ...partial,
  } as JmapCalendarEvent;
}

function withMeetLink(row: JmapCalendarEvent, href = HREF): JmapCalendarEvent {
  return {
    ...row,
    links: {
      [CALENDAR_MEET_LINK_KEY]: { "@type": "Link", href, rel: "describedby" },
    },
  };
}

describe("seedInstantMeetingForm", () => {
  it("seeds 30 minutes on the default calendar with an empty title", () => {
    const now = Temporal.ZonedDateTime.from("2026-09-06T14:07:42+00:00[UTC]");
    const form = seedInstantMeetingForm({
      calendarId: "default",
      now,
      meetingUrl: HREF,
      meetRoomCode: ROOM,
    });

    expect(form.calendarId).toBe("default");
    expect(form.title).toBe("");
    expect(form.allDay).toBe(false);
    expect(form.startDate).toBe("2026-09-06");
    expect(form.startTime).toBe("14:07");
    expect(form.endDate).toBe("2026-09-06");
    expect(form.endTime).toBe("14:37");
    expect(form.meetingUrl).toBe(HREF);
    expect(form.meetRoomCode).toBe(ROOM);
    expect(INSTANT_MEETING_DURATION_MINUTES).toBe(30);

    const draft = formToDraft(form);
    expect(draft.duration).toBe("PT30M");
    expect(draft.calendarId).toBe("default");
    expect(draft.links?.[CALENDAR_MEET_LINK_KEY]?.href).toBe(HREF);
  });
});

describe("upcomingMeetEvents", () => {
  const now = Temporal.Instant.from("2026-09-06T14:00:00Z");

  it("keeps in-progress and future Meet events and sorts by start", () => {
    const past = withMeetLink(
      event({ id: "past", title: "Yesterday", start: "2026-09-06T12:00:00", duration: "PT30M" }),
    );
    const live = withMeetLink(
      event({ id: "live", title: "Now", start: "2026-09-06T13:45:00", duration: "PT30M" }),
    );
    const later = withMeetLink(
      event({ id: "later", title: "Later", start: "2026-09-06T16:00:00", duration: "PT30M" }),
    );
    const sooner = withMeetLink(
      event({ id: "sooner", title: "Soon", start: "2026-09-06T15:00:00", duration: "PT30M" }),
    );
    const noLink = event({
      id: "plain",
      title: "No meet",
      start: "2026-09-06T15:30:00",
      duration: "PT30M",
    });
    const cancelled = withMeetLink(
      event({
        id: "cancelled",
        title: "Cancelled",
        start: "2026-09-06T18:00:00",
        duration: "PT30M",
        status: "cancelled",
      }),
    );

    const rows = upcomingMeetEvents([later, past, noLink, live, cancelled, sooner], now);
    expect(rows.map((row) => row.id)).toEqual(["live", "sooner", "later"]);
    expect(rows[0]?.href).toBe(HREF);
  });
});

describe("upcomingMeetingsForSidebar", () => {
  it("keeps today’s meetings with clock labels and drops tomorrow and ended rows", () => {
    const now = Temporal.Instant.from("2026-09-06T14:00:00Z");
    const rows = upcomingMeetingsForSidebar(
      [
        withMeetLink(
          event({ id: "b", title: "Demo", start: "2026-09-06T16:30:00", duration: "PT30M" }),
        ),
        withMeetLink(
          event({
            id: "a",
            title: "Sprint planning",
            start: "2026-09-06T15:00:00",
            duration: "PT30M",
          }),
        ),
        withMeetLink(
          event({
            id: "tomorrow",
            title: "Tomorrow standup",
            start: "2026-09-07T11:00:00",
            duration: "PT30M",
          }),
        ),
        withMeetLink(
          event({
            id: "ended",
            title: "Week Start",
            start: "2026-09-06T08:00:00",
            duration: "PT30M",
          }),
        ),
      ],
      now,
      ORIGIN,
      "en-US",
    );

    expect(rows.map((row) => row.title)).toEqual(["Sprint planning", "Demo"]);
    expect(rows[0]?.href).toBe(`/meet/meetings/${ROOM}`);
    const start = Temporal.ZonedDateTime.from("2026-09-06T15:00:00+00:00[UTC]");
    expect(rows[0]?.startLabel).toBe(formatUpcomingMeetStart(start, "en-US"));
    expect(rows[0]?.startLabel).not.toMatch(/starts /i);
    expect(rows[0]?.start?.toString()).toBe(start.toString());
  });
});

describe("formatUpcomingMeetWhen", () => {
  const locale = "en-US";

  it("uses relative copy for minutes, today, tomorrow, later days, and the live window", () => {
    const now = Temporal.Instant.from("2026-09-06T14:00:00Z");
    const inFive = Temporal.ZonedDateTime.from("2026-09-06T14:05:20+00:00[UTC]");
    expect(formatUpcomingMeetWhen(inFive, inFive.add({ minutes: 30 }), now, locale)).toBe(
      meetLabels.upcomingStartsInMinutes(5),
    );

    const inFifty = Temporal.ZonedDateTime.from("2026-09-06T14:00:50+00:00[UTC]");
    expect(formatUpcomingMeetWhen(inFifty, inFifty.add({ minutes: 30 }), now, locale)).toBe(
      meetLabels.upcomingStartsInOneMinute,
    );

    const laterToday = Temporal.ZonedDateTime.from("2026-09-06T16:30:00+00:00[UTC]");
    expect(formatUpcomingMeetWhen(laterToday, laterToday.add({ minutes: 30 }), now, locale)).toBe(
      meetLabels.upcomingStartsTodayAt(formatUpcomingMeetStart(laterToday, locale)),
    );

    const tomorrow = Temporal.ZonedDateTime.from("2026-09-07T11:00:00+00:00[UTC]");
    expect(formatUpcomingMeetWhen(tomorrow, tomorrow.add({ minutes: 30 }), now, locale)).toBe(
      meetLabels.upcomingStartsTomorrowAt(formatUpcomingMeetStart(tomorrow, locale)),
    );

    const friday = Temporal.ZonedDateTime.from("2026-09-11T11:00:00+00:00[UTC]");
    expect(formatUpcomingMeetWhen(friday, friday.add({ minutes: 30 }), now, locale)).toBe(
      meetLabels.upcomingStartsOnAt("Friday", formatUpcomingMeetStart(friday, locale)),
    );

    const liveStart = Temporal.ZonedDateTime.from("2026-09-06T13:45:00+00:00[UTC]");
    expect(
      formatUpcomingMeetWhen(liveStart, liveStart.add({ minutes: 30 }), now, locale),
    ).toBeNull();
  });
});

describe("calendarEventTimeWindow", () => {
  it("parses UTC Z start strings used by JMAP calendar events", () => {
    const window = calendarEventTimeWindow(
      event({
        id: "z",
        title: "Test Meet",
        start: "2026-09-07T14:00:00Z",
        duration: "PT30M",
      }),
    );
    expect(window?.start.toInstant().toString()).toBe("2026-09-07T14:00:00Z");
    expect(window?.end.toInstant().toString()).toBe("2026-09-07T14:30:00Z");
  });
});

describe("calendarEventLooksScheduled and auto-join", () => {
  const now = Temporal.Instant.from("2026-09-06T14:00:00Z");

  it("treats now+30m instant saves as unscheduled and in-window scheduled events as joinable", () => {
    const instant = event({
      id: "instant",
      title: "Instant",
      start: "2026-09-06T14:00:00",
      duration: "PT30M",
      created: "2026-09-06T14:00:08Z",
    });
    const scheduledLive = event({
      id: "live",
      title: "Week Start",
      start: "2026-09-06T13:45:00",
      duration: "PT45M",
      created: "2026-09-01T09:00:00Z",
      updated: "2026-09-06T13:50:00Z",
    });
    const scheduledFuture = event({
      id: "soon",
      title: "Soon",
      start: "2026-09-06T15:00:00",
      duration: "PT30M",
      created: "2026-09-05T12:00:00Z",
    });

    expect(calendarEventLooksScheduled(instant)).toBe(false);
    expect(shouldAutoJoinScheduledMeeting(instant, now)).toBe(false);
    expect(relativeLabelForCalendarEvent(instant, now, "en-US")).toBeNull();

    expect(calendarEventLooksScheduled(scheduledLive)).toBe(true);
    expect(shouldAutoJoinScheduledMeeting(scheduledLive, now)).toBe(true);
    expect(relativeLabelForCalendarEvent(scheduledLive, now, "en-US")).toBeNull();

    expect(shouldAutoJoinScheduledMeeting(scheduledFuture, now)).toBe(false);
    expect(calendarEventTimeWindow(scheduledFuture)?.start.toPlainTime().toString()).toBe(
      "15:00:00",
    );
  });

  it("treats a missing created stamp as scheduled even when updated is recent", () => {
    const row = event({
      id: "legacy",
      title: "Legacy",
      start: "2026-09-06T13:45:00",
      duration: "PT30M",
      updated: "2026-09-06T13:59:00Z",
    });
    expect(calendarEventLooksScheduled(row)).toBe(true);
    expect(shouldAutoJoinScheduledMeeting(row, now)).toBe(true);
  });
});

describe("relativeLabelForMeetingChannel", () => {
  const standup = {
    id: "chat-standup",
    kind: "meeting" as const,
    name: "Standup",
    guestRoomCode: ROOM,
  };
  const now = Temporal.Instant.from("2026-09-06T14:00:00Z");

  it("labels the preferred matching event and skips ended windows", () => {
    const soon = withMeetLink(
      event({
        id: "soon",
        title: "Standup",
        start: "2026-09-06T15:00:00",
        duration: "PT30M",
        updated: "2026-09-05T12:00:00Z",
      }),
    );
    expect(relativeLabelForMeetingChannel([soon], standup, ORIGIN, now, [standup], "en-US")).toBe(
      meetLabels.upcomingStartsTodayAt(
        formatUpcomingMeetStart(
          Temporal.ZonedDateTime.from("2026-09-06T15:00:00+00:00[UTC]"),
          "en-US",
        ),
      ),
    );
    expect(
      relativeLabelForMeetingChannel([soon], standup, ORIGIN, now, [standup], "en-US"),
    ).not.toMatch(/started/i);

    const ended = withMeetLink(
      event({
        id: "ended",
        title: "Standup",
        start: "2026-09-06T12:00:00",
        duration: "PT30M",
        updated: "2026-09-05T12:00:00Z",
      }),
    );
    expect(relativeLabelForMeetingChannel([ended], standup, ORIGIN, now, [standup])).toBeNull();
  });

  it("omits in-window copy so the header has no started label", () => {
    const live = withMeetLink(
      event({
        id: "live",
        title: "Standup",
        start: "2026-09-06T13:45:00",
        duration: "PT30M",
      }),
    );
    expect(
      relativeLabelForMeetingChannel([live], standup, ORIGIN, now, [standup], "en-US"),
    ).toBeNull();
  });
});

describe("clockLabelForMeetingChannel and todaySidebarMeetingChannels", () => {
  const standup = {
    id: "chat-standup",
    kind: "meeting" as const,
    name: "Standup",
    guestRoomCode: ROOM,
    scope: "personal" as const,
    isSharee: false,
  };
  const weekStart = {
    id: "chat-week",
    kind: "meeting" as const,
    name: "Week Start",
    guestRoomCode: null,
    scope: "personal" as const,
    isSharee: false,
  };
  const tomorrowRoom = {
    id: "chat-tomorrow",
    kind: "meeting" as const,
    name: "Tomorrow standup",
    guestRoomCode: null,
    scope: "personal" as const,
    isSharee: false,
  };
  const now = Temporal.Instant.from("2026-09-06T14:00:00Z");

  it("uses clock time for today and in-progress rows, and hides ended and tomorrow", () => {
    const soon = withMeetLink(
      event({
        id: "soon",
        title: "Standup",
        start: "2026-09-06T15:00:00",
        duration: "PT30M",
      }),
    );
    const live = withMeetLink(
      event({
        id: "live",
        title: "Standup",
        start: "2026-09-06T13:45:00",
        duration: "PT30M",
      }),
    );
    const ended = withMeetLink(
      event({
        id: "ended",
        title: "Week Start",
        start: "2026-09-06T08:00:00",
        duration: "PT30M",
      }),
    );
    const tomorrow = withMeetLink(
      event({
        id: "tomorrow",
        title: "Tomorrow standup",
        start: "2026-09-07T11:00:00",
        duration: "PT30M",
      }),
    );
    const clock = formatUpcomingMeetStart(
      Temporal.ZonedDateTime.from("2026-09-06T15:00:00+00:00[UTC]"),
      "en-US",
    );
    expect(clockLabelForMeetingChannel([soon], standup, ORIGIN, now, [standup], "en-US")).toBe(
      clock,
    );
    expect(
      clockLabelForMeetingChannel([soon], standup, ORIGIN, now, [standup], "en-US"),
    ).not.toMatch(/starts /i);
    expect(clockLabelForMeetingChannel([live], standup, ORIGIN, now, [standup], "en-US")).toBe(
      formatUpcomingMeetStart(
        Temporal.ZonedDateTime.from("2026-09-06T13:45:00+00:00[UTC]"),
        "en-US",
      ),
    );
    expect(clockLabelForMeetingChannel([ended], weekStart, ORIGIN, now, [weekStart])).toBeNull();
    expect(
      clockLabelForMeetingChannel([tomorrow], tomorrowRoom, ORIGIN, now, [tomorrowRoom]),
    ).toBeNull();

    expect(
      todaySidebarMeetingChannels(
        [standup, weekStart, tomorrowRoom],
        [soon, ended, tomorrow],
        ORIGIN,
        now,
        [standup, weekStart, tomorrowRoom],
      ).map((row) => row.id),
    ).toEqual(["chat-standup"]);
  });
});

describe("meetWindowIsTodayAndNotEnded", () => {
  const now = Temporal.Instant.from("2026-09-06T14:00:00Z");

  it("keeps later today and live windows, and drops ended and tomorrow", () => {
    const laterToday = Temporal.ZonedDateTime.from("2026-09-06T17:18:00+00:00[UTC]");
    expect(meetWindowIsTodayAndNotEnded(laterToday, laterToday.add({ minutes: 30 }), now)).toBe(
      true,
    );
    const live = Temporal.ZonedDateTime.from("2026-09-06T13:45:00+00:00[UTC]");
    expect(meetWindowIsTodayAndNotEnded(live, live.add({ minutes: 30 }), now)).toBe(true);
    const ended = Temporal.ZonedDateTime.from("2026-09-06T08:00:00+00:00[UTC]");
    expect(meetWindowIsTodayAndNotEnded(ended, ended.add({ minutes: 30 }), now)).toBe(false);
    const tomorrow = Temporal.ZonedDateTime.from("2026-09-07T11:00:00+00:00[UTC]");
    expect(meetWindowIsTodayAndNotEnded(tomorrow, tomorrow.add({ minutes: 30 }), now)).toBe(false);
  });
});

describe("leftoverBelongsInTodaySidebar", () => {
  const now = Temporal.Instant.from("2026-09-06T14:00:00Z");

  it("drops leftover rows once the window has ended", () => {
    const start = Temporal.ZonedDateTime.from("2026-09-06T08:00:00+00:00[UTC]");
    expect(leftoverBelongsInTodaySidebar({ start, end: start.add({ minutes: 30 }) }, now)).toBe(
      false,
    );
    const later = Temporal.ZonedDateTime.from("2026-09-06T17:18:00+00:00[UTC]");
    expect(
      leftoverBelongsInTodaySidebar({ start: later, end: later.add({ minutes: 30 }) }, now),
    ).toBe(true);
    expect(leftoverBelongsInTodaySidebar({}, now)).toBe(true);
  });
});

describe("leftoverMeetingStartLabel", () => {
  it("uses clock time only, not relative copy", () => {
    const start = Temporal.ZonedDateTime.from("2026-09-06T14:05:00+00:00[UTC]");
    expect(leftoverMeetingStartLabel({ startLabel: "2:00 PM", start }, "en-US")).toBe(
      formatUpcomingMeetStart(start, "en-US"),
    );
    expect(leftoverMeetingStartLabel({ startLabel: "2:00 PM", start }, "en-US")).not.toMatch(
      /starts |started/i,
    );
    expect(leftoverMeetingStartLabel({ startLabel: "2:00 PM" }, "en-US")).toBe("2:00 PM");
  });
});

describe("meetUpcomingJoinTarget", () => {
  const channels = [
    { id: "chat-general", kind: "channel" as const, guestRoomCode: null },
    { id: "chat-standup", kind: "meeting" as const, guestRoomCode: ROOM },
  ];

  it("selects a channel path in the workspace without treating it as a guest landing", () => {
    expect(meetUpcomingJoinTarget(`/meet/channels/general`, ORIGIN, channels)).toEqual({
      kind: "channel",
      channelId: "chat-general",
    });
  });

  it("maps a meeting-kind guest room onto its channel", () => {
    expect(meetUpcomingJoinTarget(`/meet?room=${ROOM}`, ORIGIN, channels)).toEqual({
      kind: "channel",
      channelId: "chat-standup",
    });
    expect(meetUpcomingJoinTarget(`/meet/meetings/${ROOM}`, ORIGIN, channels)).toEqual({
      kind: "channel",
      channelId: "chat-standup",
    });
  });

  it("keeps unmatched ad-hoc rooms as in-app room joins", () => {
    expect(meetUpcomingJoinTarget("/meet?room=aaaa-bbbb-cccc", ORIGIN, channels)).toEqual({
      kind: "room",
      room: "aaaa-bbbb-cccc",
    });
  });

  it("treats localhost vs 127.0.0.1 stored Meet links as in-app rooms", () => {
    expect(
      meetUpcomingJoinTarget(
        `http://127.0.0.1:5174/meet?room=${ROOM}`,
        "http://localhost:5174",
        channels,
      ),
    ).toEqual({ kind: "channel", channelId: "chat-standup" });
    expect(
      meetUpcomingJoinTarget(
        `http://127.0.0.1:5174/meet/meetings/aaaa-bbbb-cccc`,
        "http://localhost:5174",
        channels,
      ),
    ).toEqual({ kind: "room", room: "aaaa-bbbb-cccc" });
  });

  it("leaves external https meetings as an assign target", () => {
    expect(meetUpcomingJoinTarget("https://zoom.us/j/123", ORIGIN, channels)).toEqual({
      kind: "external",
      href: "https://zoom.us/j/123",
    });
  });
});

describe("leftoverUpcomingMeetings", () => {
  const leftover = {
    id: "cal-smoke",
    title: "Upcoming click smoke",
    startLabel: "3:00 PM",
    href: "/meet?room=aaaa-bbbb-cccc",
  };
  const channelHref = {
    id: "cal-standup",
    title: "Weekly standup",
    startLabel: "9:00 AM",
    href: `${ORIGIN}/meet/channels/standup`,
  };

  it("keeps calendar-only rows that have no matching meeting channel", () => {
    expect(
      leftoverUpcomingMeetings(
        [leftover],
        [{ id: "chat-general", kind: "channel", name: "general", guestRoomCode: null }],
        [],
        ORIGIN,
      ),
    ).toEqual([leftover]);
  });

  it("hides rows once a meeting channel has the same title", () => {
    expect(
      leftoverUpcomingMeetings(
        [leftover],
        [
          {
            id: "chat-smoke",
            kind: "meeting",
            name: "Upcoming click smoke",
            guestRoomCode: null,
          },
        ],
        [{ name: "Upcoming click smoke" }],
        ORIGIN,
      ),
    ).toEqual([]);
  });

  it("hides rows whose Meet href already selects a live channel", () => {
    expect(
      leftoverUpcomingMeetings(
        [channelHref],
        [{ id: "chat-standup", kind: "meeting", name: "Standup", guestRoomCode: ROOM }],
        [{ name: "Standup" }],
        ORIGIN,
      ),
    ).toEqual([]);
  });

  it("shows a channel-path leftover again after that meeting channel is gone", () => {
    expect(leftoverUpcomingMeetings([channelHref], [], [], ORIGIN).map((row) => row.id)).toEqual([
      "cal-standup",
    ]);
  });
});

describe("upcomingEventIdsForChannel", () => {
  const standup = {
    id: "chat-standup",
    kind: "meeting" as const,
    name: "Standup",
    guestRoomCode: ROOM,
  };
  const byTitle = {
    id: "cal-title",
    title: "Standup",
    href: "/meet?room=aaaa-bbbb-cccc",
  };
  const byChannelHref = {
    id: "cal-channel",
    title: "Other",
    href: `${ORIGIN}/meet/channels/standup`,
  };
  const byGuestHref = {
    id: "cal-guest",
    title: "Guest path",
    href: `${ORIGIN}/meet/meetings/${ROOM}`,
  };
  const unrelated = {
    id: "cal-other",
    title: "Retro",
    href: "/meet?room=dddd-eeee-ffff",
  };

  it("matches upcoming events by title and Meet href without duplicating", () => {
    expect(
      upcomingEventIdsForChannel(
        [byTitle, byChannelHref, byGuestHref, unrelated, byTitle],
        standup,
        ORIGIN,
        [standup],
      ),
    ).toEqual(["cal-title", "cal-channel", "cal-guest"]);
  });

  it("does not match chat channels or empty meeting titles", () => {
    expect(upcomingEventIdsForChannel([byTitle], { ...standup, kind: "channel" }, ORIGIN)).toEqual(
      [],
    );
    expect(
      upcomingEventIdsForChannel([byTitle], { ...standup, name: "  " }, ORIGIN, [standup]),
    ).toEqual([]);
  });
});

describe("calendarEventsForMeetingChannel", () => {
  const standup = {
    id: "chat-standup",
    kind: "meeting" as const,
    name: "Standup",
    guestRoomCode: ROOM,
  };

  it("matches past and future events by title or Meet href", () => {
    const past = withMeetLink(
      event({ id: "past", title: "Standup", start: "2026-09-05T12:00:00", duration: "PT30M" }),
    );
    const byHref = withMeetLink(
      event({ id: "href", title: "Other", start: "2026-09-08T12:00:00", duration: "PT30M" }),
      `${ORIGIN}/meet/channels/standup`,
    );
    const cancelled = withMeetLink(
      event({
        id: "cancelled",
        title: "Standup",
        start: "2026-09-09T12:00:00",
        duration: "PT30M",
        status: "cancelled",
      }),
    );
    const unrelated = withMeetLink(
      event({ id: "other", title: "Retro", start: "2026-09-10T12:00:00", duration: "PT30M" }),
      "/meet?room=dddd-eeee-ffff",
    );

    expect(
      calendarEventsForMeetingChannel([past, byHref, cancelled, unrelated], standup, ORIGIN, [
        standup,
      ]).map((row) => row.id),
    ).toEqual(["past", "href"]);
  });
});

describe("preferredCalendarEventForMeeting", () => {
  const now = Temporal.Instant.from("2026-09-06T14:00:00Z");

  it("prefers in-progress, then the next future start, then the latest past", () => {
    const pastEarly = event({
      id: "past-early",
      title: "Early",
      start: "2026-09-05T10:00:00",
      duration: "PT30M",
    });
    const pastLate = event({
      id: "past-late",
      title: "Late",
      start: "2026-09-06T12:00:00",
      duration: "PT30M",
    });
    const live = event({
      id: "live",
      title: "Now",
      start: "2026-09-06T13:45:00",
      duration: "PT30M",
    });
    const soon = event({
      id: "soon",
      title: "Soon",
      start: "2026-09-06T15:00:00",
      duration: "PT30M",
    });
    const later = event({
      id: "later",
      title: "Later",
      start: "2026-09-06T16:00:00",
      duration: "PT30M",
    });

    expect(preferredCalendarEventForMeeting([soon, live, later], now)?.id).toBe("live");
    expect(preferredCalendarEventForMeeting([later, soon], now)?.id).toBe("soon");
    expect(preferredCalendarEventForMeeting([pastEarly, pastLate], now)?.id).toBe("past-late");
    expect(preferredCalendarEventForMeeting([], now)).toBeNull();
  });
});

describe("seedEditMeetingForm", () => {
  const channel = {
    id: "chat-standup",
    name: "Standup",
    guestRoomCode: ROOM,
  };

  it("seeds from a calendar event and fills a missing Meet URL from the channel", () => {
    const form = seedEditMeetingForm({
      calendarId: "default",
      workspaceOrigin: ORIGIN,
      event: event({
        id: "cal-standup",
        title: "Standup",
        start: "2026-09-06T15:00:00",
        duration: "PT30M",
      }),
      channel,
    });

    expect(form.title).toBe("Standup");
    expect(form.startDate).toBe("2026-09-06");
    expect(form.startTime).toBe("15:00");
    expect(form.meetingUrl).toBe(buildMeetMeetingInviteLink(channel.id, ORIGIN));
    expect(form.meetRoomCode).toBe(ROOM);
  });

  it("seeds leftover calendar rows when there is no meeting channel", () => {
    const form = seedEditMeetingForm({
      calendarId: "default",
      workspaceOrigin: ORIGIN,
      leftover: { title: "Sprint planning", href: HREF },
    });

    expect(form.title).toBe("Sprint planning");
    expect(form.meetingUrl).toBe(HREF);
  });
});
