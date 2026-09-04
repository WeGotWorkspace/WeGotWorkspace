import { beforeEach, describe, expect, it, vi } from "vitest";
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
  mesh: {
    getMyId: vi.fn((): string | null => "me"),
    getRoomPeers: vi.fn(() => [] as Array<{ id: string; name: string; user?: string }>),
    getDataChannel: vi.fn((_id: string) => null as { readyState: string } | null),
    getPeerConnection: vi.fn(() => null as { connectionState: string } | null),
    sendJsonTo: vi.fn(),
    broadcastJson: vi.fn(),
    join: vi.fn(async () => ({ peerId: "me" })),
    leave: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/rtc/session/bindings", () => ({
  createDataBinding: vi.fn((options: CapturedBinding) => {
    captured.bindingOptions = options;
    return { kind: "data" };
  }),
}));

vi.mock("@/lib/rtc/session/create-rtc-session", () => ({
  createRtcSession: vi.fn(() => captured.mesh),
}));

describe("PresenceRtcSession principal link publishing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.bindingOptions = null;
    captured.mesh.getRoomPeers.mockReturnValue([]);
    captured.mesh.getDataChannel.mockReturnValue(null);
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
});
