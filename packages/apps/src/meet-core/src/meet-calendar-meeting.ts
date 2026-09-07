import { Temporal } from "@js-temporal/polyfill";
import {
  calendarEventToForm,
  emptyCalendarEventForm,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import {
  calendarMeetJoinHref,
  meetingUrlFromLinks,
  parseCalendarMeetHref,
  parseMeetInvitePath,
} from "@/calendar-core/src/calendar-meet-link";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { meetChannelIdForRoom } from "@/meet-core/src/meet-channel-room";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { meetChannelIdsEqual, meetCollectionIdFromPublic } from "@/meet-core/src/meet-public-id";
import { buildMeetMeetingInviteLink } from "@/meet-core/src/meet-route-search";
import type { MeetChannel } from "@/meet-core/src/meet-types";

/** Instant Meet creates use 30 minutes, not the calendar editor's 60-minute default. */
export const INSTANT_MEETING_DURATION_MINUTES = 30;

/**
 * Instant creates save a When of "now". Treat the event as scheduled (eligible
 * for relative copy + auto-join) when it was saved at least this far before start.
 */
export const SCHEDULED_MEETING_LEAD_MINUTES = 2;

export type UpcomingMeetEvent = {
  id: string;
  title: string;
  href: string;
  start: Temporal.ZonedDateTime;
  end: Temporal.ZonedDateTime;
};

export type MeetUpcomingMeeting = {
  id: string;
  title: string;
  startLabel: string;
  href: string;
  start?: Temporal.ZonedDateTime;
  end?: Temporal.ZonedDateTime;
};

export function seedInstantMeetingForm(input: {
  calendarId: string;
  now: Temporal.ZonedDateTime;
  meetingUrl?: string;
  meetRoomCode?: string;
}): CalendarEventFormValue {
  const start = input.now.round({ smallestUnit: "minute", roundingMode: "floor" });
  const end = start.add({ minutes: INSTANT_MEETING_DURATION_MINUTES });
  const startDate = start.toPlainDate().toString();
  const startTime = start.toPlainTime().toString({ smallestUnit: "minute" });
  const base = emptyCalendarEventForm(input.calendarId, startDate, startTime);
  const room = input.meetRoomCode?.trim();
  return {
    ...base,
    endDate: end.toPlainDate().toString(),
    endTime: end.toPlainTime().toString({ smallestUnit: "minute" }),
    meetingUrl: input.meetingUrl?.trim() ?? "",
    ...(room ? { meetRoomCode: room } : {}),
  };
}

function eventStartZoned(event: JmapCalendarEvent): Temporal.ZonedDateTime | null {
  const timeZone = event.timeZone?.trim() || Temporal.Now.timeZoneId();
  const raw = event.start?.trim();
  if (raw) {
    try {
      if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) {
        return Temporal.Instant.from(raw).toZonedDateTimeISO(timeZone);
      }
      return Temporal.PlainDateTime.from(raw).toZonedDateTime(timeZone);
    } catch {
      // Fall through to utcStart.
    }
  }
  const utc = parseEventInstant(event.utcStart);
  if (utc) {
    try {
      return utc.toZonedDateTimeISO(timeZone);
    } catch {
      return null;
    }
  }
  return null;
}

function eventDuration(event: JmapCalendarEvent): Temporal.Duration {
  try {
    return Temporal.Duration.from(event.duration ?? "PT0S");
  } catch {
    return Temporal.Duration.from({ minutes: 0 });
  }
}

function parseEventInstant(value: unknown): Temporal.Instant | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const raw = value.trim();
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) return Temporal.Instant.from(raw);
    return Temporal.Instant.from(`${raw}Z`);
  } catch {
    return null;
  }
}

export function calendarEventTimeWindow(
  event: JmapCalendarEvent,
): { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime } | null {
  const start = eventStartZoned(event);
  if (!start) return null;
  return { start, end: start.add(eventDuration(event)) };
}

export function meetInstantIsInWindow(
  start: Temporal.Instant,
  end: Temporal.Instant,
  now: Temporal.Instant,
): boolean {
  return Temporal.Instant.compare(start, now) <= 0 && Temporal.Instant.compare(now, end) <= 0;
}

