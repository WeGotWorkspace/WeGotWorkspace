import { describe, expect, it, vi } from "vitest";
import { MeshRelay } from "@/lib/rtc/session/mesh-relay";
import type { RtcSettings, TurnCredentials } from "@/lib/rtc/types";

const settings: RtcSettings = {
  stunUrls: "",
  turnAvailable: true,
  forceRelay: false,
};

function turn(ttl: number, credential: string): TurnCredentials {
  return { urls: ["turn:turn.example:3478"], username: "user", credential, ttl };
}

describe("MeshRelay credential lifetime", () => {
  it("re-mints from the server ttl, 60 seconds before it expires", async () => {
    let now = 1_000_000;
    const scheduled: Array<{ fn: () => void; delay: number }> = [];
    const postRelay = vi
      .fn()
      .mockResolvedValueOnce({ turn: turn(180, "cred-1") })
      .mockResolvedValueOnce({ turn: turn(180, "cred-2") });
    const pc = { setConfiguration: vi.fn(), restartIce: vi.fn() };
    const relay = new MeshRelay({
      enabled: true,
      roomId: "room-1",
      settings,
      localPeerId: () => "self",
      localNet: () => "symmetric",
      peerName: () => "Ada",
      postRelay: async () => postRelay(),
      getPeerConnection: () => pc as unknown as RTCPeerConnection,
      onOutcome: () => undefined,
      log: () => undefined,
      now: () => now,
      schedule: (fn, delay) => {
        scheduled.push({ fn, delay });
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => undefined,
    });

    await relay.request("peer-a", "failed");
    expect(postRelay).toHaveBeenCalledTimes(1);
    expect(scheduled).toEqual([{ fn: expect.any(Function), delay: 120_000 }]);
    expect(relay.credentials()?.credential).toBe("cred-1");

    await relay.request("peer-a", "failed");
    expect(postRelay).toHaveBeenCalledTimes(1);

    now += 120_000;
    scheduled[0]?.fn();
    await vi.waitFor(() => expect(relay.credentials()?.credential).toBe("cred-2"));
    expect(pc.setConfiguration).toHaveBeenCalledTimes(2);
    expect(pc.restartIce).toHaveBeenCalledTimes(2);
  });

  it("clears the requested mark and re-mints on ICE restart", async () => {
    const postRelay = vi
      .fn()
      .mockResolvedValueOnce({ turn: turn(600, "cred-1") })
      .mockResolvedValueOnce({ turn: turn(600, "cred-2") });
    const pc = { setConfiguration: vi.fn(), restartIce: vi.fn() };
    const relay = new MeshRelay({
      enabled: true,
      roomId: "room-1",
      settings,
      localPeerId: () => "self",
      localNet: () => "open",
      peerName: () => "Ada",
      postRelay: async () => postRelay(),
      getPeerConnection: () => pc as unknown as RTCPeerConnection,
      onOutcome: () => undefined,
      log: () => undefined,
      schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
      cancel: () => undefined,
    });

    await relay.request("peer-a", "failed");
    expect(relay.hasRequested("peer-a")).toBe(true);
    await relay.onIceRestart("peer-a");
    expect(postRelay).toHaveBeenCalledTimes(2);
    expect(relay.credentials()?.credential).toBe("cred-2");
    expect(pc.setConfiguration).toHaveBeenCalledTimes(2);
  });
});
