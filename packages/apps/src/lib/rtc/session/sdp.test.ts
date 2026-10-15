import { describe, expect, it, vi } from "vitest";
import {
  normalizeSdpTerminator,
  safeSetRemoteDescription,
  toSessionDescriptionPayload,
} from "@/lib/rtc/session/sdp";

describe("normalizeSdpTerminator", () => {
  it("adds a trailing CRLF and rewrites bare LF", () => {
    expect(normalizeSdpTerminator("v=0\no=-")).toBe("v=0\r\no=-\r\n");
    expect(normalizeSdpTerminator("v=0\r\n")).toBe("v=0\r\n");
  });
});

describe("toSessionDescriptionPayload", () => {
  it("normalizes an offer that arrived without a trailing CRLF", () => {
    const raw = "v=0\r\no=-\r\n";
    const stripped = raw.slice(0, -2);
    expect(stripped.endsWith("\r\n")).toBe(false);
    const payload = toSessionDescriptionPayload({ type: "offer", sdp: stripped }, "offer");
    expect(payload).toEqual({ type: "offer", sdp: raw });
  });
});

describe("safeSetRemoteDescription", () => {
  it("sets the description once and does not retry a rejected offer", async () => {
    const setRemoteDescription = vi.fn(async () => {
      throw new Error("invalid sdp line");
    });
    const pc = { setRemoteDescription } as unknown as RTCPeerConnection;
    const desc = { type: "offer" as const, sdp: "v=0\r\n" };
    await expect(safeSetRemoteDescription(pc, desc)).rejects.toThrow(/invalid sdp line/);
    expect(setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(setRemoteDescription).toHaveBeenCalledWith(desc);
  });
});
