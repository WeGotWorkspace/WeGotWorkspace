import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import {
  PrincipalLinkRegistry,
  resetPrincipalLinkRegistryForTests,
} from "@/lib/rtc/session/principal-link-registry";
import type { DocsCollabMeshMessage } from "./docs-collab-types";
import { DocsRtcSession, parsePeerHintPeers } from "./docs-rtc-session";

type CapturedBinding = {
  onOpen: (remoteId: string) => void;
  onMessage: (remoteId: string, data: string) => void;
  onClose: () => void;
};

type CapturedMeshOptions = {
  onPollData?: (data: {
    peers: Array<{ id: string; name: string; user?: string }>;
    messages: [];
  }) => void;
  shouldConnectToPeer?: (peer: { id: string; name: string; user?: string }) => boolean;
};

const captured = vi.hoisted(() => ({
  bindingOptions: null as CapturedBinding | null,
  meshOptions: null as CapturedMeshOptions | null,
  mesh: {
    applyPeerHint: vi.fn(),
    broadcastJson: vi.fn(),
    sendJsonTo: vi.fn(),
    getMyId: vi.fn((): string | null => "me"),
    getMyName: vi.fn(() => "Self"),
    getPeerIds: vi.fn(() => [] as string[]),
    getRoomPeers: vi.fn(() => [] as Array<{ id: string; name: string }>),
    getPeerLinkStates: vi.fn(() => [] as Array<{ id: string; name: string; link: string }>),
    join: vi.fn(async () => ({ peerId: "me", peers: [] })),
    leave: vi.fn(async () => undefined),
    retryRoomPeerConnections: vi.fn(),
    abortPeerConnection: vi.fn(),
  },
}));

vi.mock("@/lib/rtc/session/bindings", () => ({
  createDataBinding: vi.fn((options: CapturedBinding) => {
    captured.bindingOptions = options;
    return { kind: "data" };
  }),
}));

vi.mock("@/lib/rtc/session/create-rtc-session", () => ({
  createRtcSession: vi.fn((options: CapturedMeshOptions) => {
    captured.meshOptions = options;
    return captured.mesh;
  }),
}));

function createSession(): DocsRtcSession {
  return new DocsRtcSession({
    apiBase: "/api/v1/rooms",
    room: "docs/gossip-test.md",
    rtcSettings: DEFAULT_RTC_SETTINGS,
  });
}

function pollRoster(peers: Array<{ id: string; name: string }>): void {
  captured.meshOptions?.onPollData?.({ peers, messages: [] });
}

describe("DocsRtcSession gossip discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrincipalLinkRegistryForTests();
    captured.bindingOptions = null;
    captured.meshOptions = null;
  });

  it("broadcasts a peer-hint when the roster poll reveals new peers", () => {
    createSession();

    pollRoster([
      { id: "me", name: "Self" },
      { id: "p1", name: "Ann" },
    ]);

    expect(captured.mesh.broadcastJson).toHaveBeenCalledWith({
      type: "peer-hint",
      peers: [{ id: "p1", name: "Ann" }],
    });
  });

  it("hints only peers not seen in the previous roster", () => {
    createSession();

    pollRoster([{ id: "p1", name: "Ann" }]);
    pollRoster([{ id: "p1", name: "Ann" }]);
    expect(captured.mesh.broadcastJson).toHaveBeenCalledTimes(1);

    pollRoster([
      { id: "p1", name: "Ann" },
      { id: "p2", name: "Bob" },
    ]);
    expect(captured.mesh.broadcastJson).toHaveBeenCalledTimes(2);
    expect(captured.mesh.broadcastJson).toHaveBeenLastCalledWith({
      type: "peer-hint",
      peers: [{ id: "p2", name: "Bob" }],
    });
  });

  it("re-hints a peer that left and rejoined", () => {
    createSession();

    pollRoster([{ id: "p1", name: "Ann" }]);
    pollRoster([]);
    pollRoster([{ id: "p1", name: "Ann" }]);

    expect(captured.mesh.broadcastJson).toHaveBeenCalledTimes(2);
  });

  it("applies received peer-hints to the mesh without emitting them", () => {
    const session = createSession();
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));

    captured.bindingOptions?.onMessage(
      "p1",
      JSON.stringify({
        type: "peer-hint",
        peers: [{ id: "p2", name: "Bob" }, { id: 42, name: "bad" }, "junk"],
      }),
    );

    expect(captured.mesh.applyPeerHint).toHaveBeenCalledWith([{ id: "p2", name: "Bob" }]);
    expect(seen).toEqual([]);
  });

  it("does not treat unknown message types or malformed payloads as hints", () => {
    createSession();

    captured.bindingOptions?.onMessage("p1", JSON.stringify({ type: "mystery", peers: [] }));
    captured.bindingOptions?.onMessage("p1", "not json at all");

    expect(captured.mesh.applyPeerHint).not.toHaveBeenCalled();
  });

  it("still emits sync messages tagged with the sender id", () => {
    const session = createSession();
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));

    captured.bindingOptions?.onMessage("p1", JSON.stringify({ type: "sync", u: [1, 2] }));

    expect(seen).toEqual([{ type: "sync", u: [1, 2], from: "p1" }]);
  });

  it("drops all listeners on clearMessageListeners", () => {
    const session = createSession();
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));

    session.clearMessageListeners();
    captured.bindingOptions?.onMessage("p1", JSON.stringify({ type: "sync", u: [1] }));

    expect(seen).toEqual([]);
  });
});

