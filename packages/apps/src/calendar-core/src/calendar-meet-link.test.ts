/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarMeetJoinHref,
  calendarMeetOwnerPrincipal,
  isHttpUrl,
  isMeetRoomCode,
  linksFromMeetingUrl,
  meetingUrlFromCalendarEvent,
  meetingUrlFromLinks,
  meetDraftExpiresAt,
  meetEventExpiresAt,
  openCalendarMeetHref,
  parseCalendarMeetHref,
  parsedOrigin,
  resolveCalendarMeetReserveScope,
  resolveMeetReserveExpiresAt,
} from "@/calendar-core/src/calendar-meet-link";

const ORIGIN = "https://workspace.example.com";
const ROOM = "h8y8-ewp6-al8n";
const GUEST = `${ORIGIN}/meet/guest?room=${ROOM}`;
const JOIN = `${ORIGIN}/meet/join?room=${ROOM}`;

describe("parseCalendarMeetHref", () => {
  it("accepts a complete same-origin guest URL by origin equality", () => {
    expect(parseCalendarMeetHref(GUEST, ORIGIN)).toEqual({
      kind: "wgw",
      href: GUEST,
      room: ROOM,
    });
  });

  it("accepts /meet/join and a trailing slash on the path", () => {
    expect(parseCalendarMeetHref(JOIN, ORIGIN)?.kind).toBe("wgw");
    const trailing = parseCalendarMeetHref(`${ORIGIN}/meet/guest/?room=${ROOM}`, ORIGIN);
    expect(trailing?.kind === "wgw" ? trailing.room : undefined).toBe(ROOM);
  });

  it("never treats a different origin as WGW even when the string includes the workspace origin", () => {
    const spoof = `https://evil.example/?next=${encodeURIComponent(GUEST)}`;
    expect(parseCalendarMeetHref(spoof, ORIGIN)).toEqual({ kind: "https", href: spoof });
    expect(
      parseCalendarMeetHref(
        `https://workspace.example.com.evil.test/meet/guest?room=${ROOM}`,
        ORIGIN,
      ),
    ).toEqual({
      kind: "https",
      href: `https://workspace.example.com.evil.test/meet/guest?room=${ROOM}`,
    });
  });

  it("returns null for an incomplete same-origin guest URL so callers never POST", () => {
    expect(parseCalendarMeetHref(`${ORIGIN}/meet/guest?room=abc`, ORIGIN)).toBeNull();
    expect(parseCalendarMeetHref(`${ORIGIN}/meet/guest`, ORIGIN)).toBeNull();
    expect(parseCalendarMeetHref(`${ORIGIN}/meet/guest?room=h8y8-ewp6`, ORIGIN)).toBeNull();
  });

  it("stores other https URLs without classifying them as WGW", () => {
    const zoom = "https://zoom.us/j/123";
    expect(parseCalendarMeetHref(zoom, ORIGIN)).toEqual({ kind: "https", href: zoom });
  });

  it("rejects non-http(s) and unparseable values", () => {
    expect(parseCalendarMeetHref("javascript:alert(1)", ORIGIN)).toBeNull();
    expect(parseCalendarMeetHref("not a url", ORIGIN)).toBeNull();
    expect(isHttpUrl("ftp://files.example/meet")).toBe(false);
  });

  it("uses parsed origin equality only", () => {
    expect(parsedOrigin(GUEST)).toBe(ORIGIN);
    expect(parsedOrigin("https://workspace.example.com:443/meet/guest?room=x")).toBe(ORIGIN);
  });
});

