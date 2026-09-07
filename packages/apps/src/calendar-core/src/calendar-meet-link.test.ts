/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarMeetJoinHref,
  calendarMeetOwnerPrincipal,
  calendarMeetPickerChannels,
  isHttpUrl,
  isMeetChatRoomId,
  isMeetRoomCode,
  linksFromMeetingUrl,
  meetChannelCallHref,
  meetChannelCallRoom,
  meetingUrlFromCalendarEvent,
  meetingUrlFromLinks,
  meetDraftExpiresAt,
  meetEventExpiresAt,
  openCalendarMeetHref,
  parseCalendarMeetHref,
  parsedOrigin,
  resolveCalendarMeetReserveScope,
  resolveMeetReserveExpiresAt,
  roomCodeFromMeetingUrl,
} from "@/calendar-core/src/calendar-meet-link";

const ORIGIN = "https://workspace.example.com";
const ROOM = "h8y8-ewp6-al8n";
const GUEST = `${ORIGIN}/meet/guest?room=${ROOM}`;
const JOIN = `${ORIGIN}/meet/join?room=${ROOM}`;
const CHAT_ROOM = "chat-01h455vb4pa9nnrjpznsav8hva";
const CHAT_GUEST = `${ORIGIN}/meet/guest?room=${CHAT_ROOM}`;
const CHAT_CHANNEL = `${ORIGIN}/meet/channels/${CHAT_ROOM}`;

