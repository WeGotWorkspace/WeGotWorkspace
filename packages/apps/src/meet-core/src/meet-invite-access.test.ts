import { describe, expect, it, vi } from "vitest";
import {
  meetInviteAccessFromProbe,
  meetInviteChannelIdForRoom,
  meetInviteLocksDisplayName,
  meetInviteShowsWorkspace,
  resolveMeetInviteDestination,
  type MeetInviteAccessIo,
} from "@/meet-core/src/meet-invite-access";

const CHANNELS = [
  { id: "chat-general", kind: "channel", guestRoomCode: null },
  { id: "chat-standup", kind: "meeting", guestRoomCode: "h8y8-ewp6-al8n" },
];

function io(overrides: Partial<MeetInviteAccessIo> = {}): MeetInviteAccessIo {
  return {
    hasSession: async () => false,
    getChannel: async () => null,
    listChannels: async () => CHANNELS,
    ...overrides,
  };
}

describe("meetInviteAccessFromProbe", () => {
  it("sends channel members to the workspace", () => {
    expect(meetInviteAccessFromProbe({ signedIn: true, isChannelMember: true })).toBe("member");
    expect(meetInviteShowsWorkspace("member")).toBe(true);
    expect(meetInviteLocksDisplayName("member")).toBe(false);
  });

  it("keeps signed-in visitors in the workspace even when they are not a channel member", () => {
    expect(meetInviteAccessFromProbe({ signedIn: true, isChannelMember: false })).toBe("member");
    expect(meetInviteShowsWorkspace("member")).toBe(true);
    expect(meetInviteLocksDisplayName("signed-in-guest")).toBe(true);
    expect(meetInviteShowsWorkspace("signed-in-guest")).toBe(false);
  });

  it("keeps anonymous visitors on the lobby with an editable name", () => {
    expect(meetInviteAccessFromProbe({ signedIn: false, isChannelMember: false })).toBe(
      "anonymous",
    );
    expect(meetInviteLocksDisplayName("anonymous")).toBe(false);
  });
});

describe("meetInviteChannelIdForRoom", () => {
  it("matches a chat- channel id, a public segment, and a meeting guest room code", () => {
    expect(meetInviteChannelIdForRoom(CHANNELS, "chat-general")).toBe("chat-general");
    expect(meetInviteChannelIdForRoom(CHANNELS, "general")).toBe("chat-general");
    expect(meetInviteChannelIdForRoom(CHANNELS, "H8Y8-EWP6-AL8N")).toBe("chat-standup");
    expect(meetInviteChannelIdForRoom(CHANNELS, "aaaa-bbbb-cccc")).toBeNull();
  });
});

describe("resolveMeetInviteDestination", () => {
  it("returns anonymous without probing ACL when there is no session", async () => {
    const getChannel = vi.fn(async () => CHANNELS[0]!);
    const result = await resolveMeetInviteDestination({ room: "chat-general" }, io({ getChannel }));
    expect(result).toEqual({ access: "anonymous", channelId: null });
    expect(getChannel).not.toHaveBeenCalled();
  });

  it("treats a signed-in ACL hit on /meet/channels/:id as a member", async () => {
    const result = await resolveMeetInviteDestination(
      { room: null, channelId: "general" },
      io({
        hasSession: async () => true,
        getChannel: async (id) => CHANNELS.find((row) => row.id === id) ?? null,
      }),
    );
    expect(result).toEqual({ access: "member", channelId: "chat-general" });
  });

  it("keeps a signed-in visitor in the workspace on /meet/channels/:id even after ACL miss", async () => {
    const getChannel = vi.fn(async () => null);
    const result = await resolveMeetInviteDestination(
      { room: null, channelId: "test" },
      io({
        hasSession: async () => true,
        getChannel,
      }),
    );
    expect(result).toEqual({ access: "member", channelId: "chat-test" });
    expect(getChannel).not.toHaveBeenCalled();
  });

  it("maps a public channel segment onto the collection id without a guest landing", async () => {
    const getChannel = vi.fn(async (id: string) => CHANNELS.find((row) => row.id === id) ?? null);
    const result = await resolveMeetInviteDestination(
      { room: null, channelId: "secret" },
      io({
        hasSession: async () => true,
        getChannel,
      }),
    );
    expect(result).toEqual({ access: "member", channelId: "chat-secret" });
    expect(getChannel).not.toHaveBeenCalled();
  });

  it("redirects a signed-in member from a guest room code onto the channel id", async () => {
    const result = await resolveMeetInviteDestination(
      { room: "h8y8-ewp6-al8n" },
      io({ hasSession: async () => true }),
    );
    expect(result).toEqual({ access: "member", channelId: "chat-standup", kind: "meeting" });
  });

  it("keeps a signed-in visitor in the Meet workspace for an ad-hoc meeting room", async () => {
    const result = await resolveMeetInviteDestination(
      { room: "aaaa-bbbb-cccc" },
      io({ hasSession: async () => true }),
    );
    expect(result).toEqual({ access: "member", channelId: null });
  });

  it("falls through to anonymous when session probe throws", async () => {
    const result = await resolveMeetInviteDestination(
      { room: "chat-general", channelId: "chat-general" },
      io({
        hasSession: async () => {
          throw new Error("network");
        },
      }),
    );
    expect(result.access).toBe("anonymous");
  });
});
