import { afterEach, describe, expect, it } from "vitest";
import {
  pushHeartbeatHeaderValue,
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
    registerPushHeartbeatPeer("collab", "peer-2");
    registerPushHeartbeatPeer("principal", "peer-3");
    expect(pushHeartbeatHeaderValue()).toBeNull();
  });
});