/**
 * Instant meetings persist a now+30m When for reservation expiry. Those saves
 * land at (or after) start. A When chosen ahead of time has a `created` stamp
 * at least {@link SCHEDULED_MEETING_LEAD_MINUTES} before start. Do not use
 * `updated` — CalDAV sync rewrites it and would hide every live event.
 */
export function calendarEventLooksScheduled(event: JmapCalendarEvent): boolean {
  const window = calendarEventTimeWindow(event);
  if (!window) return false;
  const stamp = parseEventInstant(event.created);
  if (!stamp) return true;
  const leadSeconds = stamp.until(window.start.toInstant()).total({ unit: "seconds" });
  return leadSeconds >= SCHEDULED_MEETING_LEAD_MINUTES * 60;
}

export function shouldAutoJoinScheduledMeeting(
  event: JmapCalendarEvent | null | undefined,
  now: Temporal.Instant,
): boolean {
  if (!event || !calendarEventLooksScheduled(event)) return false;
  const window = calendarEventTimeWindow(event);
  if (!window) return false;
  return meetInstantIsInWindow(window.start.toInstant(), window.end.toInstant(), now);
}

/** Calendar events with a Meet href that are in progress or starting later, sorted by start. */
export function upcomingMeetEvents(
  events: readonly JmapCalendarEvent[],
  now: Temporal.Instant,
): UpcomingMeetEvent[] {
  const rows: UpcomingMeetEvent[] = [];
  for (const event of events) {
    if (event.status === "cancelled") continue;
    const href = meetingUrlFromLinks(event.links);
    if (!href) continue;
    const start = eventStartZoned(event);
    if (!start) continue;
    const end = start.add(eventDuration(event));
    if (Temporal.Instant.compare(end.toInstant(), now) < 0) continue;
    rows.push({
      id: event.id,
      title: event.title?.trim() || "Meeting",
      href,
      start,
      end,
    });
  }
  rows.sort((left, right) => Temporal.ZonedDateTime.compare(left.start, right.start));
  return rows;
}

export function formatUpcomingMeetStart(start: Temporal.ZonedDateTime, locale?: string): string {
  return start.toPlainTime().toLocaleString(locale, { timeStyle: "short" });
}

function formatUpcomingMeetDay(
  start: Temporal.ZonedDateTime,
  now: Temporal.ZonedDateTime,
  locale?: string,
): string {
  const startDate = start.toPlainDate();
  const nowDate = now.toPlainDate();
  const days = nowDate.until(startDate).days;
  if (days > 0 && days < 7) {
    return startDate.toLocaleString(locale, { weekday: "long" });
  }
  return startDate.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    ...(startDate.year === nowDate.year ? {} : { year: "numeric" }),
  });
}

/**
 * Sidebar “Today’s meetings”: starts today (event tz) or still in progress, and not ended.
 */
export function meetWindowIsTodayAndNotEnded(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
  now: Temporal.Instant,
): boolean {
  if (Temporal.Instant.compare(end.toInstant(), now) < 0) return false;
  if (meetInstantIsInWindow(start.toInstant(), end.toInstant(), now)) return true;
  const nowZoned = now.toZonedDateTimeISO(start.timeZoneId);
  return Temporal.PlainDate.compare(start.toPlainDate(), nowZoned.toPlainDate()) === 0;
}

/** Relative When for a future start. In-window and ended return null (no “started”). */
export function formatUpcomingMeetWhen(
  start: Temporal.ZonedDateTime,
  end: Temporal.ZonedDateTime,
  now: Temporal.Instant,
  locale?: string,
): string | null {
  const startInstant = start.toInstant();
  const endInstant = end.toInstant();
  if (meetInstantIsInWindow(startInstant, endInstant, now)) return null;
  if (Temporal.Instant.compare(startInstant, now) <= 0) return null;
  const seconds = now.until(startInstant).total({ unit: "seconds" });
  if (seconds < 60 * 60) {
    const minutes = Math.max(1, Math.floor(seconds / 60));
    return minutes === 1
      ? meetLabels.upcomingStartsInOneMinute
      : meetLabels.upcomingStartsInMinutes(minutes);
  }
  const nowZoned = now.toZonedDateTimeISO(start.timeZoneId);
  const time = formatUpcomingMeetStart(start, locale);
  const startDate = start.toPlainDate();
  const nowDate = nowZoned.toPlainDate();
  if (Temporal.PlainDate.compare(startDate, nowDate) === 0) {
    return meetLabels.upcomingStartsTodayAt(time);
  }
  if (Temporal.PlainDate.compare(startDate, nowDate.add({ days: 1 })) === 0) {
    return meetLabels.upcomingStartsTomorrowAt(time);
  }
  return meetLabels.upcomingStartsOnAt(formatUpcomingMeetDay(start, nowZoned, locale), time);
}

