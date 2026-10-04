import { describe, expect, it, vi } from "vitest";
import { createRtcSignalingClient } from "@/lib/rtc/signaling/create-client";
import type { HttpSignalingFetch } from "@/lib/rtc/signaling/http-client";

describe("createRtcSignalingClient caps", () => {
  it("advertises bin on collab and principal join", async () => {
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
      expect(body.caps).toEqual(["bin"]);
    }
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
});