describe("parseCalendarMeetHref", () => {
  it("accepts a complete same-origin guest URL by origin equality", () => {
    expect(parseCalendarMeetHref(GUEST, ORIGIN)).toEqual({
      kind: "wgw",
      href: GUEST,
      room: ROOM,
      roomKind: "code",
    });
  });

  it("accepts a same-origin chat-channel room as a channel-kind wgw href", () => {
    expect(parseCalendarMeetHref(CHAT_GUEST, ORIGIN)).toEqual({
      kind: "wgw",
      href: CHAT_GUEST,
      room: CHAT_ROOM,
      roomKind: "channel",
    });
    expect(parseCalendarMeetHref(CHAT_CHANNEL, ORIGIN)).toEqual({
      kind: "wgw",
      href: CHAT_CHANNEL,
      room: CHAT_ROOM,
      roomKind: "channel",
    });
    expect(parseCalendarMeetHref(`${ORIGIN}/meet/join?room=${CHAT_ROOM}`, ORIGIN)?.kind).toBe(
      "wgw",
    );
  });

  it("accepts /meet/join and a trailing slash on the path", () => {
    expect(parseCalendarMeetHref(JOIN, ORIGIN)?.kind).toBe("wgw");
    const trailing = parseCalendarMeetHref(`${ORIGIN}/meet/guest/?room=${ROOM}`, ORIGIN);
    expect(trailing?.kind === "wgw" ? trailing.room : undefined).toBe(ROOM);
  });

  it("accepts the unified /meet?room= invite URL", () => {
    const unified = `${ORIGIN}/meet?room=${ROOM}`;
    expect(parseCalendarMeetHref(unified, ORIGIN)).toEqual({
      kind: "wgw",
      href: unified,
      room: ROOM,
      roomKind: "code",
    });
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

  it("accepts relative /meet?room= and /meet/meetings/{id} join hrefs", () => {
    expect(parseCalendarMeetHref(`/meet?room=${ROOM}`, ORIGIN)).toEqual({
      kind: "wgw",
      href: `/meet?room=${ROOM}`,
      room: ROOM,
      roomKind: "code",
    });
    expect(parseCalendarMeetHref(`/meet/meetings/${ROOM}`, ORIGIN)).toEqual({
      kind: "wgw",
      href: `/meet/meetings/${ROOM}`,
      room: ROOM,
      roomKind: "code",
    });
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

  it("matches chat- prefixed channel room ids but not dm- or bare slugs", () => {
    expect(isMeetChatRoomId(CHAT_ROOM)).toBe(true);
    expect(isMeetChatRoomId("chat-team_sync")).toBe(true);
    expect(isMeetChatRoomId("dm-alice-bob")).toBe(false);
    expect(isMeetChatRoomId("chat-")).toBe(false);
    expect(isMeetChatRoomId("general")).toBe(false);
    expect(isMeetChatRoomId(ROOM)).toBe(false);
  });

  it("excludes channel rooms from the reserve-managed room code lookup", () => {
    expect(roomCodeFromMeetingUrl(GUEST, ORIGIN)).toBe(ROOM);
    expect(roomCodeFromMeetingUrl(CHAT_GUEST, ORIGIN)).toBeUndefined();
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

describe("calendarMeetPickerChannels", () => {
  it("drops meeting-kind rows and sorts remaining names locale-aware case-insensitive", () => {
    const rows = [
      { id: "chat-merge", name: "Merge smoke channel", kind: "channel" as const },
      { id: "chat-onzin", name: "onzin", kind: "channel" as const },
      { id: "chat-ditjes", name: "ditjes en datjes", kind: "channel" as const },
      { id: "chat-jasja", name: "jasja", kind: "channel" as const },
      { id: "chat-test-meet", name: "Test Meet", kind: "meeting" as const },
      { id: "chat-week-start", name: "Week Start", kind: "meeting" as const },
      { id: "chat-email-guest", name: "Email guest create check", kind: "meeting" as const },
      { id: "chat-standup", name: "Standup", kind: "channel" as const },
      { id: "chat-admins", name: "Administrators", kind: "channel" as const },
      { id: "chat-dev", name: "Dev Team", kind: "channel" as const },
    ];
    expect(calendarMeetPickerChannels(rows).map((row) => row.name)).toEqual([
      "Administrators",
      "Dev Team",
      "ditjes en datjes",
      "jasja",
      "Merge smoke channel",
      "onzin",
      "Standup",
    ]);
  });
});

describe("meetChannelCallHref", () => {
  it("uses the channel id lowercased as the room for plain channels", () => {
    const channel = { id: "CHAT-01H455VB4PA9NNRJPZNSAV8HVA", kind: "channel" as const };
    expect(meetChannelCallRoom(channel)).toBe(CHAT_ROOM);
    expect(meetChannelCallHref(channel, ORIGIN)).toBe(
      `${ORIGIN}/meet/channels/01h455vb4pa9nnrjpznsav8hva`,
    );
  });

  it("uses the channel path for meeting-kind channels (same as a channel)", () => {
    const meeting = {
      id: "chat-01h455vb4pa9nnrjpznsav8hvb",
      kind: "meeting" as const,
      guestRoomCode: ROOM,
    };
    expect(meetChannelCallRoom(meeting)).toBe(ROOM);
    expect(meetChannelCallHref(meeting, ORIGIN)).toBe(
      `${ORIGIN}/meet/channels/01h455vb4pa9nnrjpznsav8hvb`,
    );
  });

  it("falls back to the channel id when a meeting has no guestRoomCode", () => {
    const meeting = { id: CHAT_ROOM, kind: "meeting" as const, guestRoomCode: null };
    expect(meetChannelCallRoom(meeting)).toBe(CHAT_ROOM);
    expect(meetChannelCallHref(meeting, ORIGIN)).toBe(
      `${ORIGIN}/meet/channels/01h455vb4pa9nnrjpznsav8hva`,
    );
  });

  it("produces hrefs Join opens as the same stored invite URL", () => {
    const channel = { id: CHAT_ROOM, kind: "channel" as const };
    expect(calendarMeetJoinHref(meetChannelCallHref(channel, ORIGIN), ORIGIN)).toBe(
      `/meet/channels/01h455vb4pa9nnrjpznsav8hva`,
    );
  });
});

describe("calendarMeetJoinHref", () => {
  it("normalizes stored guest, join, and /meet URLs to the unified invite path", () => {
    expect(calendarMeetJoinHref(GUEST, ORIGIN)).toBe(`/meet/meetings/${ROOM}`);
    expect(calendarMeetJoinHref(JOIN, ORIGIN)).toBe(`/meet/meetings/${ROOM}`);
    expect(calendarMeetJoinHref(`${ORIGIN}/meet?room=${ROOM}`, ORIGIN)).toBe(
      `/meet/meetings/${ROOM}`,
    );
    expect(calendarMeetJoinHref(`${ORIGIN}/meet/meetings/${ROOM}`, ORIGIN)).toBe(
      `/meet/meetings/${ROOM}`,
    );
    expect(
      calendarMeetJoinHref(`http://127.0.0.1:5174/meet?room=${ROOM}`, "http://localhost:5174"),
    ).toBe(`/meet/meetings/${ROOM}`);
    expect(calendarMeetJoinHref(CHAT_CHANNEL, ORIGIN)).toBe(
      `/meet/channels/01h455vb4pa9nnrjpznsav8hva`,
    );
    expect(calendarMeetJoinHref(CHAT_GUEST, ORIGIN)).toBe(
      `/meet/channels/01h455vb4pa9nnrjpznsav8hva`,
    );
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
    vi.unstubAllGlobals();
  });

  it("opens WGW Meet in the same tab on the stored invite URL", () => {
    const assign = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.stubGlobal("location", { ...window.location, assign });

    const result = openCalendarMeetHref(GUEST, ORIGIN);

    expect(result).toBe(window);
    expect(assign).toHaveBeenCalledWith(`/meet/meetings/${ROOM}`);
    expect(open).not.toHaveBeenCalled();
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
