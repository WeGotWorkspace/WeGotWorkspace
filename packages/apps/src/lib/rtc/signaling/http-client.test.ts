import { describe, expect, it, vi } from "vitest";
import {
  HttpSignalingClient,
  isUnchangedPollResponse,
  type HttpSignalingFetch,
} from "@/lib/rtc/signaling/http-client";

describe("HttpSignalingClient", () => {
  it("posts join and polls events on room session paths", async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("/participants") && init.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.room).toBe("room-a");
        expect(body.name).toBe("Alice");
        return new Response(JSON.stringify({ peerId: "p1", peers: [] }), { status: 200 });
      }
      if (url.includes("/events") && init.method === "GET") {
        expect(url).toContain("peerId=p1");
        expect(url).toContain("since=3");
        return new Response(JSON.stringify({ peers: [{ id: "p2", name: "Bob" }], messages: [] }), {
          status: 200,
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const client = new HttpSignalingClient({
      channel: "collab",
      apiBase: "/api/v1/rooms",
      fetchImpl,
      getAuth: () => ({ bearerToken: "token-1" }),
    });

    const joined = await client.join({ room: "room-a", name: "Alice" });
    expect(joined.peerId).toBe("p1");

    const poll = await client.poll({ room: "room-a", peerId: "p1", since: 3 });
    expect(isUnchangedPollResponse(poll)).toBe(false);
    if (!isUnchangedPollResponse(poll)) {
      expect(poll.peers).toHaveLength(1);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends the roster signature and maps 204 to an unchanged poll response", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("sig=sig-abc");
      return new Response(null, { status: 204 });
    });

    const client = new HttpSignalingClient({
      channel: "meet",
      apiBase: "/api/v1/rooms",
      fetchImpl,
      getAuth: () => ({}),
    });

    const poll = await client.poll({
      room: "abcd-efgh-ijkl",
      peerId: "p1",
      since: 0,
      sig: "sig-abc",
    });

    expect(isUnchangedPollResponse(poll)).toBe(true);
  });

  it("passes rosterSig through on full poll responses", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ peers: [], messages: [], rosterSig: "sig-next" }), {
          status: 200,
        }),
    );

    const client = new HttpSignalingClient({
      channel: "meet",
      apiBase: "/api/v1/rooms",
      fetchImpl,
      getAuth: () => ({}),
    });

    const poll = await client.poll({ room: "abcd-efgh-ijkl", peerId: "p1" });

    expect(isUnchangedPollResponse(poll)).toBe(false);
    if (!isUnchangedPollResponse(poll)) {
      expect(poll.rosterSig).toBe("sig-next");
    }
  });

  it("includes session key on meet guest sends", async () => {
    const fetchImpl = vi.fn<HttpSignalingFetch>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = new HttpSignalingClient({
      channel: "meet",
      apiBase: "/api/v1/rooms",
      fetchImpl,
      getAuth: () => ({ sessionKey: "guest-key" }),
    });
    await client.send({
      room: "abcd-efgh-ijkl",
      from: "self",
      to: "peer",
      type: "ice",
      payload: { candidate: "candidate:1 1 udp" },
    });
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    expect(String(call![0])).toContain("/rooms/abcd-efgh-ijkl/events");
    const body = JSON.parse(String(call![1]?.body)) as Record<string, unknown>;
    expect(body.sessionKey).toBe("guest-key");
  });

  it("sends leave with keepalive so a pagehide leave can finish", async () => {
    const fetchImpl = vi.fn<HttpSignalingFetch>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const client = new HttpSignalingClient({
      channel: "collab",
      apiBase: "/api/v1/rooms",
      fetchImpl,
    });
    await client.leave({ room: "docs/x.md", peerId: "aaaaaaaaaaaaaaaa" });
    expect(fetchImpl.mock.calls[0]?.[1]?.keepalive).toBe(true);
  });
});