describe("parsePeerHintPeers", () => {
  it("returns an empty list for non-array payloads", () => {
    expect(parsePeerHintPeers(undefined)).toEqual([]);
    expect(parsePeerHintPeers("peers")).toEqual([]);
    expect(parsePeerHintPeers({ id: "x", name: "y" })).toEqual([]);
  });

  it("keeps only entries with a non-empty string id and a string name", () => {
    expect(
      parsePeerHintPeers([
        { id: "p1", name: "Ann" },
        { id: "", name: "empty" },
        { id: 7, name: "nope" },
        { id: "p2" },
        null,
        "junk",
      ]),
    ).toEqual([{ id: "p1", name: "Ann" }]);
  });
});

describe("DocsRtcSession principal reuse wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrincipalLinkRegistryForTests();
    captured.bindingOptions = null;
    captured.meshOptions = null;
  });

  it("skips ICE connect when the collab peer already has a principal DC", () => {
    const registry = new PrincipalLinkRegistry();
    const sent: unknown[] = [];
    registry.registerLink({
      username: "wouter",
      principalPeerId: "prin-wouter",
      send: (payload) => sent.push(payload),
    });
    captured.mesh.getMyId.mockReturnValue("aaaaaaaaaaaaaaaa");

    new DocsRtcSession({
      apiBase: "/api/v1/rooms",
      room: "/groups/administrators/team-notes.md",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      reuseRegistry: registry,
    });

    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    pollRoster([peer]);

    expect(captured.meshOptions?.shouldConnectToPeer?.(peer)).toBe(false);
    expect(sent).toContainEqual(expect.objectContaining({ op: "open", kind: "collab-reuse" }));
  });

  it("still dials ICE when there is no principal DC for that user", () => {
    const registry = new PrincipalLinkRegistry();
    new DocsRtcSession({
      apiBase: "/api/v1/rooms",
      room: "/groups/administrators/team-notes.md",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      reuseRegistry: registry,
    });

    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    pollRoster([peer]);

    expect(captured.meshOptions?.shouldConnectToPeer?.(peer)).toBe(true);
  });

  it("reconnects via the collab offer path after a reused principal link drops", () => {
    const registry = new PrincipalLinkRegistry();
    registry.registerLink({
      username: "wouter",
      principalPeerId: "prin-wouter",
      send: () => undefined,
    });
    captured.mesh.getMyId.mockReturnValue("aaaaaaaaaaaaaaaa");
    captured.mesh.getPeerLinkStates.mockReturnValue([
      { id: "bbbbbbbbbbbbbbbb", name: "Wouter", link: "connecting" },
    ]);

    const session = new DocsRtcSession({
      apiBase: "/api/v1/rooms",
      room: "/groups/administrators/team-notes.md",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      reuseRegistry: registry,
    });
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    pollRoster([peer]);
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });
    expect(captured.meshOptions?.shouldConnectToPeer?.(peer)).toBe(false);

    expect(() => {
      registry.unregisterLink("prin-wouter");
      pollRoster([peer]);
    }).not.toThrow();

    expect(captured.mesh.retryRoomPeerConnections).toHaveBeenCalled();
    expect(captured.meshOptions?.shouldConnectToPeer?.(peer)).toBe(true);
    expect(session.getRoomPeerStatuses()).toEqual([
      { id: peer.id, name: peer.name, link: "connecting" },
    ]);

    session.sendTo(peer.id, { type: "sync", u: [7] });
    expect(captured.mesh.sendJsonTo).toHaveBeenCalledWith(peer.id, { type: "sync", u: [7] });

    captured.bindingOptions?.onMessage(peer.id, JSON.stringify({ type: "sync", u: [8] }));
    expect(seen).toContainEqual({ type: "sync", u: [8], from: peer.id });
  });

  it("retries fresh ICE immediately when a reused principal link drops without a poll", () => {
    const registry = new PrincipalLinkRegistry();
    registry.registerLink({
      username: "wouter",
      principalPeerId: "prin-wouter",
      send: () => undefined,
    });
    captured.mesh.getMyId.mockReturnValue("aaaaaaaaaaaaaaaa");

    new DocsRtcSession({
      apiBase: "/api/v1/rooms",
      room: "/groups/administrators/team-notes.md",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      reuseRegistry: registry,
    });
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    pollRoster([peer]);
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });
    vi.mocked(captured.mesh.retryRoomPeerConnections).mockClear();

    registry.unregisterLink("prin-wouter");

    expect(captured.mesh.retryRoomPeerConnections).toHaveBeenCalledTimes(1);
    expect(captured.meshOptions?.shouldConnectToPeer?.(peer)).toBe(true);
  });

  it("does not retry ICE when principal reuse ack succeeds", () => {
    const registry = new PrincipalLinkRegistry();
    registry.registerLink({
      username: "wouter",
      principalPeerId: "prin-wouter",
      send: () => undefined,
    });
    captured.mesh.getMyId.mockReturnValue("aaaaaaaaaaaaaaaa");

    new DocsRtcSession({
      apiBase: "/api/v1/rooms",
      room: "/groups/administrators/team-notes.md",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      reuseRegistry: registry,
    });
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    pollRoster([peer]);
    vi.mocked(captured.mesh.retryRoomPeerConnections).mockClear();

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    expect(captured.mesh.retryRoomPeerConnections).not.toHaveBeenCalled();
  });

  it("retries principal reuse on link-open without a collab poll-changed", () => {
    const registry = new PrincipalLinkRegistry();
    const sent: unknown[] = [];
    registry.setConnectingUsernames(new Set(["wouter"]));
    captured.mesh.getMyId.mockReturnValue("aaaaaaaaaaaaaaaa");

    new DocsRtcSession({
      apiBase: "/api/v1/rooms",
      room: "/groups/administrators/team-notes.md",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      reuseRegistry: registry,
    });
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    pollRoster([peer]);

    expect(captured.meshOptions?.shouldConnectToPeer?.(peer)).toBe(false);
    expect(sent).toEqual([]);

    registry.registerLink({
      username: "wouter",
      principalPeerId: "prin-wouter",
      send: (payload) => sent.push(payload),
    });

    expect(sent).toContainEqual(expect.objectContaining({ op: "open", kind: "collab-reuse" }));
    expect(captured.meshOptions?.shouldConnectToPeer?.(peer)).toBe(false);
  });

  it("defers fresh ICE while principal mesh is connecting to the collab peer", () => {
    const registry = new PrincipalLinkRegistry();
    registry.setConnectingUsernames(new Set(["wouter"]));
    captured.mesh.getMyId.mockReturnValue("aaaaaaaaaaaaaaaa");

    new DocsRtcSession({
      apiBase: "/api/v1/rooms",
      room: "/groups/administrators/team-notes.md",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      reuseRegistry: registry,
    });
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    pollRoster([peer]);

    expect(captured.meshOptions?.shouldConnectToPeer?.(peer)).toBe(false);
    expect(captured.mesh.retryRoomPeerConnections).not.toHaveBeenCalled();
  });

  it("aborts in-flight collab ICE when principal reuse attaches", () => {
    const registry = new PrincipalLinkRegistry();
    registry.registerLink({
      username: "wouter",
      principalPeerId: "prin-wouter",
      send: () => undefined,
    });
    captured.mesh.getMyId.mockReturnValue("aaaaaaaaaaaaaaaa");

    new DocsRtcSession({
      apiBase: "/api/v1/rooms",
      room: "/groups/administrators/team-notes.md",
      rtcSettings: DEFAULT_RTC_SETTINGS,
      reuseRegistry: registry,
    });
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    pollRoster([peer]);
    vi.mocked(captured.mesh.abortPeerConnection).mockClear();

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    expect(captured.mesh.abortPeerConnection).toHaveBeenCalledWith(peer.id);
  });
});
