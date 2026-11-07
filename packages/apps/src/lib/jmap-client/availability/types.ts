import type {
  CalendarAvailabilityBusyPeriod,
  CalendarAvailabilityGetRequest,
  CalendarAvailabilityGetResponse,
  CalendarAvailabilityPerson,
  CalendarAvailabilityTeamMember,
  CalendarAvailabilityTeamMemberGetResponse,
} from "@wgw/openapi-types/calendars-types";

/**
 * Wire types of `urn:wgw:jmap:availability` (Epic #1907), taken from the OpenAPI
 * contract so the client and the server cannot drift apart.
 */

/** A teammate the caller may see. `id` is the username (also their JMAP accountId). */
export type JmapTeamMember = CalendarAvailabilityTeamMember;

/** `state` hashes every visible `(id, version)`; compared on the availability tick. */
export type JmapTeamMemberGetResponse = Omit<
  CalendarAvailabilityTeamMemberGetResponse,
  "accountId"
> & {
  accountId?: string;
};

/**
 * One busy period. A UTC time keeps its `Z` with `timeZone: null`; all-day is a
 * bare date with `showWithoutTime`; `title`/`location` only when details are shared.
 */
export type JmapBusyPeriod = CalendarAvailabilityBusyPeriod;

export type JmapTeamMemberAvailability = CalendarAvailabilityPerson;

/** `utcStart` is a Monday 00:00 UTC; `utcEnd` a whole number of weeks later. */
export type JmapTeamMemberGetAvailabilityArgs = Omit<CalendarAvailabilityGetRequest, "accountId">;

export type JmapTeamMemberGetAvailabilityResponse = Omit<
  CalendarAvailabilityGetResponse,
  "accountId"
> & { accountId?: string };
