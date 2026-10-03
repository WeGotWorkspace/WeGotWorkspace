import { describe, expect, it } from "vitest";
import { parseUrlList, toRtcConfig } from "@/lib/rtc/config";
import type { RtcSettings, TurnCredentials } from "@/lib/rtc/types";

const baseSettings: RtcSettings = {
  stunUrls: "stun:stun.example.com:3478",
  turnAvailable: true,
  forceRelay: false,
};

const turn: TurnCredentials = {
  urls: ["turn:turn.example.com:3478?transport=udp"],
  username: "1700000600:0123456789abcdef",
  credential: "turn-credential-fixture",
  ttl: 600,
};

describe("parseUrlList", () => {
  it("normalizes bare hostnames and splits csv/newlines", () => {
    expect(parseUrlList("host1, host2\nhost3", "stun")).toEqual([
      "stun:host1",
      "stun:host2",
      "stun:host3",
    ]);
  });

  it("preserves explicit schemes including ipv6", () => {
    expect(parseUrlList("stun:[2001:db8::1]:3478", "stun")).toEqual(["stun:[2001:db8::1]:3478"]);
  });
});

describe("toRtcConfig", () => {
  it("uses all transport with stun and turn when not forcing relay", () => {
    const config = toRtcConfig(baseSettings, "direct", { turn });
    expect(config.iceTransportPolicy).toBe("all");
    expect(config.iceCandidatePoolSize).toBe(4);
    expect(config.iceServers).toHaveLength(2);
  });

  it("forces relay-only ice servers when mode is relay", () => {
    const config = toRtcConfig(baseSettings, "relay", { turn });
    expect(config.iceTransportPolicy).toBe("relay");
    expect(config.iceCandidatePoolSize).toBe(0);
    expect(config.iceServers).toHaveLength(1);
    expect(config.iceServers?.[0]?.urls).toContain("turn:turn.example.com:3478?transport=udp");
  });

  it("carries the minted credentials onto the turn server", () => {
    const config = toRtcConfig(baseSettings, "relay", { turn });
    expect(config.iceServers?.[0]?.username).toBe(turn.username);
    expect(config.iceServers?.[0]?.credential).toBe(turn.credential);
  });

  it("offers stun only until a relay request hands over credentials", () => {
    const config = toRtcConfig(baseSettings, "direct");
    expect(config.iceServers).toHaveLength(1);
    expect(config.iceServers?.[0]?.urls).toEqual(["stun:stun.example.com:3478"]);
  });

  it("ignores forceRelay without credentials, so direct paths keep working", () => {
    const config = toRtcConfig({ ...baseSettings, forceRelay: true }, "direct");
    expect(config.iceTransportPolicy).toBe("all");
    expect(config.iceServers).toHaveLength(1);
  });

  it("allows collab pool size override", () => {
    const config = toRtcConfig(baseSettings, "direct", { iceCandidatePoolSize: 2 });
    expect(config.iceCandidatePoolSize).toBe(2);
  });
});
