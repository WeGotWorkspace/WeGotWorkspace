import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import { PrincipalLinkRegistry } from "@/lib/rtc/session/principal-link-registry";
import { PresenceRtcSession } from "@/presence-core/src/presence-rtc-session";
import type { PresenceMeshEvent } from "@/presence-core/src/presence-types";

type CapturedBinding = {
  onOpen: (remoteId: string) => void;
  onMessage: (remoteId: string, data: string) => void;
  onClose: () => void;
};

const captured = vi.hoisted(() => ({
  bindingOptions: null as CapturedBinding | null,
  pollIntervals: null as { steadyMs: number } | null,
  onPollData: null as
    | ((data: {
        messages: Array<{ from: string; type: string; payload: unknown }>;
        peers: unknown[];
      }) => void)
    | null,
  mesh: {
    getMyId: vi.fn((): string | null => "me"),
    getRoomPeers: vi.fn(() => [] as Array<{ id: string; name: string; user?: string }>),
    getDataChannel: vi.fn((_id: string) => null as { readyState: string } | null),
    getPeerConnection: vi.fn(() => null as { connectionState: string } | null),
    isInitiatorFor: vi.fn((peerId: string) => "me" < peerId),
    abortPeerConnection: vi.fn(),
    retryPeerConnection: vi.fn(),
    sendMailbox: vi.fn(async () => undefined),
    sendJsonTo: vi.fn(),
    broadcastJson: vi.fn(),
    join: vi.fn(async () => ({ peerId: "me" })),
    leave: vi.fn(async () => undefined),
  },
  rtcLog: vi.fn(),
}));

vi.mock("@/lib/rtc/log", () => ({
  rtcLog: (...args: unknown[]) => captured.rtcLog(...args),
}));

vi.mock("@/lib/rtc/session/bindings", () => ({
  createDataBinding: vi.fn((options: CapturedBinding) => {
    captured.bindingOptions = options;
    return { kind: "data" };
  }),
}));

vi.mock("@/lib/rtc/session/create-rtc-session", () => ({
  createRtcSession: vi.fn(
    (options: {
      pollIntervals: { steadyMs: number };
      onPollData?: (data: {
        messages: Array<{ from: string; type: string; payload: unknown }>;
        peers: unknown[];
      }) => void;
    }) => {
      captured.pollIntervals = options.pollIntervals;
      captured.onPollData = options.onPollData ?? null;
      return captured.mesh;
    },
  ),
}));

