import { Temporal } from "@js-temporal/polyfill";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { JSCalendarLink } from "@/lib/jmap-client";
import type {
  WgwMeetPatchRoomRequest,
  WgwMeetReserveRoomRequest,
  WgwMeetRoomStatusRequest,
  WgwMeetRoomStatusResponse,
} from "@/lib/api/wgw/types";
import { meetActorPrincipal } from "@/meet-core/src/meet-invite-status";

/** Same pattern as PHP `CalendarMeetLinkHref::ROOM_CODE_PATTERN`. */
export const MEET_ROOM_CODE_PATTERN = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;

export const MEET_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MEET_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CALENDAR_MEET_LINK_KEY = "meet";

const MEET_JOIN_PATHS = new Set(["/meet/guest", "/meet/join"]);

export type CalendarMeetHrefKind = "wgw" | "https";

export type ParsedCalendarMeetHref =
  | { kind: "wgw"; href: string; room: string }
  | { kind: "https"; href: string };

export type CalendarMeetReserveScope = "single" | "series" | "thisAndFuture" | "thisInstance";

export type CalendarMeetRequestOptions = {
  signal?: AbortSignal;
};

export type CalendarMeetOperations = {
  roomStatus: (
    input: WgwMeetRoomStatusRequest,
    opts?: CalendarMeetRequestOptions,
  ) => Promise<WgwMeetRoomStatusResponse>;
  reserveRoom?: (
    input: WgwMeetReserveRoomRequest,
    opts?: CalendarMeetRequestOptions,
  ) => Promise<WgwMeetRoomStatusResponse>;
  patchRoomExpiresAt?: (
    input: WgwMeetPatchRoomRequest,
    opts?: CalendarMeetRequestOptions,
  ) => Promise<WgwMeetRoomStatusResponse>;
};

export function isMeetRoomCode(value: string): boolean {
  return MEET_ROOM_CODE_PATTERN.test(value.trim().toLowerCase());
}

/** Parsed `origin` only. Rejects on parse failure. */
export function parsedOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isHttpUrl(value: string): boolean {
  return parsedOrigin(value) !== null;
}

function normalizeMeetJoinPath(pathname: string): string {
  return `/${pathname.replace(/^\/+|\/+$/g, "")}`;
}

/**
 * Complete same-origin guest/join URL → `{ kind: "wgw" }`.
 * Other valid http(s) → `{ kind: "https" }`.
 * Incomplete WGW-looking values and non-http(s) → `null`.
 * Origin equality only — no `includes` / `startsWith`.
 */
export function parseCalendarMeetHref(
  href: string,
  workspaceOrigin: string,
): ParsedCalendarMeetHref | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const configured = parsedOrigin(workspaceOrigin);
  const hrefOrigin = parsed.origin;
  if (configured && hrefOrigin === configured) {
    const path = normalizeMeetJoinPath(parsed.pathname);
    if (MEET_JOIN_PATHS.has(path)) {
      const room = (parsed.searchParams.get("room") ?? "").trim().toLowerCase();
      if (isMeetRoomCode(room)) {
        return { kind: "wgw", href: trimmed, room };
      }
      return null;
    }
  }

  return { kind: "https", href: trimmed };
}

export function meetingUrlFromLinks(links: unknown): string {
  if (!links || typeof links !== "object") return "";
  const map = links as Record<string, unknown>;
  const preferred = map[CALENDAR_MEET_LINK_KEY];
  const preferredHref = linkHref(preferred);
  if (preferredHref) return preferredHref;
  for (const value of Object.values(map)) {
    const href = linkHref(value);
    if (href) return href;
  }
  return "";
}

function linkHref(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const href = (value as { href?: unknown }).href;
  return typeof href === "string" ? href.trim() : "";
}

export function linksFromMeetingUrl(
  href: string | undefined,
): Record<string, JSCalendarLink> | undefined {
  const trimmed = href?.trim() ?? "";
  if (!trimmed || !isHttpUrl(trimmed)) return undefined;
  return {
    [CALENDAR_MEET_LINK_KEY]: {
      "@type": "Link",
      href: trimmed,
      rel: "describedby",
    },
  };
}