export function upcomingMeetingsForSidebar(
  events: readonly JmapCalendarEvent[],
  now: Temporal.Instant,
  workspaceOrigin: string,
  locale?: string,
): MeetUpcomingMeeting[] {
  return upcomingMeetEvents(events, now)
    .filter((row) => meetWindowIsTodayAndNotEnded(row.start, row.end, now))
    .map((row) => ({
      id: row.id,
      title: row.title,
      startLabel: formatUpcomingMeetStart(row.start, locale),
      href: calendarMeetJoinHref(row.href, workspaceOrigin) ?? row.href,
      start: row.start,
      end: row.end,
    }));
}

export function leftoverBelongsInTodaySidebar(
  meeting: Pick<MeetUpcomingMeeting, "start" | "end">,
  now: Temporal.Instant,
): boolean {
  if (!meeting.start || !meeting.end) return true;
  return meetWindowIsTodayAndNotEnded(meeting.start, meeting.end, now);
}

/** Sidebar trailing time: locale short clock, never relative copy. */
export function leftoverMeetingStartLabel(
  meeting: Pick<MeetUpcomingMeeting, "startLabel" | "start">,
  locale?: string,
): string {
  if (meeting.start) {
    return formatUpcomingMeetStart(meeting.start, locale);
  }
  return meeting.startLabel;
}

/** Sidebar time for a meeting channel that already has a matching calendar event. */
export function upcomingLabelForChannel(
  upcoming: readonly MeetUpcomingMeeting[],
  channel: Pick<MeetChannel, "id" | "kind" | "name" | "guestRoomCode">,
  workspaceOrigin: string,
  channels: readonly Pick<MeetChannel, "id" | "kind" | "guestRoomCode">[] = [channel],
): string | null {
  const ids = upcomingEventIdsForChannel(upcoming, channel, workspaceOrigin, channels);
  const match = upcoming.find((row) => ids.includes(row.id));
  return match?.startLabel ?? null;
}

export function relativeLabelForCalendarEvent(
  event: JmapCalendarEvent | null | undefined,
  now: Temporal.Instant,
  locale?: string,
): string | null {
  if (!event) return null;
  const window = calendarEventTimeWindow(event);
  if (!window) return null;
  if (Temporal.Instant.compare(now, window.end.toInstant()) > 0) return null;
  return formatUpcomingMeetWhen(window.start, window.end, now, locale);
}

/** Sidebar / header When for a meeting channel's preferred matching calendar event. */
export function relativeLabelForMeetingChannel(
  events: readonly JmapCalendarEvent[],
  channel: Pick<MeetChannel, "id" | "kind" | "name" | "guestRoomCode">,
  workspaceOrigin: string,
  now: Temporal.Instant,
  channels: readonly Pick<MeetChannel, "id" | "kind" | "guestRoomCode">[] = [channel],
  locale?: string,
): string | null {
  const matches = calendarEventsForMeetingChannel(events, channel, workspaceOrigin, channels);
  return relativeLabelForCalendarEvent(preferredCalendarEventForMeeting(matches, now), now, locale);
}

