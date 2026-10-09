import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { rtcLog } from "@/lib/rtc/log";
import type {
  LinkChannelClient,
  LinkRoomListener,
  LinkTrust,
  PeerChannelState,
  RoomEndpointState,
} from "@/lib/rtc/link/link-channel-types";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import { collabRoomKey } from "./docs-collab-ticket";
import type { DocsCollabMeshMessage } from "./docs-collab-types";
import { DocsRtcSession, parsePeerHintPeers } from "./docs-rtc-session";

vi.mock("@/lib/rtc/log", () => ({
  rtcLog: vi.fn(),
}));

type CapturedMeshOptions = {
  onPollData?: (data: {
    peers: Array<{
      id: string;
      name: string;
      user?: string;
      access?: string;
      caps?: readonly string[];
    }>;
    messages: Array<{ from: string; type: string; payload?: unknown }>;
    ticket?: string;
  }) => void;
  onPollError?: (error: unknown) => void;
  shouldConnectToPeer?: (peer: { id: string; name: string }) => boolean;
  shouldAcceptOffer?: (from: string) => boolean;
  recoverOnUnknownPeer?: boolean;
};

const captured = vi.hoisted(() => ({
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
    sendMailbox: vi.fn(async (_to: string, _type: string, _payload: unknown) => undefined),
    kickPoll: vi.fn(),
  },
}));

vi.mock("@/lib/rtc/session/bindings", () => ({
  createDataBinding: vi.fn((options: { label: string }) => ({
    kind: "data",
    label: options.label,
  })),
}));

vi.mock("@/lib/rtc/session/create-rtc-session", () => ({
  createRtcSession: vi.fn((options: CapturedMeshOptions) => {
    captured.meshOptions = options;
    return captured.mesh;
  }),
}));

class FakeLinkClient implements LinkChannelClient {
  readonly rooms: RoomEndpointState[] = [];

  readonly kicks: string[] = [];

  readonly removed: string[] = [];

  readonly sent: Array<{ roomKey: string; to: string; msg: unknown }> = [];

  readonly broadcasts: Array<{ roomKey: string; msg: unknown }> = [];

  private readonly listeners = new Map<string, LinkRoomListener>();

  private availableFlag = true;

  available(): boolean {
    return this.availableFlag;
  }

  setAvailable(value: boolean): void {
    this.availableFlag = value;
  }

  setRoom(state: RoomEndpointState): void {
    this.rooms.push(structuredClone(state));
  }

  removeRoom(roomKey: string): void {
    this.removed.push(roomKey);
  }

  kick(roomKey: string): void {
    this.kicks.push(roomKey);
  }

  send(roomKey: string, toPeer: string, msg: unknown): boolean {
    this.sent.push({ roomKey, to: toPeer, msg });
    return false;
  }

  broadcast(roomKey: string, msg: unknown): number {
    this.broadcasts.push({ roomKey, msg });
    return 0;
  }

  peerStates(_roomKey: string): ReadonlyMap<string, PeerChannelState> {
    return new Map();
  }

  subscribe(roomKey: string, listener: LinkRoomListener): () => void {
    this.listeners.set(roomKey, listener);
    return () => {
      if (this.listeners.get(roomKey) === listener) this.listeners.delete(roomKey);
    };
  }

  pushMessage(roomKey: string, from: string, msg: unknown, trust: LinkTrust): void {
    this.listeners.get(roomKey)?.onMessage(from, msg, trust);
  }

  pushState(roomKey: string, states: ReadonlyMap<string, PeerChannelState>): void {
    this.listeners.get(roomKey)?.onState(states);
  }

  pushNeedRoster(roomKey: string): void {
    this.listeners.get(roomKey)?.onNeedRoster();
  }

  hasListener(roomKey: string): boolean {
    return this.listeners.has(roomKey);
  }
}

const ROOM = "docs/link-channel-test.md";

function createSession(
  linkClient: FakeLinkClient,
  extra?: Partial<ConstructorParameters<typeof DocsRtcSession>[0]>,
): DocsRtcSession {
  return new DocsRtcSession({
    apiBase: "/api/v1/rooms",
    room: ROOM,
    rtcSettings: DEFAULT_RTC_SETTINGS,
    linkClient,
    ...extra,
  });
}

