/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMeetRtc } from "@/meet-core/src/use-meet-rtc";

const captured = vi.hoisted(() => ({
  meshOptions: null as { shouldAcceptOffer?: (from: string) => boolean } | null,
}));

vi.mock("@/lib/rtc/session/create-rtc-session", () => ({
  createRtcSession: vi.fn((options: { shouldAcceptOffer?: (from: string) => boolean }) => {
    captured.meshOptions = options;
    return {
      join: vi.fn(async () => ({ peerId: "self-1", peers: [], sessionKey: null })),
      leave: vi.fn(async () => undefined),
      sendByeToAll: vi.fn(async () => undefined),
      getMyId: () => "self-1",
      getSessionKey: () => null,
      getPeerIds: () => [],
    };
  }),
}));

describe("useMeetRtc offer gate", () => {
  it("hands the Meet offer gate to the peer mesh", async () => {
    const { result } = renderHook(() =>
      useMeetRtc({
        rtcSettings: { stunUrls: "", turnAvailable: false, forceRelay: false },
        getLocalStream: () => null,
        onLinkChange: () => {},
        onPollData: () => {},
        shouldConnectToPeer: () => true,
        shouldHandleRtcSignals: () => true,
        onPeerRemoved: () => {},
        onConnectionFailed: () => {},
        onPollError: () => {},
        onPeerConnected: () => {},
        shouldAcceptOffer: (from) => from === "host-1",
      }),
    );

    await result.current.join({ room: "room-1", peerId: "self-1", name: "Alex" });

    expect(captured.meshOptions?.shouldAcceptOffer?.("host-1")).toBe(true);
    expect(captured.meshOptions?.shouldAcceptOffer?.("knocker-1")).toBe(false);
  });
});
