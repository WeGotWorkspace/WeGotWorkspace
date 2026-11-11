import { wgwErrorMessageFromBody, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type {
  CalendarAvailabilitySettings,
  CalendarAvailabilitySettingsUpdate,
} from "@wgw/openapi-types/calendars-types";

/**
 * The owner's Team availability settings (#1912). One REST resource, read fresh when the
 * settings pane opens: no push, no `/changes`, no cache. Errors carry the HTTP status.
 */
const PATH = "/calendars/availability";

export type CalendarAvailabilitySettingsOperations = {
  load: () => Promise<CalendarAvailabilitySettings>;
  save: (update: CalendarAvailabilitySettingsUpdate) => Promise<CalendarAvailabilitySettings>;
};

async function readSettings(res: Response, method: string): Promise<CalendarAvailabilitySettings> {
  if (!res.ok) {
    const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
    throw new WgwRequestError(`${method} ${PATH} failed (${res.status}): ${detail}`, res.status);
  }
  return (await wgwReadJson(res)) as CalendarAvailabilitySettings;
}

export async function getCalendarAvailabilitySettingsLive(): Promise<CalendarAvailabilitySettings> {
  return readSettings(await wgwFetch(PATH), "GET");
}

export async function putCalendarAvailabilitySettingsLive(
  update: CalendarAvailabilitySettingsUpdate,
): Promise<CalendarAvailabilitySettings> {
  const res = await wgwFetch(PATH, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  return readSettings(res, "PUT");
}

export function createWgwCalendarAvailabilitySettingsOperations(): CalendarAvailabilitySettingsOperations {
  return {
    load: getCalendarAvailabilitySettingsLive,
    save: putCalendarAvailabilitySettingsLive,
  };
}
