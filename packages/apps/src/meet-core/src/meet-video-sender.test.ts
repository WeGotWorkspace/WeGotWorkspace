import { describe, expect, it } from "vitest";
import {
  effectiveSendProfile,
  remoteVideoSuppressed,
  type VideoLimits,
} from "@/meet-core/src/meet-video-sender";

const limits: VideoLimits = { maxVideoProfile: "p720", maxVideoProfileRelay: "p360" };

describe("effectiveSendProfile", () => {
  it("never exceeds the admin, relay, or low-data cap", () => {
    expect(effectiveSendProfile({ remotePeers: 1, limits, relayed: false, lowData: false })).toBe(
      "p720",
    );
    expect(effectiveSendProfile({ remotePeers: 3, limits, relayed: false, lowData: false })).toBe(
      "p360",
    );
    expect(effectiveSendProfile({ remotePeers: 1, limits, relayed: true, lowData: false })).toBe(
      "p360",
    );
    expect(
      effectiveSendProfile({
        remotePeers: 1,
        limits: { maxVideoProfile: "p270", maxVideoProfileRelay: "p180" },
        relayed: false,
        lowData: false,
      }),
    ).toBe("p270");
    expect(effectiveSendProfile({ remotePeers: 1, limits, relayed: false, lowData: true })).toBe(
      "p180",
    );
  });

  it("restores the direct profile when the pair leaves the relay", () => {
    const relayed = effectiveSendProfile({ remotePeers: 1, limits, relayed: true, lowData: false });
    const direct = effectiveSendProfile({ remotePeers: 1, limits, relayed: false, lowData: false });
    expect(relayed).toBe("p360");
    expect(direct).toBe("p720");
  });
});

describe("remoteVideoSuppressed", () => {
  it("keeps video for the first two peers and avatars the rest", () => {
    const ids = ["c", "a", "b"];
    expect(remoteVideoSuppressed("a", ids, true)).toBe(false);
    expect(remoteVideoSuppressed("b", ids, true)).toBe(false);
    expect(remoteVideoSuppressed("c", ids, true)).toBe(true);
    expect(remoteVideoSuppressed("c", ids, false)).toBe(false);
  });
});