describe("DocsRtcSession link channels", () => {
  let links: FakeLinkClient;

  beforeEach(() => {
    vi.clearAllMocks();
    captured.meshOptions = null;
    captured.mesh.getMyId.mockReturnValue("me");
    captured.mesh.join.mockResolvedValue({ peerId: "me", peers: [] });
    links = new FakeLinkClient();
  });

  it("join registers the room with the SHA-1 room key, my peer id, ticket and roster", async () => {
    const ticket = "join-ticket";
    captured.mesh.join.mockResolvedValueOnce({
      peerId: "me",
      peers: [],
      ticket,
    });
    const session = createSession(links);
    await session.join("Self");

    const roomKey = await collabRoomKey(ROOM);
    expect(links.rooms.at(-1)).toEqual({
      kind: "collab",
      roomKey,
      myPeerId: "me",
      ticket,
      jwk: null,
      roster: [],
    });
    expect(links.hasListener(roomKey)).toBe(true);
    await session.leave();
  });

  it("a roster poll updates the registered room", async () => {
    const session = createSession(links);
    await session.join("Self");
    const roomKey = await collabRoomKey(ROOM);
    links.rooms.length = 0;

    captured.meshOptions?.onPollData?.({
      peers: [
        { id: "p1", name: "Ann", user: "ann", access: "write" },
        { id: "p2", name: "Bob" },
      ],
      messages: [],
      ticket: "poll-ticket",
    });

    expect(links.rooms.at(-1)).toEqual({
      kind: "collab",
      roomKey,
      myPeerId: "me",
      ticket: "poll-ticket",
      jwk: null,
      roster: [{ id: "p1", user: "ann", access: "write" }],
    });
    await session.leave();
  });

  it("a peer that becomes live emits dc-open once and logs it", async () => {
    const session = createSession(links);
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));
    await session.join("Self");
    const roomKey = await collabRoomKey(ROOM);

    captured.meshOptions?.onPollData?.({
      peers: [{ id: "p1", name: "Ann", user: "ann", access: "write" }],
      messages: [],
    });

    links.pushState(roomKey, new Map([["p1", { out: true, in: true }]]));
    links.pushState(roomKey, new Map([["p1", { out: true, in: true }]]));

    expect(seen.filter((msg) => msg.type === "dc-open")).toEqual([{ type: "dc-open", from: "p1" }]);
    expect(rtcLog).toHaveBeenCalledWith({ channel: "collab", peerId: "me" }, "dc-open", {
      remoteId: "p1",
      via: "link",
    });
    await session.leave();
  });

  it("a peer with yjs-http that is not live shows as server", async () => {
    const session = createSession(links);
    await session.join("Self");

    captured.meshOptions?.onPollData?.({
      peers: [
        { id: "p1", name: "Ann", user: "ann", caps: ["yjs-http"] },
        { id: "p2", name: "Bob", user: "bob" },
      ],
      messages: [],
    });

    expect(session.getRoomPeerStatuses()).toEqual([
      { id: "p1", name: "Ann", link: "server" },
      { id: "p2", name: "Bob", link: "connecting" },
    ]);
    expect(session.linkCount()).toBe(0);
    await session.leave();
  });

  it("the HTTP sync treats only out-ready peers as connected", async () => {
    const doc = new Y.Doc();
    const session = createSession(links, { getYDoc: () => doc });
    await session.join("Self");
    const roomKey = await collabRoomKey(ROOM);

    captured.meshOptions?.onPollData?.({
      peers: [
        { id: "p1", name: "Ann", user: "ann", caps: ["yjs-http"] },
        { id: "p2", name: "Bob", user: "bob", caps: ["yjs-http"] },
      ],
      messages: [],
    });
    links.pushState(
      roomKey,
      new Map([
        ["p1", { out: true, in: false }],
        ["p2", { out: false, in: true }],
      ]),
    );

    // Force evaluate so HTTP sync reads the roster; out-ready peers stay off the mailbox.
    captured.mesh.sendMailbox.mockClear();
    vi.useFakeTimers();
    try {
      // Advance past the HTTP fallback delay with webrtcUnavailable false (links available).
      await vi.advanceTimersByTimeAsync(6_000);
    } finally {
      vi.useRealTimers();
    }

    // p1 is out-ready → connected for HTTP; p2 is not. Only non-connected peers get mailbox SV.
    // With default fallback delay + available links, evaluate may schedule; kick via unavailable.
    links.setAvailable(false);
    captured.meshOptions?.onPollData?.({
      peers: [
        { id: "p1", name: "Ann", user: "ann", caps: ["yjs-http"] },
        { id: "p2", name: "Bob", user: "bob", caps: ["yjs-http"] },
      ],
      messages: [],
    });

    const mailboxTargets = captured.mesh.sendMailbox.mock.calls.map((call) => call[0]);
    expect(mailboxTargets).not.toContain("p1");
    expect(mailboxTargets).toContain("p2");
    await session.leave();
  });

  it("a mailbox message from a non-ready peer kicks the room once", async () => {
    const session = createSession(links);
    await session.join("Self");
    const roomKey = await collabRoomKey(ROOM);

    links.pushState(roomKey, new Map([["p1", { out: true, in: true }]]));
    captured.meshOptions?.onPollData?.({
      peers: [
        { id: "p1", name: "Ann", user: "ann" },
        { id: "p2", name: "Bob", user: "bob" },
      ],
      messages: [
        { from: "p1", type: "yjs", payload: {} },
        { from: "p2", type: "yjs", payload: {} },
        { from: "p2", type: "yjs-sv", payload: {} },
      ],
    });

    expect(links.kicks).toEqual([roomKey]);
    await session.leave();
  });

  it("an inbound channel message carries the link trust", async () => {
    const session = createSession(links);
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));
    await session.join("Self");
    const roomKey = await collabRoomKey(ROOM);

    links.pushMessage(
      roomKey,
      "p1",
      { type: "sync", u: [1, 2] },
      { user: "ann", access: "comment" },
    );

    expect(seen).toContainEqual({
      type: "sync",
      u: [1, 2],
      from: "p1",
      trust: { user: "ann", access: "comment" },
    });
    await session.leave();
  });

  it("a peer-hint message kicks the collab poll", async () => {
    const session = createSession(links);
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));
    await session.join("Self");
    const roomKey = await collabRoomKey(ROOM);
    captured.mesh.kickPoll.mockClear();

    links.pushMessage(
      roomKey,
      "p1",
      { type: "peer-hint", peers: [{ id: "p2", name: "Bob" }] },
      { user: "ann", access: "write" },
    );

    expect(captured.mesh.kickPoll).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    expect(captured.mesh.applyPeerHint).not.toHaveBeenCalled();
    await session.leave();
  });

  it("sendTo uses the link client and does not throw when it returns false", async () => {
    const session = createSession(links);
    await session.join("Self");
    const roomKey = await collabRoomKey(ROOM);
    captured.meshOptions?.onPollData?.({
      peers: [{ id: "me", name: "Self", user: "self", access: "write" }],
      messages: [],
      ticket: [
        btoa(
          JSON.stringify({
            v: 1,
            kid: "k",
            room: "r",
            user: "self",
            peer: "me",
            access: "write",
            iat: 1,
            exp: 9,
          }),
        )
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", ""),
        "sig",
      ].join("."),
    });

    expect(() => session.sendTo("p1", { type: "sync", u: [1] })).not.toThrow();
    expect(links.sent).toEqual([{ roomKey, to: "p1", msg: { type: "sync", u: [1] } }]);
    expect(captured.mesh.sendJsonTo).not.toHaveBeenCalled();
    await session.leave();
  });

  it("leave removes the room and unsubscribes", async () => {
    const session = createSession(links);
    await session.join("Self");
    const roomKey = await collabRoomKey(ROOM);
    expect(links.hasListener(roomKey)).toBe(true);

    await session.leave();

    expect(links.removed).toEqual([roomKey]);
    expect(links.hasListener(roomKey)).toBe(false);
    expect(captured.mesh.leave).toHaveBeenCalled();
  });

  it("a 403 poll removes the room and emits forbidden", async () => {
    const session = createSession(links);
    const seen: DocsCollabMeshMessage[] = [];
    session.onMessage((msg) => seen.push(msg));
    await session.join("Self");
    const roomKey = await collabRoomKey(ROOM);

    captured.meshOptions?.onPollError?.(new Error("Collab poll failed (403)"));

    expect(links.removed).toEqual([roomKey]);
    expect(seen).toContainEqual({ type: "forbidden" });
    await session.leave();
  });

  it("the collab mesh never creates an RTCPeerConnection", async () => {
    const Pc = vi.fn();
    vi.stubGlobal("RTCPeerConnection", Pc);
    const session = createSession(links);
    await session.join("Self");

    expect(captured.meshOptions?.shouldConnectToPeer?.({ id: "p1", name: "Ann" })).toBe(false);
    expect(captured.meshOptions?.shouldAcceptOffer?.("p1")).toBe(false);
    expect(captured.meshOptions?.recoverOnUnknownPeer).toBe(true);
    expect(Pc).not.toHaveBeenCalled();

    await session.leave();
    vi.unstubAllGlobals();
  });
});

describe("parsePeerHintPeers", () => {
  it("returns an empty list for non-array payloads", () => {
    expect(parsePeerHintPeers(undefined)).toEqual([]);
    expect(parsePeerHintPeers("peers")).toEqual([]);
  });

  it("keeps only entries with a non-empty string id and a string name", () => {
    expect(
      parsePeerHintPeers([
        { id: "p1", name: "Ann" },
        { id: "", name: "empty" },
        { id: 7, name: "nope" },
        null,
      ]),
    ).toEqual([{ id: "p1", name: "Ann" }]);
  });
});
