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
    const reasons: string[] = [];
    const postRelay = vi
      .fn()
      .mockResolvedValueOnce({ turn: turn(180, "cred-1") })
      .mockResolvedValueOnce({ turn: turn(180, "cred-2") });
    const pc = {
      setConfiguration: vi.fn(),
      restartIce: vi.fn(),
      getStats: async () => {
        const stats = new Map();
        stats.set("pair", { type: "candidate-pair", selected: true, localCandidateId: "local" });
        stats.set("local", { type: "local-candidate", candidateType: "relay" });
        return stats;
      },
    };
    const relay = new MeshRelay({
      enabled: true,
      forceRelay: false,
      roomId: "room-1",
      settings,
      localPeerId: () => "self",
      localNet: () => "symmetric",
      peerName: () => "Ada",
      postRelay: async (_room, body) => {
        reasons.push(body.reason);
        return postRelay();
      },
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
    expect(reasons).toEqual(["failed", "refresh"]);
  });

  it("clears the requested mark and re-mints on ICE restart", async () => {
    const postRelay = vi
      .fn()
      .mockResolvedValueOnce({ turn: turn(600, "cred-1") })
      .mockResolvedValueOnce({ turn: turn(600, "cred-2") });
    const pc = {
      setConfiguration: vi.fn(),
      restartIce: vi.fn(),
      getStats: async () => {
        const stats = new Map();
        stats.set("pair", { type: "candidate-pair", selected: true, localCandidateId: "local" });
        stats.set("local", { type: "local-candidate", candidateType: "relay" });
        return stats;
      },
    };
    const relay = new MeshRelay({
      enabled: true,
      forceRelay: false,
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

  it("does not re-mint a pair that is no longer on a relay", async () => {
    let now = 1_000_000;
    const scheduled: Array<{ fn: () => void }> = [];
    const postRelay = vi.fn().mockResolvedValue({ turn: turn(180, "cred-1") });
    const pc = {
      setConfiguration: vi.fn(),
      restartIce: vi.fn(),
      getStats: async () => {
        const stats = new Map();
        stats.set("pair", { type: "candidate-pair", selected: true, localCandidateId: "local" });
        stats.set("local", { type: "local-candidate", candidateType: "host" });
        return stats;
      },
    };
    const relay = new MeshRelay({
      enabled: true,
      forceRelay: false,
      roomId: "room-1",
      settings,
      localPeerId: () => "self",
      localNet: () => "open",
      peerName: () => "Ada",
      postRelay: async () => postRelay(),
      getPeerConnection: () => pc as unknown as RTCPeerConnection,
      onOutcome: () => undefined,
      log: () => undefined,
      now: () => now,
      schedule: (fn) => {
        scheduled.push({ fn });
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => undefined,
    });

    await relay.request("peer-a", "failed");
    now += 120_000;
    scheduled[0]?.fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(postRelay).toHaveBeenCalledTimes(1);
  });

  it("mints TURN on an open path when force relay is set, and retries a denial", async () => {
    const reasons: string[] = [];
    const postRelay = vi
      .fn()
      .mockRejectedValueOnce(new Error("relay_denied"))
      .mockResolvedValueOnce({ turn: turn(120, "cred-1") });
    const relay = new MeshRelay({
      enabled: true,
      forceRelay: true,
      roomId: "room-1",
      settings: { ...settings, forceRelay: true },
      localPeerId: () => "self",
      localNet: () => "open",
      peerName: () => "Ada",
      postRelay: async (_room, body) => {
        reasons.push(body.reason);
        return postRelay();
      },
      getPeerConnection: () => null,
      onOutcome: () => undefined,
      log: () => undefined,
      schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
      cancel: () => undefined,
    });

    await relay.beforeDial();
    expect(relay.credentials()).toBeNull();
    await relay.beforeDial();
    expect(reasons).toEqual(["precheck", "precheck"]);
    expect(relay.credentials()?.credential).toBe("cred-1");
    await relay.beforeDial();
    expect(postRelay).toHaveBeenCalledTimes(2);
  });

  it("refreshes a live relay pair that was minted by a force-relay precheck", async () => {
    let now = 1_000_000;
    const scheduled: Array<{ fn: () => void; delay: number }> = [];
    const reasons: string[] = [];
    const postRelay = vi
      .fn()
      .mockResolvedValueOnce({ turn: turn(120, "cred-1") })
      .mockResolvedValueOnce({ turn: turn(120, "cred-2") });
    const pc = {
      setConfiguration: vi.fn(),
      restartIce: vi.fn(),
      getStats: async () => {
        const stats = new Map();
        stats.set("transport", {
          type: "transport",
          selectedCandidatePairId: "pair",
        });
        stats.set("pair", { type: "candidate-pair", localCandidateId: "local" });
        stats.set("local", { type: "local-candidate", candidateType: "relay" });
        return stats;
      },
    };
    const relay = new MeshRelay({
      enabled: true,
      forceRelay: true,
      roomId: "room-1",
      settings: { ...settings, forceRelay: true },
      localPeerId: () => "self",
      localNet: () => "open",
      peerName: () => "Ada",
      peerIds: () => ["peer-a"],
      postRelay: async (_room, body) => {
        reasons.push(`${body.reason}:${body.target}`);
        return postRelay();
      },
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

    await relay.beforeDial();
    expect(reasons).toEqual(["precheck:*"]);
    expect(pc.setConfiguration).not.toHaveBeenCalled();
    now += 60_000;
    scheduled[0]?.fn();
    await vi.waitFor(() => expect(reasons).toEqual(["precheck:*", "refresh:peer-a"]));
    expect(pc.setConfiguration).toHaveBeenCalledTimes(1);
    expect(relay.credentials()?.credential).toBe("cred-2");
  });

  it("posts one precheck when forceRelay is true on an open path", async () => {
    const bodies: Array<{ reason: string; target: string; net?: string }> = [];
    const relay = new MeshRelay({
      enabled: true,
      forceRelay: true,
      roomId: "room-1",
      settings,
      localPeerId: () => "self",
      localNet: () => "open",
      peerName: () => "Ada",
      postRelay: async (_room, body) => {
        bodies.push(body);
        return { turn: turn(3600, "cred-1") };
      },
      getPeerConnection: () => null,
      onOutcome: () => undefined,
      log: () => undefined,
    });

    await relay.beforeDial();
    expect(bodies).toEqual([
      expect.objectContaining({ reason: "precheck", target: "*", net: "open" }),
    ]);
  });

  it("does not precheck an open path without force relay", async () => {
    const postRelay = vi.fn();
    const relay = new MeshRelay({
      enabled: true,
      forceRelay: false,
      roomId: "room-1",
      settings,
      localPeerId: () => "self",
      localNet: () => "open",
      peerName: () => "Ada",
      postRelay: async () => postRelay(),
      getPeerConnection: () => null,
      onOutcome: () => undefined,
      log: () => undefined,
    });
    await relay.beforeDial();
    expect(postRelay).not.toHaveBeenCalled();
  });

  it("dispose clears the refresh timer", async () => {
    const cancel = vi.fn();
    const pc = { setConfiguration: vi.fn(), restartIce: vi.fn() };
    const relay = new MeshRelay({
      enabled: true,
      forceRelay: false,
      roomId: "room-1",
      settings,
      localPeerId: () => "self",
      localNet: () => "open",
      peerName: () => "Ada",
      postRelay: async () => ({ turn: turn(180, "cred-1") }),
      getPeerConnection: () => pc as unknown as RTCPeerConnection,
      onOutcome: () => undefined,
      log: () => undefined,
      schedule: () => 7 as unknown as ReturnType<typeof setTimeout>,
      cancel,
    });

    await relay.request("peer-a", "failed");
    relay.dispose();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