describe("meet room code and links map", () => {
  it("matches the full xxxx-xxxx-xxxx pattern", () => {
    expect(isMeetRoomCode(ROOM)).toBe(true);
    expect(isMeetRoomCode("ABCD-EFGH-IJKL".toLowerCase())).toBe(true);
    expect(isMeetRoomCode("abc")).toBe(false);
  });

  it("reads the first href and writes a meet link", () => {
    expect(
      meetingUrlFromLinks({
        other: { "@type": "Link", href: "https://zoom.us/j/1" },
      }),
    ).toBe("https://zoom.us/j/1");
    expect(linksFromMeetingUrl(GUEST)).toEqual({
      meet: { "@type": "Link", href: GUEST, rel: "describedby" },
    });
    expect(linksFromMeetingUrl("")).toBeUndefined();
    expect(linksFromMeetingUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("prefers a this-instance override links map", () => {
    expect(
      meetingUrlFromCalendarEvent(
        {
          links: { meet: { href: GUEST } },
          recurrenceOverrides: {
            "2033-01-12T10:00:00": {
              links: { meet: { href: "https://zoom.us/j/override" } },
            },
          },
        },
        "2033-01-12T10:00:00",
      ),
    ).toBe("https://zoom.us/j/override");
  });
});

describe("calendarMeetJoinHref", () => {
  it("rewrites same-origin guest and join URLs to /meet/join", () => {
    expect(calendarMeetJoinHref(GUEST, ORIGIN)).toBe(`/meet/join?room=${ROOM}`);
    expect(calendarMeetJoinHref(JOIN, ORIGIN)).toBe(`/meet/join?room=${ROOM}`);
  });

  it("keeps external https URLs unchanged", () => {
    const zoom = "https://zoom.us/j/123";
    expect(calendarMeetJoinHref(zoom, ORIGIN)).toBe(zoom);
  });

  it("returns null for incomplete or non-http values", () => {
    expect(calendarMeetJoinHref(`${ORIGIN}/meet/guest?room=abc`, ORIGIN)).toBeNull();
    expect(calendarMeetJoinHref("javascript:alert(1)", ORIGIN)).toBeNull();
  });
});

describe("openCalendarMeetHref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens WGW Meet in a new window on /meet/join", () => {
    const popup = { closed: false } as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);

    const result = openCalendarMeetHref(GUEST, ORIGIN);

    expect(result).toBe(popup);
    expect(open).toHaveBeenCalledWith(`/meet/join?room=${ROOM}`, "_blank", "noopener,noreferrer");
  });

  it("opens external https URLs in a new window", () => {
    const zoom = "https://zoom.us/j/123";
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    expect(openCalendarMeetHref(zoom, ORIGIN)).toBeNull();
    expect(open).toHaveBeenCalledWith(zoom, "_blank", "noopener,noreferrer");
  });
});

describe("reserve clocks and owner principal", () => {
  it("uses null expiry for series and this-and-future", () => {
    expect(resolveMeetReserveExpiresAt("series")).toBeNull();
    expect(resolveMeetReserveExpiresAt("thisAndFuture")).toBeNull();
  });

  it("uses occurrence/event end + 7 days for single and this-instance", () => {
    const end = Date.parse("2033-01-12T15:00:00.000Z");
    expect(resolveMeetReserveExpiresAt("single", end)).toBe(meetEventExpiresAt(end));
    expect(resolveMeetReserveExpiresAt("thisInstance", end)).toBe(meetEventExpiresAt(end));
  });

  it("uses the draft clock for Remove / abandoned paste", () => {
    const now = Date.parse("2033-01-01T00:00:00.000Z");
    expect(meetDraftExpiresAt(now)).toBe("2033-01-31T00:00:00.000Z");
  });

  it("resolves reserve scope from recurrence + save-scope", () => {
    expect(resolveCalendarMeetReserveScope({ recurrencePreset: "none" })).toBe("single");
    expect(resolveCalendarMeetReserveScope({ recurrencePreset: "weekly" })).toBe("series");
    expect(
      resolveCalendarMeetReserveScope({
        recurrencePreset: "weekly",
        recurrenceId: "2033-01-12T10:00:00",
      }),
    ).toBe("thisAndFuture");
    expect(
      resolveCalendarMeetReserveScope({
        recurrencePreset: "weekly",
        recurrenceId: "2033-01-12T10:00:00",
        recurrenceSaveScope: "thisInstance",
      }),
    ).toBe("thisInstance");
  });

  it("uses the group principal on a group calendar", () => {
    expect(calendarMeetOwnerPrincipal({ scope: "group", groupSlug: "design" }, "bob")).toBe(
      "groups/design",
    );
    expect(calendarMeetOwnerPrincipal({ scope: "personal" }, "Bob")).toBe("u:bob");
  });
});
