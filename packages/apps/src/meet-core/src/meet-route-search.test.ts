import { describe, expect, it } from "vitest";
import {
  buildMeetChannelInviteLink,
  buildMeetGuestCallLink,
  buildMeetInviteCallLink,
  meetCallExitMode,
  meetChannelIdFromPathname,
  meetInvitedRoomFromRoute,
  meetIsJoinRoute,
  meetPathOwnsInviteRoom,
  meetRoomFromSearch,
  meetSearchFromRoom,
  parseMeetRouteSearch,
} from "@/meet-core/src/meet-route-search";

describe("meet route search", () => {
  it("keeps rtcDebug so TanStack does not strip the handshake logger flag", () => {
    expect(parseMeetRouteSearch({ room: "h8y8-ewp6-al8n", rtcDebug: 1 })).toEqual({
      room: "h8y8-ewp6-al8n",
      rtcDebug: 1,
    });
  });

  it("reads room from router search params", () => {
    expect(meetRoomFromSearch(parseMeetRouteSearch({ room: "h8y8-ewp6-al8n" }))).toBe(
      "h8y8-ewp6-al8n",
    );
  });

  it("ignores non-string or blank room values", () => {
    expect(meetRoomFromSearch(parseMeetRouteSearch({ room: 42 }))).toBeNull();
    expect(meetRoomFromSearch(parseMeetRouteSearch({ room: "  " }))).toBeNull();
    expect(meetRoomFromSearch(parseMeetRouteSearch({}))).toBeNull();
  });

  it("serializes active room codes for search params", () => {
    expect(meetSearchFromRoom("h8y8-ewp6-al8n")).toEqual({ room: "h8y8-ewp6-al8n" });
    expect(meetSearchFromRoom(null)).toEqual({});
    expect(meetSearchFromRoom("")).toEqual({});
  });

  it("builds ad-hoc invite links as /meet/meetings/{id}", () => {
    expect(buildMeetGuestCallLink("h8y8-ewp6-al8n", "http://localhost:5173")).toBe(
      "http://localhost:5173/meet/meetings/h8y8-ewp6-al8n",
    );
  });

  it("builds a channel invite URL without a chat- prefix and /meet/meetings/{id} for ad-hoc", () => {
    expect(
      buildMeetInviteCallLink("chat-01h455vb4pa9nnrjpznsav8hva", "http://localhost:5173"),
    ).toBe("http://localhost:5173/meet/channels/01h455vb4pa9nnrjpznsav8hva");
    expect(buildMeetInviteCallLink("h8y8-ewp6-al8n", "http://localhost:5173")).toBe(
      "http://localhost:5173/meet/meetings/h8y8-ewp6-al8n",
    );
    expect(buildMeetChannelInviteLink("chat-general", "https://workspace.example.com")).toBe(
      "https://workspace.example.com/meet/channels/general",
    );
  });

  it("reads a channel id from the invite pathname", () => {
    expect(meetChannelIdFromPathname("/meet/channels/general")).toBe("general");
    expect(meetChannelIdFromPathname("/meet/guest")).toBeNull();
    expect(meetChannelIdFromPathname("/meet")).toBeNull();
  });

  it("detects invite landings including /meet/meetings/{id}", () => {
    expect(meetIsJoinRoute("/meet/guest")).toBe(true);
    expect(meetIsJoinRoute("/meet/join")).toBe(true);
    expect(meetIsJoinRoute("/meet/channels/general")).toBe(false);
    expect(meetIsJoinRoute("/meet/meetings/h8y8-ewp6-al8n")).toBe(true);
    expect(meetIsJoinRoute("/meet/meetings/test")).toBe(true);
    expect(meetIsJoinRoute("/meet/meetings/test-meet")).toBe(true);
    expect(meetIsJoinRoute("/meet", "h8y8-ewp6-al8n")).toBe(true);
    expect(meetIsJoinRoute("/meet")).toBe(false);
    expect(meetIsJoinRoute("/meet/dms/alice")).toBe(false);
  });

  it("resolves meeting slugs and leftover codes onto the same invite room lookup", () => {
    expect(meetInvitedRoomFromRoute({ pathname: "/meet/meetings/test" })).toBe("chat-test");
    expect(meetInvitedRoomFromRoute({ pathname: "/meet/meetings/h8y8-ewp6-al8n" })).toBe(
      "h8y8-ewp6-al8n",
    );
    expect(meetInvitedRoomFromRoute({ pathname: "/meet/channels/general" })).toBe("chat-general");
  });

  it("ignores leaked ?room= when the path already owns the invite id", () => {
    expect(meetPathOwnsInviteRoom("/meet/meetings/test")).toBe(true);
    expect(meetPathOwnsInviteRoom("/meet/channels/general")).toBe(true);
    expect(meetPathOwnsInviteRoom("/meet")).toBe(false);
    expect(
      meetInvitedRoomFromRoute({
        pathname: "/meet/meetings/test",
        search: { room: "chat-test" },
      }),
    ).toBe("chat-test");
  });

  it("uses end call for signed-in host on /meet even with synced room param", () => {
    expect(meetCallExitMode(false, true)).toBe("end");
  });

  it("uses leave call on join routes and for guests", () => {
    expect(meetCallExitMode(true, true)).toBe("leave");
    expect(meetCallExitMode(false, false)).toBe("leave");
  });
});
