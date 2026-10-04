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

  it("includes the browser id on meet join", async () => {
    const fetchImpl = vi.fn<HttpSignalingFetch>(
      async () => new Response(JSON.stringify({ peers: [] }), { status: 200 }),
    );
    const client = new HttpSignalingClient({
      channel: "meet",
      apiBase: "/api/v1/rooms",
      fetchImpl,
      getBrowserId: () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    await client.join({ room: "abcd-efgh-ijkl", name: "Alice", peerId: "peer-1" });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.browserId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(body.peerId).toBe("peer-1");
  });

  it("includes the guest session key on join so admit rename keeps the owner marker", async () => {
    const fetchImpl = vi.fn<HttpSignalingFetch>(
      async () => new Response(JSON.stringify({ peers: [] }), { status: 200 }),
    );
    const client = new HttpSignalingClient({
      channel: "meet",
      apiBase: "/api/v1/rooms",
      fetchImpl,
      getAuth: () => ({}),
    });
    await client.join({
      room: "chat-test",
      name: "Ada",
      peerId: "peer-guest",
      sessionKey: "guest-session-key",
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.sessionKey).toBe("guest-session-key");
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

  it("advertises the configured caps on join", async () => {
    const fetchImpl = vi.fn<HttpSignalingFetch>(
      async () => new Response(JSON.stringify({ peers: [] }), { status: 200 }),
    );
    const client = new HttpSignalingClient({
      channel: "meet",
      apiBase: "/api/v1/rooms",
      fetchImpl,
      caps: ["since-ack"],
    });
    await client.join({ room: "abcd-efgh-ijkl", name: "Alice", peerId: "peer-1" });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.caps).toEqual(["since-ack"]);
  });

  it("omits caps entirely when none are configured", async () => {
    const fetchImpl = vi.fn<HttpSignalingFetch>(
      async () => new Response(JSON.stringify({ peers: [] }), { status: 200 }),
    );
    const client = new HttpSignalingClient({
      channel: "collab",
      apiBase: "/api/v1/rooms",
      fetchImpl,
    });
    await client.join({ room: "docs/x.md", name: "Alice" });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("caps");
  });

  it("aborts a poll that hangs past the ten second budget", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const controller = new AbortController();
    timeout.mockReturnValue(controller.signal);

    const fetchImpl = vi.fn<HttpSignalingFetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const client = new HttpSignalingClient({
      channel: "meet",
      apiBase: "/api/v1/rooms",
      fetchImpl,
    });

    const pending = client.poll({ room: "abcd-efgh-ijkl", peerId: "p1" });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);

    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/i);

    timeout.mockRestore();
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

  it("posts a session sample to /rtc/metrics without the room name", async () => {
    const fetchImpl = vi.fn<HttpSignalingFetch>(async () => new Response(null, { status: 202 }));
    const client = new HttpSignalingClient({
      channel: "meet",
      apiBase: "/api/v1/rooms",
      fetchImpl,
      getAuth: () => ({ bearerToken: "token-1", sessionKey: "a".repeat(32) }),
    });
    await client.reportSessionMetric({ channel: "meet", joinMs: 10 }, "b".repeat(32));
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`/api/v1/rtc/metrics?sessionKey=${"b".repeat(32)}`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ channel: "meet", joinMs: 10 });
    expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toBe(
      "Bearer token-1",
    );
  });
});
