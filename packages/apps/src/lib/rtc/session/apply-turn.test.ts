import { describe, expect, it, vi } from "vitest";
import { applyTurnOnPeerConnection } from "@/lib/rtc/session/apply-turn";
import type { RtcSettings, TurnCredentials } from "@/lib/rtc/types";

const settings: RtcSettings = {
  stunUrls: "stun:stun.nextcloud.com:443",
  turnAvailable: true,
  forceRelay: false,
};
const turn: TurnCredentials = {
  urls: ["turn:example:3478"],
  username: "user",
  credential: "cred-1",
  ttl: 3600,
};

describe("applyTurnOnPeerConnection", () => {
  it("configures the existing connection and does not construct another", () => {
    const pc = {
      setConfiguration: vi.fn(),
      restartIce: vi.fn(),
    };
    const constructed = vi.fn();
    applyTurnOnPeerConnection(pc as unknown as RTCPeerConnection, settings, turn);
    expect(pc.setConfiguration).toHaveBeenCalledOnce();
    expect(pc.restartIce).toHaveBeenCalledOnce();
    expect(constructed).not.toHaveBeenCalled();
    expect(pc.setConfiguration.mock.calls[0]?.[0]).toMatchObject({
      iceServers: expect.any(Array),
    });
  });
});
