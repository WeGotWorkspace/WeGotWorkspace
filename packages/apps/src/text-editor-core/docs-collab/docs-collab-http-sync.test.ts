import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnCredentials } from "@/lib/rtc/types";
import * as Y from "yjs";
import type { DocsCollabAccess } from "./docs-collab-access";
import { DocsCollabHttpSync, type DocsCollabHttpSyncPorts } from "./docs-collab-http-sync";
import { encodeYjsHttpPayload } from "./docs-collab-http-wire";

function harness(access: DocsCollabAccess, doc: Y.Doc) {
  const sent: Array<{ to: string; type: "yjs" | "yjs-sv" }> = [];
  const ports: DocsCollabHttpSyncPorts = {
    now: () => 0,
    peers: () => [],
    webrtcUnavailable: () => false,
    send: (to, type) => {
      sent.push({ to, type });
    },
    sendStateVectorOnChannel: () => {},
    requestRelay: async () => ({ outcome: "relay_unavailable" }),
    onRelay: () => {},
    setFastPoll: () => {},
    getYDoc: () => doc,
    trust: () => ({ access: "write", user: "editor" }),
    myAccess: () => access,
  };
  return { sync: new DocsCollabHttpSync(ports), sent };
}

describe("DocsCollabHttpSync state-vector answers", () => {
  it("publishes a diff only when this client may write", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").insert(0, [new Y.XmlText("body")]);
    const asking = new Y.Doc();
    const message = {
      from: "peer-b",
      type: "yjs-sv",
      payload: encodeYjsHttpPayload(Y.encodeStateVector(asking), 1),
    };

    const writer = harness("write", doc);
    writer.sync.ingest([message]);
    expect(writer.sent.length).toBeGreaterThan(0);
    expect(writer.sent.every((row) => row.to === "peer-b" && row.type === "yjs")).toBe(true);

    const reader = harness("read", doc);
    reader.sync.ingest([message]);
    expect(reader.sent).toEqual([]);

    const commenter = harness("comment", doc);
    commenter.sync.ingest([message]);
    expect(commenter.sent).toEqual([]);
  });
});

describe("DocsCollabHttpSync relay refresh", () => {
  it("asks again with refresh after the credential window while the channel stays closed", async () => {
    let now = 1_000;
    const reasons: string[] = [];
    const turn: TurnCredentials = {
      urls: ["turn:turn.example:3478"],
      username: "user",
      credential: "cred",
      ttl: 180,
    };
    const sync = new DocsCollabHttpSync({
      now: () => now,
      peers: () => [
        { id: "peer-b", name: "Bea", caps: ["relay-jit", "yjs-http"], connected: false },
      ],
      webrtcUnavailable: () => true,
      send: () => {},
      sendStateVectorOnChannel: () => {},
      requestRelay: async (_peerId, reason) => {
        reasons.push(reason);
        return { outcome: "issued", turn };
      },
      onRelay: () => {},
      setFastPoll: () => {},
      getYDoc: () => null,
      trust: () => ({ access: "write", user: "editor" }),
      myAccess: () => "write",
    });

    sync.evaluate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reasons).toEqual(["timeout"]);

    sync.evaluate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reasons).toEqual(["timeout"]);

    now += 120_000;
    sync.evaluate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reasons).toEqual(["timeout", "refresh"]);
  });
});

describe("DocsCollabHttpSync evaluate scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the mailbox fallback 5 s after a peer is first seen without another trigger", async () => {
    const sent: Array<{ to: string; type: string }> = [];
    const fastPoll: boolean[] = [];
    const doc = new Y.Doc();
    const sync = new DocsCollabHttpSync({
      now: () => Date.now(),
      peers: () => [{ id: "peer-b", name: "Bea", caps: ["yjs-http"], connected: false }],
      webrtcUnavailable: () => false,
      send: (to, type) => {
        sent.push({ to, type });
      },
      sendStateVectorOnChannel: () => {},
      requestRelay: async () => ({ outcome: "relay_unavailable" }),
      onRelay: () => {},
      setFastPoll: (active) => {
        fastPoll.push(active);
      },
      getYDoc: () => doc,
      trust: () => ({ access: "write", user: "editor" }),
      myAccess: () => "write",
    });

    sync.start();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(sent).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toContainEqual({ to: "peer-b", type: "yjs-sv" });
    expect(fastPoll).toContain(true);

    sync.stop();
  });

  it("asks for a relay 8 s after a peer is first seen without another trigger", async () => {
    const requestRelay = vi.fn(async () => ({ outcome: "relay_unavailable" as const }));
    const sync = new DocsCollabHttpSync({
      now: () => Date.now(),
      peers: () => [
        {
          id: "peer-b",
          name: "Bea",
          caps: ["yjs-http", "relay-jit"],
          connected: false,
        },
      ],
      webrtcUnavailable: () => false,
      send: () => {},
      sendStateVectorOnChannel: () => {},
      requestRelay,
      onRelay: () => {},
      setFastPoll: () => {},
      getYDoc: () => null,
      trust: () => ({ access: "write", user: "editor" }),
      myAccess: () => "write",
    });

    sync.start();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(requestRelay).toHaveBeenCalledTimes(1);
    expect(requestRelay).toHaveBeenCalledWith("peer-b", "timeout");

    sync.stop();
  });

  it("does not schedule for connected peers", async () => {
    const sent: Array<{ to: string; type: string }> = [];
    const requestRelay = vi.fn(async () => ({ outcome: "relay_unavailable" as const }));
    const sync = new DocsCollabHttpSync({
      now: () => Date.now(),
      peers: () => [
        { id: "peer-b", name: "Bea", caps: ["yjs-http", "relay-jit"], connected: true },
      ],
      webrtcUnavailable: () => false,
      send: (to, type) => {
        sent.push({ to, type });
      },
      sendStateVectorOnChannel: () => {},
      requestRelay,
      onRelay: () => {},
      setFastPoll: () => {},
      getYDoc: () => new Y.Doc(),
      trust: () => ({ access: "write", user: "editor" }),
      myAccess: () => "write",
    });

    sync.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent.filter((row) => row.type === "yjs-sv")).toEqual([]);
    expect(requestRelay).not.toHaveBeenCalled();

    sync.stop();
  });

  it("stop clears the pending evaluate", async () => {
    const sent: Array<{ to: string; type: string }> = [];
    const sync = new DocsCollabHttpSync({
      now: () => Date.now(),
      peers: () => [{ id: "peer-b", name: "Bea", caps: ["yjs-http"], connected: false }],
      webrtcUnavailable: () => false,
      send: (to, type) => {
        sent.push({ to, type });
      },
      sendStateVectorOnChannel: () => {},
      requestRelay: async () => ({ outcome: "relay_unavailable" }),
      onRelay: () => {},
      setFastPoll: () => {},
      getYDoc: () => new Y.Doc(),
      trust: () => ({ access: "write", user: "editor" }),
      myAccess: () => "write",
    });

    sync.start();
    sync.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toEqual([]);
  });
});
