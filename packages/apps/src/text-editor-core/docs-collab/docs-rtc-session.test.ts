import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import type { DocsCollabMeshMessage } from "./docs-collab-types";
import { DocsRtcSession, parsePeerHintPeers } from "./docs-rtc-session";

type CapturedBinding = {
  onOpen: (remoteId: string) => void;
  onMessage: (remoteId: string, data: string) => void;
  onClose: () => void;
};

type CapturedMeshOptions = {
  onPollData?: (data: { peers: Array<{ id: string; name: string }>; messages: [] }) => void;
};

const captured = vi.hoisted(() => ({
  bindingOptions: null as CapturedBinding | null,
  meshOptions: null as CapturedMeshOptions | null,
  mesh: {
    applyPeerHint: vi.fn(),
    broadcastJson: vi.fn(),
    getMyId: vi.fn((): string | null => "me"),
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
