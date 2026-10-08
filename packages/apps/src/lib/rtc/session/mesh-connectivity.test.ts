import { describe, expect, it } from "vitest";
import { meshRelayEnabled } from "@/lib/rtc/session/mesh-connectivity";

describe("meshRelayEnabled", () => {
  it.each([
    { channel: "meet", forceRelay: false, hasPostRelay: true, expected: true },
    { channel: "principal", forceRelay: false, hasPostRelay: true, expected: true },
    { channel: "collab", forceRelay: false, hasPostRelay: true, expected: false },
    { channel: "collab", forceRelay: true, hasPostRelay: true, expected: true },
    { channel: "meet", forceRelay: false, hasPostRelay: false, expected: false },
  ])(
    "$channel force=$forceRelay postRelay=$hasPostRelay → $expected",
    ({ channel, forceRelay, hasPostRelay, expected }) => {
      expect(meshRelayEnabled(channel, forceRelay, hasPostRelay)).toBe(expected);
    },
  );
});
