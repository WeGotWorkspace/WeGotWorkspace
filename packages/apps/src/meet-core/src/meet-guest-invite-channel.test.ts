import { describe, expect, it } from "vitest";
import { meetGuestInviteChannel } from "@/meet-core/src/meet-guest-invite-channel";
import type { MeetChannel } from "@/meet-core/src/meet-types";

const design: MeetChannel = {
  id: "channel-design",
  name: "Design",
  kind: "channel",
  scope: "personal",
  topic: "Pixels, prototypes and critiques",
};

const standup: MeetChannel = {
  id: "meeting-standup",
  name: "Standup",
  kind: "meeting",
  scope: "personal",
  guestRoomCode: "h8y8-ewp6-al8n",
  topic: "Daily sync",
};

describe("meetGuestInviteChannel", () => {
  it("prefers the channel that owns the invited room code", () => {
    expect(
      meetGuestInviteChannel({
        channels: [design, standup],
        invitedRoom: "h8y8-ewp6-al8n",
        fallbackName: "Meet",
      }),
    ).toEqual({ name: "Standup", kind: "meeting", topic: "Daily sync" });
  });

  it("matches a public channel id or name from the route", () => {
    expect(
      meetGuestInviteChannel({
        channels: [design],
        channelId: "channel-design",
        fallbackName: "Meet",
      }),
    ).toEqual({ name: "Design", kind: "channel", topic: "Pixels, prototypes and critiques" });
    expect(
      meetGuestInviteChannel({
        channels: [design],
        channelId: "Design",
        fallbackName: "Meet",
      }),
    ).toEqual({ name: "Design", kind: "channel", topic: "Pixels, prototypes and critiques" });
  });

  it("falls back to the route id when bootstrap has no matching channel", () => {
    expect(
      meetGuestInviteChannel({
        channels: [],
        meetingId: "test",
        fallbackName: "Meet",
      }),
    ).toEqual({ name: "test", kind: "meeting", topic: null });
    expect(
      meetGuestInviteChannel({
        channelId: "design",
        fallbackName: "Meet",
      }),
    ).toEqual({ name: "design", kind: "channel", topic: null });
  });

  it("uses the product fallback when nothing is known", () => {
    expect(meetGuestInviteChannel({ fallbackName: "Meet" })).toEqual({
      name: "Meet",
      kind: "meeting",
      topic: null,
    });
  });
});