/** Sidebar clock for a meeting channel that belongs in Today’s meetings; otherwise null. */
export function clockLabelForMeetingChannel(
  events: readonly JmapCalendarEvent[],
  channel: Pick<MeetChannel, "id" | "kind" | "name" | "guestRoomCode">,
  workspaceOrigin: string,
  now: Temporal.Instant,
  channels: readonly Pick<MeetChannel, "id" | "kind" | "guestRoomCode">[] = [channel],
  locale?: string,
): string | null {
  const matches = calendarEventsForMeetingChannel(events, channel, workspaceOrigin, channels);
  const preferred = preferredCalendarEventForMeeting(matches, now);
  const window = preferred ? calendarEventTimeWindow(preferred) : null;
  if (!window || !meetWindowIsTodayAndNotEnded(window.start, window.end, now)) return null;
  return formatUpcomingMeetStart(window.start, locale);
}

export function todaySidebarMeetingChannels<T extends MeetChannel>(
  meetings: readonly T[],
  events: readonly JmapCalendarEvent[],
  workspaceOrigin: string,
  now: Temporal.Instant,
  channels: readonly Pick<MeetChannel, "id" | "kind" | "guestRoomCode">[] = meetings,
): T[] {
  return meetings.filter(
    (channel) =>
      clockLabelForMeetingChannel(events, channel, workspaceOrigin, now, channels) != null,
  );
}

export type MeetUpcomingJoinTarget =
  | { kind: "channel"; channelId: string }
  | { kind: "room"; room: string }
  | { kind: "external"; href: string };

/**
 * Where an Upcoming row should go for a signed-in member. Same-origin Meet
 * hrefs stay in MeetChatApp (channel select or ad-hoc room). Relative paths
 * like `/meet?room=` and `/meet/meetings/{id}` resolve against workspaceOrigin.
 */
export function meetUpcomingJoinTarget(
  href: string,
  workspaceOrigin: string,
  channels: readonly Pick<MeetChannel, "id" | "kind" | "guestRoomCode">[] = [],
): MeetUpcomingJoinTarget | null {
  const invite = parseMeetInvitePath(href);
  if (invite) {
    if (invite.roomKind === "channel") {
      const channelId =
        meetChannelIdForRoom(channels, invite.room) ?? meetCollectionIdFromPublic(invite.room);
      return { kind: "channel", channelId };
    }
    const mapped = meetChannelIdForRoom(channels, invite.room);
    if (mapped) return { kind: "channel", channelId: mapped };
    return { kind: "room", room: invite.room };
  }
  const parsed = parseCalendarMeetHref(href, workspaceOrigin);
  if (parsed?.kind === "https") return { kind: "external", href: parsed.href };
  return null;
}

/**
 * Calendar leftover rows: Meet hrefs that are not already a meeting channel
 * (by join target or owned-meeting title). After a meeting channel is deleted,
 * a channel-path href is leftover again unless the calendar event is gone too.
 */
export function leftoverUpcomingMeetings(
  upcoming: readonly MeetUpcomingMeeting[],
  channels: readonly Pick<MeetChannel, "id" | "kind" | "name" | "guestRoomCode">[],
  ownedMeetings: readonly Pick<MeetChannel, "name">[],
  workspaceOrigin: string,
): MeetUpcomingMeeting[] {
  return upcoming.filter((row) => {
    const target = meetUpcomingJoinTarget(row.href, workspaceOrigin, channels);
    if (target?.kind === "channel") {
      const exists = channels.some((channel) => meetChannelIdsEqual(channel.id, target.channelId));
      if (exists) return false;
    }
    return !ownedMeetings.some((channel) => channel.name === row.title);
  });
}

/**
 * Upcoming calendar events that belong to a meeting channel — same title
 * and/or a Meet href that already selects that channel (invite URL / guest room).
 */
export function upcomingEventIdsForChannel(
  upcoming: readonly Pick<MeetUpcomingMeeting, "id" | "title" | "href">[],
  channel: Pick<MeetChannel, "id" | "kind" | "name" | "guestRoomCode">,
  workspaceOrigin: string,
  channels: readonly Pick<MeetChannel, "id" | "kind" | "guestRoomCode">[] = [channel],
): string[] {
  if (channel.kind !== "meeting") return [];
  const title = channel.name.trim();
  const lookup = channels.length > 0 ? channels : [channel];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of upcoming) {
    const titleMatch = Boolean(title) && row.title.trim() === title;
    const target = meetUpcomingJoinTarget(row.href, workspaceOrigin, lookup);
    const hrefMatch =
      target?.kind === "channel" && meetChannelIdsEqual(target.channelId, channel.id);
    if (!titleMatch && !hrefMatch) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  return ids;
}

