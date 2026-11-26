import type { CalendarAvailabilityPublicLinkOperations } from "@/lib/api/wgw/calendar-availability-public-link";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { CalendarAvailabilityPublicLink } from "@wgw/openapi-types/calendars-types";

const OFF: CalendarAvailabilityPublicLink = { enabled: false };

function linkFor(token: string): CalendarAvailabilityPublicLink {
  const httpsUrl = `https://workspace.example/api/v1/calendars/availability/feeds/${token}`;
  return { enabled: true, httpsUrl, webcalUrl: httpsUrl.replace(/^https:/, "webcal:") };
}

/**
 * In-memory stand-in for `…/calendars/availability/public-link`: turning on twice keeps the link,
 * a new link changes the token, turning off clears it. Regenerating while off is a 409, as on
 * the server.
 */
export function createMockCalendarAvailabilityPublicLinkOperations(
  seed: CalendarAvailabilityPublicLink = OFF,
): CalendarAvailabilityPublicLinkOperations {
  let state = structuredClone(seed);
  let serial = 1;
  const mint = () => `mock${String(serial++).padStart(4, "0")}${"x".repeat(40)}`;
  return {
    load: async () => structuredClone(state),
    turnOn: async () => {
      if (!state.enabled) state = linkFor(mint());
      return structuredClone(state);
    },
    regenerate: async () => {
      if (!state.enabled) {
        throw new WgwRequestError("PUT /calendars/availability/public-link failed (409)", 409);
      }
      state = linkFor(mint());
      return structuredClone(state);
    },
    turnOff: async () => {
      state = structuredClone(OFF);
    },
  };
}
