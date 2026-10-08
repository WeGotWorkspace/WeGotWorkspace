import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { rtcLog } from "@/lib/rtc/log";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import {
  PrincipalLinkRegistry,
  resetPrincipalLinkRegistryForTests,
} from "@/lib/rtc/session/principal-link-registry";
import { SYNC_STEP_1, SYNC_STEP_2, SYNC_UPDATE } from "./docs-collab-mesh-sync";
import type { DocsCollabMeshMessage } from "./docs-collab-types";
import { DocsRtcSession, parsePeerHintPeers, tagOf } from "./docs-rtc-session";

vi.mock("@/lib/rtc/log", () => ({
  rtcLog: vi.fn(),
}));

type CapturedBinding = {
  onOpen: (remoteId: string) => void;
  onMessage: (remoteId: string, data: string) => void;
  onClose: () => void;
};

type CapturedMeshOptions = {
  onPollData?: (data: {
    peers: Array<{
      id: string;
      name: string;
      user?: string;
      access?: string;
      caps?: readonly string[];
    }>;
    messages: [];
    ticket?: string;
  }) => void;
  shouldConnectToPeer?: (peer: { id: string; name: string; user?: string }) => boolean;
  shouldAcceptOffer?: (from: string) => boolean;
  onPollError?: (error: unknown) => void;
  onSendFailed?: (remoteId: string) => void;
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
    join: vi.fn(async (): Promise<{ peerId: string; peers: []; ticket?: string }> => ({
      peerId: "me",
      peers: [],
    })),
    leave: vi.fn(async () => undefined),
    retryRoomPeerConnections: vi.fn(),
    retryPeerConnection: vi.fn(),
    abortPeerConnection: vi.fn(),
    sendMailbox: vi.fn(async () => undefined),
    kickPoll: vi.fn(),
    localNetClass: vi.fn((): string | undefined => undefined),
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

/** Unsigned stand-in. `decodeCollabTicketPayload` does not check the signature. */
function collabTicket(input: { peer: string; access: string }): string {
  const json = JSON.stringify({
    v: 1,
    kid: "k",
    room: "r",
    user: "admin",
    peer: input.peer,
    access: input.access,
    iat: 1,
    exp: 9,
  });
  const body = btoa(json).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${body}.sig`;
}

function pollRoster(peers: Array<{ id: string; name: string }>): void {
  captured.meshOptions?.onPollData?.({ peers, messages: [] });
}

describe("DocsRtcSession send failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrincipalLinkRegistryForTests();
    captured.bindingOptions = null;
    captured.meshOptions = null;
  });

  it("marks the peer for resync when a data-channel send fails", () => {
    const session = createSession();
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));

    captured.meshOptions?.onSendFailed?.("p1");

    expect(seen).toEqual([{ type: "resync", from: "p1" }]);
  });

  it("polls again when a mailbox post is refused", async () => {
    const doc = new Y.Doc();
    captured.mesh.sendMailbox.mockRejectedValue(new Error("mailbox_refused"));
    captured.mesh.getPeerLinkStates.mockReturnValue([
      { id: "peer-b", name: "Bea", link: "connecting" },
    ]);

    new DocsRtcSession({
      apiBase: "/api/v1/rooms",
      room: "docs/mailbox-refused.md",
      rtcSettings: { ...DEFAULT_RTC_SETTINGS, forceRelay: true, turnAvailable: false },
      getYDoc: () => doc,
    });

    captured.mesh.kickPoll.mockClear();
    captured.meshOptions?.onPollData?.({
      peers: [{ id: "peer-b", name: "Bea", caps: ["yjs-http"] }],
      messages: [],
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(captured.mesh.sendMailbox).toHaveBeenCalled();
    expect(captured.mesh.kickPoll).toHaveBeenCalled();
  });
});

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

    expect(seen).toEqual([
      { type: "sync", u: [1, 2], from: "p1", trust: { user: "", access: "read" } },
    ]);
  });

  it("takes a direct peer's rights from the roster, not from the message", () => {
    const session = createSession();
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));
    captured.meshOptions?.onPollData?.({
      peers: [{ id: "p1", name: "Carol", user: "carol", access: "comment" }],
      messages: [],
    });

    captured.bindingOptions?.onMessage(
      "p1",
      JSON.stringify({ type: "sync", u: [2, 1], trust: { user: "bob", access: "write" } }),
    );

    expect(seen.at(-1)).toMatchObject({ trust: { user: "carol", access: "comment" } });
  });

  it("keeps a viewer from putting a document update on the wire", () => {
    const session = createSession();
    captured.meshOptions?.onPollData?.({
      peers: [
        { id: "me", name: "Self", user: "carol", access: "read" },
        { id: "p1", name: "Bob", user: "bob", access: "write" },
      ],
      messages: [],
    });
    expect(session.myAccess()).toBe("read");

    session.broadcast({ type: "sync", u: [SYNC_UPDATE, 1, 2] });
    session.sendTo("p1", { type: "sync", u: [SYNC_STEP_2, 1, 2] });
    expect(captured.mesh.broadcastJson).not.toHaveBeenCalledWith({
      type: "sync",
      u: [SYNC_UPDATE, 1, 2],
    });
    expect(captured.mesh.sendJsonTo).not.toHaveBeenCalled();

    // A step 1 only asks for state, which is the whole point of a viewer.
    session.sendTo("p1", { type: "sync", u: [SYNC_STEP_1, 0] });
    session.broadcast({ type: "awareness", u: [1] });
    expect(captured.mesh.sendJsonTo).toHaveBeenCalledWith("p1", {
      type: "sync",
      u: [SYNC_STEP_1, 0],
    });
    expect(captured.mesh.broadcastJson).toHaveBeenCalledWith({ type: "awareness", u: [1] });
  });

  it("ends the session and drops the reuse links when a poll comes back 403", () => {
    const session = createSession();
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));
    captured.meshOptions?.onPollData?.({
      peers: [{ id: "me", name: "Self", user: "carol", access: "write" }],
      messages: [],
    });
    expect(session.myAccess()).toBe("write");

    captured.meshOptions?.onPollError?.(new Error("Collab poll failed (403)"));

    expect(seen).toContainEqual({ type: "forbidden" });
    expect(session.myAccess()).toBe("read");
  });

  it("leaves a poll failure that is not a 403 alone", () => {
    const session = createSession();
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));
    captured.meshOptions?.onPollData?.({
      peers: [{ id: "me", name: "Self", user: "carol", access: "write" }],
      messages: [],
    });

    captured.meshOptions?.onPollError?.(new Error("network down"));

    expect(seen).not.toContainEqual({ type: "forbidden" });
    expect(session.myAccess()).toBe("write");
  });

  it("learns its own write right from the poll ticket when the roster omits self", () => {
    const session = createSession();
    captured.meshOptions?.onPollData?.({
      peers: [{ id: "other", name: "Other", user: "member", access: "write" }],
      messages: [],
      ticket: collabTicket({ peer: "me", access: "write" }),
    });

    expect(session.myAccess()).toBe("write");
    session.broadcast({ type: "sync", u: [SYNC_UPDATE, 1, 2] });
    expect(captured.mesh.broadcastJson).toHaveBeenCalledWith({
      type: "sync",
      u: [SYNC_UPDATE, 1, 2],
    });
  });

  it("lets an editor broadcast document updates", () => {
    const session = createSession();
    captured.meshOptions?.onPollData?.({
      peers: [{ id: "me", name: "Self", user: "bob", access: "write" }],
      messages: [],
    });

    session.broadcast({ type: "sync", u: [SYNC_UPDATE, 1, 2] });

    expect(captured.mesh.broadcastJson).toHaveBeenCalledWith({
      type: "sync",
      u: [SYNC_UPDATE, 1, 2],
    });
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

    expect(captured.mesh.retryPeerConnection).toHaveBeenCalledWith(peer.id);
    expect(captured.meshOptions?.shouldConnectToPeer?.(peer)).toBe(true);
    expect(session.getRoomPeerStatuses()).toEqual([
      { id: peer.id, name: peer.name, link: "connecting" },
    ]);

    session.sendTo(peer.id, { type: "sync", u: [7] });
    expect(captured.mesh.sendJsonTo).toHaveBeenCalledWith(peer.id, { type: "sync", u: [7] });

    captured.bindingOptions?.onMessage(peer.id, JSON.stringify({ type: "sync", u: [8] }));
    expect(seen).toContainEqual(expect.objectContaining({ type: "sync", u: [8], from: peer.id }));
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
    vi.mocked(captured.mesh.retryPeerConnection).mockClear();

    registry.unregisterLink("prin-wouter");

    expect(captured.mesh.retryPeerConnection).toHaveBeenCalledTimes(1);
    expect(captured.mesh.retryPeerConnection).toHaveBeenCalledWith(peer.id);
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

  it("ignores inbound collab offers when principal reuse is active for that user", () => {
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
    const stalePeer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    pollRoster([stalePeer]);
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });
    const activePeer = { id: "cccccccccccccccc", name: "Wouter", user: "wouter" };
    pollRoster([activePeer]);

    expect(captured.meshOptions?.shouldAcceptOffer?.("cccccccccccccccc")).toBe(false);
    expect(captured.meshOptions?.shouldAcceptOffer?.("bbbbbbbbbbbbbbbb")).toBe(false);
    expect(captured.meshOptions?.shouldAcceptOffer?.("dddddddddddddddd")).toBe(true);
  });
});

describe("DocsRtcSession join access and single session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrincipalLinkRegistryForTests();
    captured.bindingOptions = null;
    captured.meshOptions = null;
    captured.mesh.getMyId.mockReturnValue("me");
    captured.mesh.join.mockResolvedValue({ peerId: "me", peers: [] });
  });

  it("learns write access from the join ticket without a later poll", async () => {
    const session = createSession();
    captured.mesh.join.mockResolvedValueOnce({
      peerId: "me",
      peers: [],
      ticket: collabTicket({ peer: "me", access: "write" }),
    });

    await session.join("Self");

    expect(session.myAccess()).toBe("write");
    await session.leave();
  });

  it("logs duplicate-session when two sessions join the same room", async () => {
    const first = createSession();
    const second = createSession();
    await first.join("One");
    await second.join("Two");

    expect(rtcLog).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "collab", peerId: "me" }),
      "duplicate-session",
      expect.objectContaining({
        room: "docs/gossip-test.md",
        ids: ["me", "me"],
      }),
    );

    await first.leave();
    await second.leave();
    vi.mocked(rtcLog).mockClear();
    const third = createSession();
    await third.join("Three");
    expect(rtcLog).not.toHaveBeenCalledWith(
      expect.anything(),
      "duplicate-session",
      expect.anything(),
    );
    await third.leave();
  });
});

describe("DocsRtcSession data-channel debug tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrincipalLinkRegistryForTests();
    captured.bindingOptions = null;
    captured.meshOptions = null;
    captured.mesh.getMyId.mockReturnValue("me");
  });

  it("logs a send and its receive with the same payload tag", () => {
    const session = createSession();
    captured.meshOptions?.onPollData?.({
      peers: [{ id: "me", name: "Self", user: "carol", access: "write" }],
      messages: [],
    });
    const u = Array.from({ length: 20 }, (_, index) => index + 1);
    const tag = "01020304050607080d0e0f1011121314";

    session.broadcast({ type: "sync", u });
    expect(tagOf({ u })).toBe(tag);
    expect(rtcLog).toHaveBeenCalledWith({ channel: "collab", peerId: "me" }, "dc-send", {
      type: "sync",
      bytes: 20,
      tag,
    });

    captured.bindingOptions?.onMessage("p1", JSON.stringify({ type: "sync", u }));
    expect(rtcLog).toHaveBeenCalledWith({ channel: "collab", peerId: "me" }, "dc-recv", {
      from: "p1",
      type: "sync",
      bytes: 20,
      tag,
    });

    vi.mocked(rtcLog).mockClear();
    session.sendTo("p1", { type: "awareness", u: [1, 2, 3] });
    expect(rtcLog).toHaveBeenCalledWith({ channel: "collab", peerId: "me" }, "dc-send", {
      type: "awareness",
      bytes: 3,
      tag: "010203",
    });
  });

  it("does not log a muted document update as sent", () => {
    const session = createSession();
    captured.meshOptions?.onPollData?.({
      peers: [{ id: "me", name: "Self", user: "carol", access: "read" }],
      messages: [],
    });

    session.broadcast({ type: "sync", u: [SYNC_UPDATE, 1, 2, 3] });
    expect(rtcLog).not.toHaveBeenCalledWith(expect.anything(), "dc-send", expect.anything());
    expect(rtcLog).toHaveBeenCalledWith(
      { channel: "collab", peerId: "me" },
      "update-not-sent",
      expect.objectContaining({ reason: "reader" }),
    );
  });
});
