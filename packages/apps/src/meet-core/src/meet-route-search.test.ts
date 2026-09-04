import { describe, expect, it } from "vitest";
import {
  buildMeetGuestCallLink,
  meetCallExitMode,
  meetIsJoinRoute,
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

  it("builds guest invite links with room query param", () => {
    expect(buildMeetGuestCallLink("h8y8-ewp6-al8n", "http://localhost:5173")).toBe(
      "http://localhost:5173/meet/guest?room=h8y8-ewp6-al8n",
    );
  });

  it("detects guest and join routes", () => {
    expect(meetIsJoinRoute("/meet/guest")).toBe(true);
    expect(meetIsJoinRoute("/meet/join")).toBe(true);
    expect(meetIsJoinRoute("/meet")).toBe(false);
  });

  it("uses end call for signed-in host on /meet even with synced room param", () => {
    expect(meetCallExitMode(false, true)).toBe("end");
  });

  it("uses leave call on join routes and for guests", () => {
    expect(meetCallExitMode(true, true)).toBe("leave");
    expect(meetCallExitMode(false, false)).toBe("leave");
  });
});
