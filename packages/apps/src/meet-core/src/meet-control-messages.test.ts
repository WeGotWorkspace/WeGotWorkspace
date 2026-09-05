import { describe, expect, it } from "vitest";
import {
  buildMeetControlMessage,
  decodeMeetKnockerName,
  encodeMeetKnockerName,
  isMeetKnockRequiredError,
  isMeetRoomNotActiveError,
  MEET_KNOCK_NAME_PREFIX,
  parseMeetControlMessage,
} from "@/meet-core/src/meet-control-messages";

describe("meet control messages", () => {
  it("encodes and decodes knocker roster names", () => {
    expect(encodeMeetKnockerName("Guest")).toBe(`${MEET_KNOCK_NAME_PREFIX}Guest`);
    expect(decodeMeetKnockerName(`${MEET_KNOCK_NAME_PREFIX}Alex`)).toBe("Alex");
    expect(decodeMeetKnockerName("Alex")).toBeNull();
  });

  it("round-trips media control payloads", () => {
    const text = buildMeetControlMessage({
      kind: "media",
      mic: true,
      camera: false,
      screen: true,
    });
    expect(parseMeetControlMessage(text)).toEqual({
      kind: "media",
      mic: true,
      camera: false,
      screen: true,
    });
  });

  it("parses knock, admit, deny, and end controls", () => {
    expect(
      parseMeetControlMessage(
        buildMeetControlMessage({ kind: "knock", peerId: "peer-1", name: "Guest" }),
      ),
    ).toEqual({ kind: "knock", peerId: "peer-1", name: "Guest" });
    expect(
      parseMeetControlMessage(buildMeetControlMessage({ kind: "admit", peerId: "peer-1" })),
    ).toEqual({
      kind: "admit",
      peerId: "peer-1",
    });
    expect(
      parseMeetControlMessage(buildMeetControlMessage({ kind: "deny", peerId: "peer-1" })),
    ).toEqual({
      kind: "deny",
      peerId: "peer-1",
    });
    expect(parseMeetControlMessage(buildMeetControlMessage({ kind: "end", by: "Host" }))).toEqual({
      kind: "end",
      by: "Host",
    });
  });

  it("recognizes the chunk-H join-policy error codes from the signaling client", () => {
    expect(isMeetKnockRequiredError(new Error("knock_required"))).toBe(true);
    expect(isMeetKnockRequiredError(new Error("forbidden"))).toBe(false);
    expect(isMeetKnockRequiredError("knock_required")).toBe(false);
    expect(isMeetRoomNotActiveError(new Error("room_not_active"))).toBe(true);
    expect(isMeetRoomNotActiveError(new Error("not_found"))).toBe(false);
    expect(isMeetRoomNotActiveError(null)).toBe(false);
  });

  it("rejects malformed control payloads", () => {
    expect(parseMeetControlMessage("hello")).toBeNull();
    expect(parseMeetControlMessage("__wgw_meet_control__:{")).toBeNull();
    expect(
      parseMeetControlMessage(buildMeetControlMessage({ kind: "media", mic: true, camera: false })),
    ).not.toBeNull();
  });
});
