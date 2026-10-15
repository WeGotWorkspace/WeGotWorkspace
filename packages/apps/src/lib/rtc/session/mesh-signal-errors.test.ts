import { describe, expect, it } from "vitest";
import { isInvalidPeerError, isUnknownPeerError } from "@/lib/rtc/session/mesh-signal-errors";

describe("mesh signal errors", () => {
  it("matches an Error whose message names the signaling code", () => {
    expect(isUnknownPeerError(new Error("join failed: unknown_peer"))).toBe(true);
    expect(isInvalidPeerError(new Error("send failed: invalid_peer"))).toBe(true);
  });

  it("rejects a different message", () => {
    expect(isUnknownPeerError(new Error("invalid_peer"))).toBe(false);
    expect(isInvalidPeerError(new Error("unknown_peer"))).toBe(false);
  });

  it("rejects values that are not Error instances", () => {
    for (const value of ["unknown_peer", null, { message: "unknown_peer" }]) {
      expect(isUnknownPeerError(value)).toBe(false);
      expect(isInvalidPeerError(value)).toBe(false);
    }
  });
});