export function calendarMeetOwnerPrincipal(
  calendar: Pick<CalendarInfo, "scope" | "groupSlug"> | undefined,
  username: string | undefined,
): string | null {
  if (calendar?.scope === "group") {
    const slug = calendar.groupSlug?.trim();
    if (slug) return `groups/${slug}`;
  }
  const handle = username?.trim();
  return handle ? meetActorPrincipal(handle) : null;
}

export function meetDraftExpiresAt(nowMs: number = Date.now()): string {
  return new Date(nowMs + MEET_DRAFT_TTL_MS).toISOString();
}

export function meetRemoveExpiresAt(nowMs: number = Date.now()): string {
  return meetDraftExpiresAt(nowMs);
}

export function meetEventExpiresAt(endMs: number): string {
  return new Date(endMs + MEET_EVENT_TTL_MS).toISOString();
}

export function resolveMeetReserveExpiresAt(
  scope: CalendarMeetReserveScope,
  eventEndMs?: number,
): string | null {
  if (scope === "series" || scope === "thisAndFuture") return null;
  if (eventEndMs == null) return meetDraftExpiresAt();
  return meetEventExpiresAt(eventEndMs);
}

export function resolveCalendarMeetReserveScope(input: {
  recurrencePreset: string;
  recurrenceId?: string;
  recurrenceSaveScope?: "thisInstance" | "thisAndFuture";
}): CalendarMeetReserveScope {
  if (input.recurrenceSaveScope === "thisInstance") return "thisInstance";
  if (input.recurrenceSaveScope === "thisAndFuture") return "thisAndFuture";
  if (input.recurrenceId) return "thisAndFuture";
  if (input.recurrencePreset !== "none") return "series";
  return "single";
}

export function formEventEndMs(form: {
  allDay: boolean;
  endDate: string;
  endTime: string;
  timeZone: string | null;
}): number | undefined {
  try {
    const end = form.allDay
      ? Temporal.PlainDateTime.from(`${form.endDate}T00:00:00`).add({ days: 1 })
      : Temporal.PlainDateTime.from(`${form.endDate}T${form.endTime}:00`);
    const timeZone = form.timeZone?.trim() || Temporal.Now.timeZoneId();
    return end.toZonedDateTime(timeZone).epochMilliseconds;
  } catch {
    return undefined;
  }
}

export function meetingUrlFromCalendarEvent(
  event: {
    links?: unknown;
    recurrenceOverrides?: Record<string, unknown> | null;
  },
  recurrenceId?: string,
): string {
  if (recurrenceId) {
    const overrides = event.recurrenceOverrides ?? {};
    const patch = overrides[recurrenceId];
    if (patch && typeof patch === "object" && patch !== null && "links" in patch) {
      return meetingUrlFromLinks((patch as { links?: unknown }).links);
    }
  }
  return meetingUrlFromLinks(event.links);
}

export function roomCodeFromMeetingUrl(href: string, workspaceOrigin: string): string | undefined {
  const parsed = parseCalendarMeetHref(href, workspaceOrigin);
  return parsed?.kind === "wgw" ? parsed.room : undefined;
}

/**
 * URL Calendar Join opens. Same-origin WGW rooms use the signed-in join route
 * so owner / group / createdBy keep host rights. External https stays as-is.
 */
export function calendarMeetJoinHref(href: string, workspaceOrigin: string): string | null {
  const parsed = parseCalendarMeetHref(href, workspaceOrigin);
  if (!parsed) return null;
  if (parsed.kind === "wgw") {
    return `/meet/join?room=${encodeURIComponent(parsed.room)}`;
  }
  return parsed.href;
}

/** Open a calendar meeting in a new window (user-gesture safe). */
export function openCalendarMeetHref(href: string, workspaceOrigin: string): Window | null {
  const target = calendarMeetJoinHref(href, workspaceOrigin);
  if (!target) return null;
  return window.open(target, "_blank", "noopener,noreferrer");
}
