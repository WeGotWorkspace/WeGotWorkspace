import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import type { HttpSignalingClient } from "@/lib/rtc/signaling/http-client";
import type { RtcSettings } from "@/lib/rtc/types";
import {
  DOCS_COLLAB_MESH_LINGER_MS,
  DocsCollabMeshLingerCache,
  type LingerableMeshSession,
} from "./docs-collab-mesh-linger";

vi.mock("@/lib/rtc/log", () => ({ rtcLog: vi.fn() }));
vi.mock("@/lib/rtc/telemetry/selected-pair", () => ({
  logSelectedPairTelemetry: vi.fn(),
}));

const ROOM = "docs/linger-test.md";

function createFakeSession() {
  return {
    leave: vi.fn(async () => undefined),
    clearMessageListeners: vi.fn(),
  };
}

type PageHideHarness = {
  subscribe: (listener: () => void) => () => void;
  fire: () => void;
  unsubscribeCount: () => number;
};

function createPageHideHarness(): PageHideHarness {
  const listeners = new Set<() => void>();
  let unsubscribes = 0;
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribes += 1;
      };
    },
    fire: () => {
      for (const listener of [...listeners]) listener();
    },
    unsubscribeCount: () => unsubscribes,
  };
}

describe("DocsCollabMeshLingerCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays under the server-side collab peer TTL of 30 s", () => {
    expect(DOCS_COLLAB_MESH_LINGER_MS).toBeLessThan(30_000);
  });

  it("resumes the live session within the grace and cancels the pending leave", () => {
    const cache = new DocsCollabMeshLingerCache(20_000);
    const session = createFakeSession();

    cache.linger(ROOM, session);
    vi.advanceTimersByTime(19_999);
    expect(session.leave).not.toHaveBeenCalled();

    expect(cache.resume(ROOM)).toBe(session);

    vi.advanceTimersByTime(60_000);
    expect(session.leave).not.toHaveBeenCalled();
  });

  it("clears message listeners when a session starts lingering", () => {
    const cache = new DocsCollabMeshLingerCache(20_000);
    const session = createFakeSession();

    cache.linger(ROOM, session);

    expect(session.clearMessageListeners).toHaveBeenCalledTimes(1);
  });

  it("performs the real leave when the grace expires", () => {
    const cache = new DocsCollabMeshLingerCache(20_000);
    const session = createFakeSession();

    cache.linger(ROOM, session);
    vi.advanceTimersByTime(20_000);

    expect(session.leave).toHaveBeenCalledTimes(1);
    expect(cache.resume(ROOM)).toBeNull();
  });

  it("does not resume sessions lingered for a different room", () => {
    const cache = new DocsCollabMeshLingerCache(20_000);
    cache.linger(ROOM, createFakeSession());

    expect(cache.resume("docs/other.md")).toBeNull();
    expect(cache.size()).toBe(1);
  });

  it("replaces an existing lingering session for the same room by leaving the old one", () => {
    const cache = new DocsCollabMeshLingerCache(20_000);
    const first = createFakeSession();
    const second = createFakeSession();

    cache.linger(ROOM, first);
    cache.linger(ROOM, second);

    expect(first.leave).toHaveBeenCalledTimes(1);
    expect(cache.resume(ROOM)).toBe(second);
  });

  it("leaves all lingering sessions immediately on pagehide", () => {
    const pageHide = createPageHideHarness();
    const cache = new DocsCollabMeshLingerCache(20_000, {
      subscribePageHide: pageHide.subscribe,
    });
    const sessionA = createFakeSession();
    const sessionB = createFakeSession();

    cache.linger(ROOM, sessionA);
    cache.linger("docs/other.md", sessionB);
    pageHide.fire();

    expect(sessionA.leave).toHaveBeenCalledTimes(1);
    expect(sessionB.leave).toHaveBeenCalledTimes(1);
    expect(cache.resume(ROOM)).toBeNull();
    expect(cache.size()).toBe(0);

    vi.advanceTimersByTime(60_000);
    expect(sessionA.leave).toHaveBeenCalledTimes(1);
    expect(sessionB.leave).toHaveBeenCalledTimes(1);
  });

  it("subscribes to pagehide only while entries exist", () => {
    const pageHide = createPageHideHarness();
    const cache = new DocsCollabMeshLingerCache(20_000, {
      subscribePageHide: pageHide.subscribe,
    });
    const session = createFakeSession();

    cache.linger(ROOM, session);
    cache.resume(ROOM);

    expect(pageHide.unsubscribeCount()).toBe(1);
  });
});

describe("mesh polling during the linger grace", () => {
  const RTC_SETTINGS: RtcSettings = {
    stunUrls: "",
    turnUrls: "",
    turnUsername: "",
    turnPassword: "",
    forceRelay: false,
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the mesh polling during the grace and stops after the real leave", async () => {
    const signaling = {
      join: vi.fn(async () => ({ peerId: "peer-a", peers: [], sessionKey: null })),
      poll: vi.fn(async () => ({ peers: [], messages: [] })),
      send: vi.fn(async () => ({ ok: true })),
      leave: vi.fn(async () => ({ ok: true })),
    };
    const mesh = new RtcPeerMesh({
      channel: "collab",
      room: ROOM,
      signaling: signaling as unknown as HttpSignalingClient,
      rtcSettings: RTC_SETTINGS,
      pollIntervals: { connectingMs: 400, steadyMs: 1200 },
    });
    await mesh.join({ name: "Alex", peerId: "peer-a" });

    const cache = new DocsCollabMeshLingerCache<LingerableMeshSession>(20_000);
    cache.linger(ROOM, {
      leave: () => mesh.leave(),
      clearMessageListeners: () => undefined,
    });
    const pollsAtLinger = signaling.poll.mock.calls.length;

    await vi.advanceTimersByTimeAsync(15_000);
    expect(signaling.poll.mock.calls.length).toBeGreaterThan(pollsAtLinger);
    expect(signaling.leave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(signaling.leave).toHaveBeenCalledTimes(1);

    const pollsAfterLeave = signaling.poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signaling.poll.mock.calls.length).toBe(pollsAfterLeave);
  });
});