describe("PresenceRtcSession principal link publishing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.bindingOptions = null;
    captured.pollIntervals = null;
    captured.onPollData = null;
    captured.mesh.getRoomPeers.mockReturnValue([]);
    captured.mesh.getDataChannel.mockReturnValue(null);
    captured.mesh.getPeerConnection.mockReturnValue(null);
    captured.mesh.isInitiatorFor.mockImplementation((peerId: string) => "me" < peerId);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers an open principal DC in the link registry", () => {
    const registry = new PrincipalLinkRegistry();
    new PresenceRtcSession({
      room: "workspace",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      linkRegistry: registry,
    });
    captured.mesh.getRoomPeers.mockReturnValue([
      { id: "prin-wouter", name: "Wouter", user: "wouter" },
    ]);
    captured.mesh.getDataChannel.mockReturnValue({ readyState: "open" });

    captured.bindingOptions?.onOpen("prin-wouter");

    expect(registry.hasOpenLink("wouter")).toBe(true);
    registry.sendToUsername("wouter", { hello: 1 });
    expect(captured.mesh.sendJsonTo).toHaveBeenCalledWith("prin-wouter", { hello: 1 });
  });

  it("routes collab-reuse envelopes to the registry and keeps presence chat local", () => {
    const registry = new PrincipalLinkRegistry();
    const session = new PresenceRtcSession({
      room: "workspace",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      linkRegistry: registry,
    });
    captured.mesh.getRoomPeers.mockReturnValue([
      { id: "prin-wouter", name: "Wouter", user: "wouter" },
    ]);
    const reuseEvents: string[] = [];
    registry.subscribe((username, peerId, envelope) => {
      reuseEvents.push(`${username}:${peerId}:${envelope.op}`);
    });
    const presenceEvents: PresenceMeshEvent[] = [];
    session.onEvent((event) => presenceEvents.push(event));

    captured.bindingOptions?.onMessage(
      "prin-wouter",
      JSON.stringify({
        v: 1,
        kind: "collab-reuse",
        room: "/doc.md",
        op: "open",
        collabPeerId: "bbbbbbbbbbbbbbbb",
      }),
    );
    captured.bindingOptions?.onMessage("prin-wouter", JSON.stringify({ v: 1, kind: "typing" }));

    expect(reuseEvents).toEqual(["wouter:prin-wouter:open"]);
    expect(presenceEvents).toEqual([
      { type: "envelope", peerId: "prin-wouter", envelope: { v: 1, kind: "typing" } },
    ]);
  });

  it("drops registry links on leave", async () => {
    const registry = new PrincipalLinkRegistry();
    const session = new PresenceRtcSession({
      room: "workspace",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      linkRegistry: registry,
    });
    captured.mesh.getRoomPeers.mockReturnValue([
      { id: "prin-wouter", name: "Wouter", user: "wouter" },
    ]);
    captured.mesh.getDataChannel.mockReturnValue({ readyState: "open" });
    captured.bindingOptions?.onOpen("prin-wouter");
    expect(registry.hasOpenLink("wouter")).toBe(true);

    await session.leave();
    expect(registry.hasOpenLink("wouter")).toBe(false);
  });

  it("marks usernames as connecting before the principal DC opens", () => {
    const registry = new PrincipalLinkRegistry();
    new PresenceRtcSession({
      room: "workspace",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      linkRegistry: registry,
    });
    captured.mesh.getMyId.mockReturnValue("me");
    captured.mesh.getRoomPeers.mockReturnValue([
      { id: "me", name: "Self", user: "admin" },
      { id: "prin-wouter", name: "Wouter", user: "wouter" },
    ]);
    captured.mesh.getDataChannel.mockImplementation((id: string) =>
      id === "me" ? { readyState: "open" } : { readyState: "connecting" },
    );

    captured.bindingOptions?.onOpen("me");

    expect(registry.isConnectingTo("wouter")).toBe(true);
    expect(registry.hasOpenLink("wouter")).toBe(false);
  });

  it("polls every 4s when the presence room is empty and 20s once peers are linked", () => {
    new PresenceRtcSession({
      room: "workspace",
      rtcSettings: DEFAULT_RTC_SETTINGS,
    });
    captured.mesh.getRoomPeers.mockReturnValue([]);
    captured.bindingOptions?.onClose();
    expect(captured.pollIntervals?.steadyMs).toBe(4_000);

    captured.mesh.getRoomPeers.mockReturnValue([
      { id: "prin-wouter", name: "Wouter", user: "wouter" },
    ]);
    captured.mesh.getDataChannel.mockReturnValue({ readyState: "open" });
    captured.bindingOptions?.onOpen("prin-wouter");
    expect(captured.pollIntervals?.steadyMs).toBe(20_000);
  });

  it("passes link-down hints from the poll to the supervisor", () => {
    new PresenceRtcSession({
      room: "workspace",
      rtcSettings: DEFAULT_RTC_SETTINGS,
    });
    captured.mesh.getMyId.mockReturnValue("me");
    captured.mesh.getRoomPeers.mockReturnValue([{ id: "peer-z", name: "Zed", user: "zed" }]);
    captured.mesh.getDataChannel.mockReturnValue({ readyState: "open" });
    captured.bindingOptions?.onOpen("peer-z");
    captured.rtcLog.mockClear();

    captured.onPollData?.({
      peers: [{ id: "peer-z", name: "Zed", user: "zed" }],
      messages: [{ from: "peer-z", type: "link-down", payload: { v: 1, since: 1 } }],
    });

    const events = captured.rtcLog.mock.calls.map((call) => call[1] as string);
    expect(events.includes("link-hint-received") || events.includes("link-hint-ignored")).toBe(
      true,
    );
  });

  it("dials a rostered initiator-side peer after the grace period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    new PresenceRtcSession({
      room: "workspace",
      rtcSettings: DEFAULT_RTC_SETTINGS,
    });
    captured.mesh.getMyId.mockReturnValue("aaaaaaaa");
    captured.mesh.isInitiatorFor.mockReturnValue(true);
    captured.mesh.getRoomPeers.mockReturnValue([{ id: "zzzzzzzz", name: "Zed", user: "zed" }]);
    captured.mesh.getDataChannel.mockReturnValue(null);
    captured.mesh.getPeerConnection.mockReturnValue({ connectionState: "connecting" });
    captured.rtcLog.mockClear();

    captured.bindingOptions?.onClose();
    vi.advanceTimersByTime(10_000);

    expect(captured.rtcLog).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "principal" }),
      "link-dial",
      { remoteId: "zzzzzzzz" },
    );
    expect(captured.mesh.retryPeerConnection).toHaveBeenCalledWith("zzzzzzzz");
  });
});
