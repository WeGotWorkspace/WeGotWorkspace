import type {
  CalendarAvailabilityCalendar,
  CalendarAvailabilitySettings,
  CalendarAvailabilitySettingsUpdate,
} from "@wgw/openapi-types/calendars-types";

export type CalendarAvailabilityDetail = CalendarAvailabilityCalendar["detail"];

export type CalendarAvailabilityFormValues = {
  enabled: boolean;
  calendars: { calendarId: string; include: boolean; detail: CalendarAvailabilityDetail }[];
};

export function calendarAvailabilityToForm(
  settings: CalendarAvailabilitySettings,
): CalendarAvailabilityFormValues {
  return {
    enabled: settings.enabled,
    calendars: settings.calendars.map(({ calendarId, include, detail }) => ({
      calendarId,
      include,
      detail,
    })),
  };
}

/**
 * The PUT body for a Save: the switch, plus only the calendars whose choice changed. A Team
 * calendar never sends `detail` (the server answers 422 on `details`). Untouched rows stay out,
 * so a calendar deleted elsewhere since the pane loaded cannot fail an unrelated Save.
 */
export function calendarAvailabilityUpdateFromForm(
  loaded: CalendarAvailabilitySettings,
  values: CalendarAvailabilityFormValues,
): CalendarAvailabilitySettingsUpdate {
  const byId = new Map(loaded.calendars.map((calendar) => [calendar.calendarId, calendar]));
  const calendars: NonNullable<CalendarAvailabilitySettingsUpdate["calendars"]> = [];
  for (const row of values.calendars) {
    const before = byId.get(row.calendarId);
    if (!before) continue;
    const isTeam = before.source === "team";
    const includeChanged = row.include !== before.include;
    const detailChanged = !isTeam && row.detail !== before.detail;
    if (!includeChanged && !detailChanged) continue;
    calendars.push({
      calendarId: row.calendarId,
      ...(includeChanged ? { include: row.include } : {}),
      ...(detailChanged ? { detail: row.detail } : {}),
    });
  }
  return { enabled: values.enabled, ...(calendars.length > 0 ? { calendars } : {}) };
}
