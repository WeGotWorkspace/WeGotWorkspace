import type { CalendarAvailabilitySettingsOperations } from "@/lib/api/wgw/calendar-availability";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { CalendarAvailabilitySettings } from "@wgw/openapi-types/calendars-types";

/** Mock app seed: matches the calendars of `createCalendarAppBootstrap` (no subscription rows). */
export function mockCalendarAvailabilitySettings(
  overrides: Partial<CalendarAvailabilitySettings> = {},
): CalendarAvailabilitySettings {
  return {
    enabled: false,
    teams: [
      { slug: "editorial", name: "Editorial" },
      { slug: "design", name: "Design" },
    ],
    calendars: [
      {
        calendarId: "default",
        name: "Personal",
        color: "#6366f1",
        source: "personal",
        include: true,
        detail: "busy",
      },
      {
        calendarId: "work",
        name: "Work",
        color: "#0ea5e9",
        source: "personal",
        include: true,
        detail: "busy",
      },
      {
        calendarId: "group-editorial",
        name: "Editorial",
        color: "#22c55e",
        source: "team",
        include: true,
        detail: "busy",
      },
    ],
    ...overrides,
  };
}

function unprocessable(description: string): WgwRequestError {
  return new WgwRequestError(`PUT /calendars/availability failed (422): ${description}`, 422);
}

/**
 * In-memory stand-in for `GET|PUT /api/v1/calendars/availability`, with the server's 422 rules:
 * an unknown calendar or `details` on a Team calendar writes nothing.
 */
export function createMockCalendarAvailabilitySettingsOperations(
  seed: CalendarAvailabilitySettings = mockCalendarAvailabilitySettings(),
): CalendarAvailabilitySettingsOperations {
  let state = structuredClone(seed);
  return {
    load: async () => structuredClone(state),
    save: async (update) => {
      const next = structuredClone(state);
      if (update.enabled !== undefined) next.enabled = update.enabled;
      for (const change of update.calendars ?? []) {
        const row = next.calendars.find((calendar) => calendar.calendarId === change.calendarId);
        if (!row) throw unprocessable(`Unknown calendar ${change.calendarId}`);
        if (change.detail === "details" && row.source === "team") {
          throw unprocessable("A Team calendar is always time only");
        }
        if (change.include !== undefined) row.include = change.include;
        if (change.detail !== undefined) row.detail = change.detail;
      }
      state = next;
      return structuredClone(state);
    },
  };
}