/** Calendar events that belong to a meeting channel (any start time, including past). */
export function calendarEventsForMeetingChannel(
  events: readonly JmapCalendarEvent[],
  channel: Pick<MeetChannel, "id" | "kind" | "name" | "guestRoomCode">,
  workspaceOrigin: string,
  channels: readonly Pick<MeetChannel, "id" | "kind" | "guestRoomCode">[] = [channel],
): JmapCalendarEvent[] {
  if (channel.kind !== "meeting") return [];
  const title = channel.name.trim();
  const lookup = channels.length > 0 ? channels : [channel];
  return events.filter((event) => {
    if (event.status === "cancelled") return false;
    const titleMatch = Boolean(title) && (event.title?.trim() ?? "") === title;
    const href = meetingUrlFromLinks(event.links);
    const target = href ? meetUpcomingJoinTarget(href, workspaceOrigin, lookup) : null;
    const hrefMatch =
      target?.kind === "channel" && meetChannelIdsEqual(target.channelId, channel.id);
    return titleMatch || hrefMatch;
  });
}

/** Prefer an in-progress event, then the next future start, then the latest past. */
export function preferredCalendarEventForMeeting(
  events: readonly JmapCalendarEvent[],
  now: Temporal.Instant = Temporal.Now.instant(),
): JmapCalendarEvent | null {
  if (events.length === 0) return null;
  const scored = events.map((event) => {
    const start = eventStartZoned(event);
    const end = start ? start.add(eventDuration(event)) : null;
    let rank = 2;
    if (start && end) {
      const startInstant = start.toInstant();
      const endInstant = end.toInstant();
      if (
        Temporal.Instant.compare(startInstant, now) <= 0 &&
        Temporal.Instant.compare(now, endInstant) <= 0
      ) {
        rank = 0;
      } else if (Temporal.Instant.compare(startInstant, now) > 0) {
        rank = 1;
      }
    }
    return { event, rank, start };
  });
  scored.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.start && right.start) {
      const byStart = Temporal.ZonedDateTime.compare(left.start, right.start);
      return left.rank === 2 ? -byStart : byStart;
    }
    return 0;
  });
  return scored[0]?.event ?? null;
}

/** Seed the Meet calendar-event dialog for an existing meeting or leftover. */
export function seedEditMeetingForm(input: {
  calendarId: string;
  workspaceOrigin: string;
  event?: JmapCalendarEvent | null;
  channel?: Pick<MeetChannel, "id" | "name" | "guestRoomCode"> | null;
  leftover?: Pick<MeetUpcomingMeeting, "title" | "href"> | null;
}): CalendarEventFormValue {
  const channelUrl = input.channel
    ? buildMeetMeetingInviteLink(input.channel.id, input.workspaceOrigin)
    : "";
  if (input.event) {
    const form = calendarEventToForm(input.event);
    const meetingUrl = form.meetingUrl.trim() || channelUrl || input.leftover?.href.trim() || "";
    const room = input.channel?.guestRoomCode?.trim();
    return {
      ...form,
      calendarId: form.calendarId || input.calendarId,
      title: form.title.trim() || input.channel?.name.trim() || input.leftover?.title.trim() || "",
      meetingUrl,
      ...(room ? { meetRoomCode: room } : {}),
    };
  }
  if (input.channel) {
    return {
      ...seedInstantMeetingForm({
        calendarId: input.calendarId,
        now: Temporal.Now.zonedDateTimeISO(),
        meetingUrl: channelUrl,
        meetRoomCode: input.channel.guestRoomCode ?? undefined,
      }),
      title: input.channel.name,
    };
  }
  if (input.leftover) {
    return {
      ...seedInstantMeetingForm({
        calendarId: input.calendarId,
        now: Temporal.Now.zonedDateTimeISO(),
        meetingUrl: input.leftover.href,
      }),
      title: input.leftover.title,
    };
  }
  return seedInstantMeetingForm({
    calendarId: input.calendarId,
    now: Temporal.Now.zonedDateTimeISO(),
  });
}
