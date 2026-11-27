import { wgwErrorMessageFromBody, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { CalendarAvailabilityPublicLink } from "@wgw/openapi-types/calendars-types";

/**
 * The owner's public availability link (#2406): one REST resource, read fresh when the settings
 * pane opens. Turning on, making a new link and turning off are three calls; errors carry the
 * HTTP status.
 */
const PATH = "/calendars/availability/public-link";

export type CalendarAvailabilityPublicLinkOperations = {
  load: () => Promise<CalendarAvailabilityPublicLink>;
  /** Turns the link on, or returns the one that is on. Never replaces a live link. */
  turnOn: () => Promise<CalendarAvailabilityPublicLink>;
  /** Replaces the link: the old address stops working. */
  regenerate: () => Promise<CalendarAvailabilityPublicLink>;
  turnOff: () => Promise<void>;
};

async function failure(res: Response, method: string): Promise<WgwRequestError> {
  const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
  return new WgwRequestError(`${method} ${PATH} failed (${res.status}): ${detail}`, res.status);
}

async function readLink(res: Response, method: string): Promise<CalendarAvailabilityPublicLink> {
  if (!res.ok) throw await failure(res, method);
  return (await wgwReadJson(res)) as CalendarAvailabilityPublicLink;
}

export function createWgwCalendarAvailabilityPublicLinkOperations(): CalendarAvailabilityPublicLinkOperations {
  return {
    load: async () => readLink(await wgwFetch(PATH), "GET"),
    turnOn: async () => readLink(await wgwFetch(PATH, { method: "POST" }), "POST"),
    regenerate: async () => readLink(await wgwFetch(PATH, { method: "PUT" }), "PUT"),
    turnOff: async () => {
      const res = await wgwFetch(PATH, { method: "DELETE" });
      if (!res.ok) throw await failure(res, "DELETE");
    },
  };
}
