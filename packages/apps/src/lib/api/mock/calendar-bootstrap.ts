import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarUIData } from "@/calendar-core/src/calendar-types";
import { mapCalendarDirectoryGroups } from "@/calendar-core/src/calendar-workspace-props";
import { createSettingsAppBootstrap } from "@/lib/api/mock/settings-bootstrap";

export type CalendarAppBootstrap = {
  data: CalendarUIData;
  session: WorkspaceSession;
};

function mockEvent(
  id: string,
  calendarId: string,
  title: string,
  start: string,
  duration: string,
  extra: Partial<JmapCalendarEvent> = {},
): JmapCalendarEvent {
  return {
    "@type": "Event",
    id,
    uid: `urn:uuid:mock-${id}`,
    calendarIds: { [calendarId]: true },
    title,
    start,
    duration,
    timeZone: "Etc/UTC",
    ...extra,
  } as JmapCalendarEvent;
}

/** Deterministic anchor keeps stories/screenshots stable regardless of run date. */
export const MOCK_CALENDAR_ANCHOR = "2033-01-12";

export function createCalendarAppBootstrap(): CalendarAppBootstrap {
  const monday = Temporal.PlainDate.from("2033-01-10");
  const day = (offset: number, time: string) =>
    `${monday.add({ days: offset }).toString()}T${time}`;

  return {
    session: {
      ...mockWorkspaceSession,
      user: {
        ...mockWorkspaceSession.user,
        email: "me@example.test",
        displayName: "Me",
        initials: "ME",
      },
    },
    data: {
      calendars: [
        {
          id: "default",
          name: "Personal",
          color: "#6366f1",
          isDefault: true,
          mayWrite: true,
          mayShare: true,
          mayDelete: true,
          sortOrder: 0,
          shareWith: {
            alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
          },
        },
        {
          id: "work",
          name: "Work",
          color: "#0ea5e9",
          mayWrite: true,
          mayShare: true,
          mayDelete: true,
          sortOrder: 1,
        },
        {
          id: "family",
          name: "Family",
          color: "#f59e0b",
          mayWrite: false,
          mayShare: false,
          mayDelete: false,
          sortOrder: 2,
        },
        {
          id: "holidays",
          name: "US Holidays",
          color: "#8b5cf6",
          mayWrite: false,
          mayDelete: true,
          subscriptionId: "sub-holidays",
          subscriptionUrl: "https://feeds.example.test/holidays.ics",
          sortOrder: 3,
        },
        {
          id: "group-editorial",
          name: "Editorial",
          color: "#22c55e",
          scope: "group",
          groupSlug: "editorial",
          mayWrite: true,
          mayShare: false,
          mayDelete: false,
          sortOrder: 0,
        },
      ],
      groups: mapCalendarDirectoryGroups(createSettingsAppBootstrap().data.groups),
      events: [
        mockEvent("standup", "work", "Team standup", day(0, "09:30:00"), "PT30M", {
          recurrenceRules: [
            {
              "@type": "RecurrenceRule",
              frequency: "weekly",
              byDay: [{ "@type": "NDay", day: "mo" }],
            },
          ],
        }),
        mockEvent("design-review", "work", "Design review", day(2, "14:00:00"), "PT1H", {
          locations: { office: { "@type": "Location", name: "Room 2.1" } },
        }),
        mockEvent("dentist", "default", "Dentist", day(3, "11:00:00"), "PT45M"),
        mockEvent("school-play", "family", "School play", day(4, "18:30:00"), "PT2H"),
        mockEvent("mlk-day", "holidays", "Martin Luther King Jr. Day", day(6, "00:00:00"), "P1D", {
          showWithoutTime: true,
        }),
        mockEvent("offsite", "work", "Winter offsite", day(7, "00:00:00"), "P2D", {
          showWithoutTime: true,
        }),
        mockEvent("awaiting-reply", "work", "Partner sync", day(1, "15:00:00"), "PT1H", {
          participants: {
            org: {
              "@type": "Participant",
              email: "ada@example.test",
              name: "Ada",
              roles: { owner: true },
              participationStatus: "accepted",
            },
            me: {
              "@type": "Participant",
              email: "me@example.test",
              name: "Me",
              roles: { attendee: true },
              participationStatus: "needs-action",
            },
          },
        }),
        mockEvent("maybe-lunch", "default", "Lunch?", day(2, "12:00:00"), "PT45M", {
          participants: {
            org: {
              "@type": "Participant",
              email: "bob@example.test",
              name: "Bob",
              roles: { owner: true },
              participationStatus: "accepted",
            },
            me: {
              "@type": "Participant",
              email: "me@example.test",
              name: "Me",
              roles: { attendee: true },
              participationStatus: "tentative",
            },
          },
        }),
        mockEvent("declined-hidden", "work", "Skip this", day(3, "16:00:00"), "PT30M", {
          participants: {
            me: {
              "@type": "Participant",
              email: "me@example.test",
              name: "Me",
              roles: { attendee: true },
              participationStatus: "declined",
            },
          },
        }),
      ],
    },
  };
}
