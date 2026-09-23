import { describe, expect, it } from "vitest";
import {
  meetSignedInMeetingRouteJoin,
  meetSignedInUpcomingJoin,
} from "@/meet-core/src/meet-signed-in-join";

const ORIGIN = "https://workspace.example.com";
const ROOM = "h8y8-ewp6-al8n";

const hostChannels = [
  { id: "chat-standup", kind: "meeting" as const, guestRoomCode: ROOM },
];

describe("meetSignedInMeetingRouteJoin", () => {
  it("joins an ad-hoc code the signed-in user does not already have", () => {
    expect(meetSignedInMeetingRouteJoin(ROOM, [])).toEqual({
      action: "join-room",
      room: ROOM,
    });
  });

  it("starts the call on the channel that already owns the code", () => {
    expect(meetSignedInMeetingRouteJoin(ROOM, hostChannels)).toEqual({
      action: "start-call",
      channelId: "chat-standup",
    });
  });

  it("does not auto-join a meeting collection slug", () => {
    expect(meetSignedInMeetingRouteJoin("standup", hostChannels)).toEqual({
      action: "ignore",
    });
  });
});

describe("meetSignedInUpcomingJoin", () => {
  it("joins the host room code instead of creating another meeting", () => {
    const sameTitle = [
      { id: "chat-other", kind: "meeting" as const, guestRoomCode: "aaaa-bbbb-cccc" },
    ];
    expect(
      meetSignedInUpcomingJoin(`${ORIGIN}/meet/meetings/${ROOM}`, ORIGIN, sameTitle),
    ).toEqual({ action: "join-room", room: ROOM });
  });

  it("starts the call when the room code already maps to a channel", () => {
    expect(
      meetSignedInUpcomingJoin(`${ORIGIN}/meet/meetings/${ROOM}`, ORIGIN, hostChannels),
    ).toEqual({ action: "start-call", channelId: "chat-standup" });
  });

  it("only selects a channel path", () => {
    expect(
      meetSignedInUpcomingJoin(`${ORIGIN}/meet/channels/general`, ORIGIN, [
        { id: "chat-general", kind: "channel", guestRoomCode: null },
      ]),
    ).toEqual({ action: "select-channel", channelId: "chat-general" });
  });

  it("ignores an external meeting link", () => {
    expect(meetSignedInUpcomingJoin("https://zoom.us/j/123", ORIGIN, [])).toEqual({
      action: "ignore",
    });
  });
});
