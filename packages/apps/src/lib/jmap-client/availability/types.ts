import type { JmapId, JmapState } from "../core/types.js";
import type { JSCalendarDuration, JSCalendarLocalDateTime } from "../jscalendar/types.js";

/** Vendor capability for teammates' busy times (Epic #1907). */
export const AVAILABILITY_CAPABILITY = "urn:wgw:jmap:availability";

/** A teammate the caller may see. `id` is the username (also their JMAP accountId). */
export type JmapTeamMember = {
  id: JmapId;
  name: string;
  /** The caller's own row, present only while their own switch is on. */
  isSelf: boolean;
  /** Changes on a rename, a switch flip, or any include or detail change. */
  version: string;
};

export type JmapTeamMemberGetResponse = {
  accountId?: JmapId;
  /** Hash of every visible `(id, version)`; compared on the availability tick. */
  state: JmapState;
  list: JmapTeamMember[];
  notFound: JmapId[];
};

/** One busy period, close to the standard `Principal/getAvailability` BusyPeriod. */
export type JmapBusyPeriod = {
  /** LocalDateTime; a UTC time keeps its `Z` (`2030-01-07T10:00:00Z`); all-day is a bare date. */
  start: JSCalendarLocalDateTime;
  /** IANA zone, or null for UTC (`…Z`), floating and all-day times. */
  timeZone: string | null;
  duration: JSCalendarDuration;
  showWithoutTime: boolean;
  /** Only when the owner shares details for that calendar. */
  title?: string;
  location?: string;
};

export type JmapTeamMemberAvailability = {
  id: JmapId;
  periods: JmapBusyPeriod[];
  /** False when the server could not work out every busy period for the range. */
  complete: boolean;
};

export type JmapTeamMemberGetAvailabilityArgs = {
  ids: JmapId[];
  /** Monday 00:00 UTC, e.g. `2026-11-09T00:00:00Z`. */
  utcStart: string;
  /** A whole number of weeks after `utcStart`. */
  utcEnd: string;
  excludeEventId?: JmapId;
};

export type JmapTeamMemberGetAvailabilityResponse = {
  accountId?: JmapId;
  list: JmapTeamMemberAvailability[];
  notFound: JmapId[];
};
