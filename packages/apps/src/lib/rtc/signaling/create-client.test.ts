import { describe, expect, it, vi } from "vitest";
import { createRtcSignalingClient } from "@/lib/rtc/signaling/create-client";
import type { HttpSignalingFetch } from "@/lib/rtc/signaling/http-client";

describe("createRtcSignalingClient caps", () => {
  it("advertises bin on principal join and the docs caps on collab", async () => {
    const expected = {
      collab: ["bin", "yjs-http", "relay-jit"],
      principal: ["bin", "relay-jit"],
    } as const;
    for (const channel of ["collab", "principal"] as const) {
      const fetchImpl = vi.fn<HttpSignalingFetch>(
        async () => new Response(JSON.stringify({ peerId: "p1", peers: [] }), { status: 200 }),
      );
      const client = createRtcSignalingClient({
        channel,
        apiBase: "/api/v1/rooms",
        fetchImpl,
      });
      await client.join({ room: "docs/x.md", name: "Ada" });
      const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<
        string,
        unknown
      >;
      expect(body.caps).toEqual(expected[channel]);
    }
  });

  it("advertises meet-dc on meet join", async () => {
    const fetchImpl = vi.fn<HttpSignalingFetch>(
      async () => new Response(JSON.stringify({ peerId: "p1", peers: [] }), { status: 200 }),
    );
    const client = createRtcSignalingClient({
      channel: "meet",
      apiBase: "/api/v1/rooms",
      fetchImpl,
    });
    await client.join({ room: "room-1", name: "Ada" });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { caps: string[] };
    expect(body.caps).toContain("meet-dc");
    expect(body.caps).toEqual(["since-ack", "ice-batch", "relay-jit", "meet-dc"]);
  });

  it("sends the stored browser id on collab join", async () => {
    const store = new Map<string, string>([["wgw.rtc.browserId", "ab".repeat(16)]]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });
    const fetchImpl = vi.fn<HttpSignalingFetch>(
      async () => new Response(JSON.stringify({ peerId: "p1", peers: [] }), { status: 200 }),
    );
    const client = createRtcSignalingClient({
      channel: "collab",
      apiBase: "/api/v1/rooms",
      fetchImpl,
    });
    await client.join({ room: "docs/x.md", name: "Ada" });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.browserId).toBe("ab".repeat(16));
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("sends the stored browser id on principal join", async () => {
    const store = new Map<string, string>([["wgw.rtc.browserId", "cd".repeat(16)]]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      },
    });
    const fetchImpl = vi.fn<HttpSignalingFetch>(
      async () => new Response(JSON.stringify({ peerId: "p1", peers: [] }), { status: 200 }),
    );
    const client = createRtcSignalingClient({
      channel: "principal",
      apiBase: "/api/v1/rooms",
      fetchImpl,
    });
    await client.join({ room: "workspace", name: "Ada" });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.browserId).toBe("cd".repeat(16));
    Reflect.deleteProperty(globalThis, "localStorage");
  });
});
