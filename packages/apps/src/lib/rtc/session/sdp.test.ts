import { describe, expect, it } from "vitest";
import { sdpSessionId } from "@/lib/rtc/session/sdp";

describe("sdpSessionId", () => {
  it("returns the session id from a valid SDP", () => {
    expect(sdpSessionId("v=0\r\no=- 111 2 IN IP4 0.0.0.0\r\n")).toBe("111");
  });

  it("returns null when the o= line is missing", () => {
    expect(sdpSessionId("v=0\r\ns=-\r\n")).toBeNull();
  });

  it("returns null for null or undefined", () => {
    expect(sdpSessionId(null)).toBeNull();
    expect(sdpSessionId(undefined)).toBeNull();
  });
});
