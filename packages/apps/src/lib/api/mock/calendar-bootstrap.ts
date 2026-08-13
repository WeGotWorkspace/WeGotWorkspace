import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarUIData } from "@/calendar-core/src/calendar-types";

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
    session: mockWorkspaceSession,
    data: {
      calendars: [
        { id: "default", name: "Personal", color: "#6366f1", isDefault: true, mayWrite: true },
        { id: "work", name: "Work", color: "#0ea5e9", mayWrite: true },
        { id: "family", name: "Family", color: "#f59e0b", mayWrite: false },
      ],
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
        mockEvent("offsite", "work", "Winter offsite", day(7, "00:00:00"), "P2D", {
          showWithoutTime: true,
        }),
      ],
    },
  };
}
