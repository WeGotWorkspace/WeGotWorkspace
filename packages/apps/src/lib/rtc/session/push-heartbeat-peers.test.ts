import { afterEach, describe, expect, it } from "vitest";
import {
  pushHeartbeatHeaderValue,
  pushHeartbeatIncludes,
  registerPushHeartbeatPeer,
  resetPushHeartbeatPeersForTests,
  type PushHeartbeatStorage,
} from "@/lib/rtc/session/push-heartbeat-peers";

function memoryStorage(): PushHeartbeatStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("push heartbeat peers (#2287)", () => {
  afterEach(() => {
    resetPushHeartbeatPeersForTests(() => null);
  });

  it("names this tab's peers and other tabs' fresh entries, not stale ones", () => {
    const storage = memoryStorage();
    let now = 100_000;
    resetPushHeartbeatPeersForTests(
      () => storage,
      () => now,
    );
    storage.setItem(
      "wgw.rtc.pushPeers.other",
      JSON.stringify({ at: now - 10_000, peers: ["meet:aa"] }),
    );
    storage.setItem(
      "wgw.rtc.pushPeers.crashed",
      JSON.stringify({ at: now - 60_000, peers: ["meet:zz"] }),
    );
    storage.setItem("unrelated", "x");

    const release = registerPushHeartbeatPeer("meet", "me-1");
    expect(pushHeartbeatHeaderValue()?.split(",").sort()).toEqual(["meet:aa", "meet:me-1"]);

    // A crashed tab's entry is dropped, not kept for good.
    expect(storage.data.has("wgw.rtc.pushPeers.crashed")).toBe(false);
    expect(storage.data.has("unrelated")).toBe(true);

    release();
    expect(pushHeartbeatHeaderValue()).toBe("meet:aa");
    now += 40_000;
    expect(pushHeartbeatHeaderValue()).toBeNull();
    expect(storage.data.has("wgw.rtc.pushPeers.other")).toBe(false);
    expect(storage.data.has("wgw.rtc.pushPeers.crashed")).toBe(false);
    expect(storage.data.has("unrelated")).toBe(true);
  });

  it("publishes this tab's peers for the stream tab and removes them on release", () => {
    const storage = memoryStorage();
    resetPushHeartbeatPeersForTests(() => storage);

    const first = registerPushHeartbeatPeer("meet", "0123456789abcdef");
    const again = registerPushHeartbeatPeer("meet", "0123456789abcdef");
    expect([...storage.data.values()].map((raw) => JSON.parse(raw).peers)).toEqual([
      ["meet:0123456789abcdef"],
    ]);

    first();
    expect(storage.data.size).toBe(1);
    again();
    expect(storage.data.size).toBe(0);
  });

  it("registers nothing for a channel the server does not refresh", () => {
    resetPushHeartbeatPeersForTests(() => null);
    registerPushHeartbeatPeer("chat", "peer-1");
    registerPushHeartbeatPeer("sheet", "peer-2");
    expect(pushHeartbeatHeaderValue()).toBeNull();
  });

  it("covers a peer only when the capped header names it", () => {
    const storage = memoryStorage();
    const now = 100_000;
    resetPushHeartbeatPeersForTests(
      () => storage,
      () => now,
    );
    const others = Array.from(
      { length: 32 },
      (_, index) => `collab:${index.toString(16).padStart(16, "0")}`,
    );
    storage.setItem("wgw.rtc.pushPeers.other", JSON.stringify({ at: now, peers: others }));

    registerPushHeartbeatPeer("principal", "me-1");
    registerPushHeartbeatPeer("collab", "0000000000000001");

    expect(pushHeartbeatHeaderValue()?.split(",")).toHaveLength(32);
    // Sorted: "collab:…" ids fill the 32 slots before "principal:…".
    expect(pushHeartbeatIncludes("collab", "0000000000000001")).toBe(true);
    expect(pushHeartbeatIncludes("principal", "me-1")).toBe(false);
  });
});
