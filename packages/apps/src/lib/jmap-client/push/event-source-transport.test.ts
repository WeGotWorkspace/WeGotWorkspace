import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourceTransport, type EventSourceTransportOptions } from "./event-source-transport";
import type { PushSink } from "./push-transport";

const ID = "v1;Note=" + "a".repeat(32);

function sse(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8", ...init.headers },
  });
}

const stateBody = (retry = 3000) =>
  `event: state\nid: ${ID}\nretry: ${retry}\ndata: ${JSON.stringify({
    "@type": "StateChange",
    changed: { alice: { Note: "n2" } },
  })}\n\n`;

function connectivity(online = true) {
  const listeners = new Set<(online: boolean) => void>();
  let current = online;
  return {
    online: () => current,
    subscribe: (listener: (online: boolean) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: boolean) {
      current = next;
      for (const listener of listeners) listener(next);
    },
  };
}

function setup(overrides: Partial<EventSourceTransportOptions> = {}) {
  const net = connectivity();
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => sse("retry: 3000\n\n"));
  const onStatus = vi.fn();
  const sink = {
    deliver: vi.fn<PushSink["deliver"]>(),
    wake: vi.fn<PushSink["wake"]>(),
  };
  const options: EventSourceTransportOptions = {
    url: "/jmap/events/*/state/0",
    fetch,
    lastEventId: () => null,
    onStatus,
    connectivity: net,
    refreshAuth: vi.fn(async () => undefined),
    ...overrides,
  };
  const transport = new EventSourceTransport(options);
  return { transport, fetch: options.fetch as typeof fetch, onStatus, sink, net, options };
}

const at = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.length;

describe("EventSourceTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads one short burst, delivers the StateChange with its id and reconnects after retry", async () => {
    const { transport, fetch, sink, onStatus } = setup({
      lastEventId: () => "v1;Note=" + "b".repeat(32),
    });
    fetch.mockResolvedValueOnce(sse(stateBody(4000)));
    const stop = transport.start(sink);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/jmap/events/*/state/0");
    const headers = new Headers(init.headers);
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Last-Event-ID")).toBe("v1;Note=" + "b".repeat(32));
    expect(sink.deliver).toHaveBeenCalledWith(
      { "@type": "StateChange", changed: { alice: { Note: "n2" } } },
      ID,
    );
    expect(onStatus.mock.calls).toEqual([[true]]);

    await vi.advanceTimersByTimeAsync(3999);
    expect(at(fetch)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(at(fetch)).toBe(2);
    stop();
  });

  it("resolves the url lazily and stays off when the session has no event source", async () => {
    const { transport, fetch, sink, onStatus } = setup({ url: async () => null });
    const stop = transport.start(sink);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(onStatus.mock.calls).toEqual([[false]]);
    stop();

    const lazy = setup({ url: async () => "/jmap/events/*/state/0" });
    const stopLazy = lazy.transport.start(lazy.sink);
    await vi.advanceTimersByTimeAsync(0);
    expect(lazy.fetch.mock.calls[0]![0]).toBe("/jmap/events/*/state/0");
    stopLazy();
  });

  it("sends no Last-Event-ID without confirmed hashes", async () => {
    const { transport, fetch, sink } = setup();
    const stop = transport.start(sink);
    await vi.advanceTimersByTimeAsync(0);
    expect(new Headers(fetch.mock.calls[0]![1].headers).has("Last-Event-ID")).toBe(false);
    stop();
  });

  it("rebuilds Last-Event-ID on every reconnect", async () => {
    let id = "v1";
    const { transport, fetch, sink } = setup({ lastEventId: async () => id });
    const stop = transport.start(sink);
    await vi.advanceTimersByTimeAsync(0);
    id = ID;
    await vi.advanceTimersByTimeAsync(3000);
    expect(new Headers(fetch.mock.calls[1]![1].headers).get("Last-Event-ID")).toBe(ID);
    stop();
  });

  it("waits longer while every tab is hidden", async () => {
    const { transport, fetch, sink } = setup({ everyTabHidden: () => true });
    const stop = transport.start(sink);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(at(fetch)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(at(fetch)).toBe(2);
    stop();
  });

  it("ignores a data event that is not a StateChange", async () => {
    const { transport, fetch, sink, onStatus } = setup();
    fetch.mockResolvedValueOnce(sse("event: state\ndata: {oops\n\nevent: state\ndata: [1]\n\n"));
    const stop = transport.start(sink);
    await vi.advanceTimersByTimeAsync(0);
    expect(sink.deliver).not.toHaveBeenCalled();
    expect(onStatus.mock.calls).toEqual([[true]]);
    stop();
  });

  describe("wake", () => {
    it("reconnects early, but not sooner than the wake gap after the last request", async () => {
      const { transport, fetch, sink } = setup();
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(500);
      transport.reconnectNow("check-now");
      await vi.advanceTimersByTimeAsync(1499);
      expect(at(fetch)).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(at(fetch)).toBe(2);
      stop();
    });

    it("a wake during a request queues one more request after it", async () => {
      const { transport, fetch, sink } = setup();
      let finish!: (response: Response) => void;
      fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(0);
      transport.reconnectNow("check-now");
      transport.reconnectNow("check-now");
      await vi.advanceTimersByTimeAsync(2500);
      finish(sse("retry: 3000\n\n"));
      await vi.advanceTimersByTimeAsync(0);
      expect(at(fetch)).toBe(2);
      stop();
    });
  });

  describe("failures", () => {
    it("on 429 waits Retry-After, reports push down and ignores wakes meanwhile", async () => {
      const { transport, fetch, sink, onStatus } = setup();
      fetch
        .mockResolvedValueOnce(sse("retry: 3000\n\n"))
        .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "30" } }));
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(3000);
      expect(onStatus.mock.calls).toEqual([[true], [false]]);

      transport.reconnectNow("check-now");
      await vi.advanceTimersByTimeAsync(29_999);
      expect(at(fetch)).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(at(fetch)).toBe(3);
      await vi.advanceTimersByTimeAsync(0);
      expect(onStatus.mock.calls).toEqual([[true], [false], [true]]);
      stop();
    });

    it("on 429 without Retry-After backs off", async () => {
      const { transport, fetch, sink } = setup();
      fetch.mockResolvedValueOnce(new Response("", { status: 429 }));
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(2999);
      expect(at(fetch)).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(at(fetch)).toBe(2);
      stop();
    });

    it("on 501 treats push as unavailable and asks again much later", async () => {
      const { transport, fetch, sink, onStatus } = setup();
      fetch.mockResolvedValue(new Response("", { status: 501 }));
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(0);
      expect(onStatus.mock.calls).toEqual([[false]]);
      expect(sink.deliver).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(299_999);
      expect(at(fetch)).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(at(fetch)).toBe(2);
      stop();
    });

    it("treats a response that is not an event stream as unavailable", async () => {
      const { transport, fetch, sink, onStatus } = setup();
      fetch.mockResolvedValue(
        new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }),
      );
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(0);
      expect(onStatus.mock.calls).toEqual([[false]]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(at(fetch)).toBe(1);
      stop();
    });

    it("backs off on repeated failures and reports push down from the second one", async () => {
      const { transport, fetch, sink, onStatus } = setup();
      fetch
        .mockResolvedValueOnce(sse("retry: 3000\n\n"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(new Response("", { status: 503 }))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3000); // 2nd: first failure
      expect(onStatus.mock.calls).toEqual([[true]]);
      await vi.advanceTimersByTimeAsync(3000); // 3rd after 3 s: second failure
      expect(at(fetch)).toBe(3);
      expect(onStatus.mock.calls).toEqual([[true], [false]]);
      await vi.advanceTimersByTimeAsync(5999);
      expect(at(fetch)).toBe(3);
      await vi.advanceTimersByTimeAsync(1); // 4th after 6 s
      expect(at(fetch)).toBe(4);
      await vi.advanceTimersByTimeAsync(12_000); // 5th after 12 s: success
      expect(at(fetch)).toBe(5);
      expect(onStatus.mock.calls).toEqual([[true], [false], [true]]);
      stop();
    });

    it("caps the backoff", async () => {
      const { transport, fetch, sink } = setup();
      fetch.mockRejectedValue(new TypeError("Failed to fetch"));
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(3000 + 6000 + 12_000 + 24_000 + 48_000);
      expect(at(fetch)).toBe(6);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(at(fetch)).toBe(6);
      await vi.advanceTimersByTimeAsync(1);
      expect(at(fetch)).toBe(7);
      stop();
    });

    it("refreshes the session on a 401 before it reconnects", async () => {
      const refreshAuth = vi.fn(async () => undefined);
      const { transport, fetch, sink } = setup({ refreshAuth });
      fetch.mockResolvedValueOnce(new Response("", { status: 401 }));
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshAuth).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(at(fetch)).toBe(2);
      stop();
    });
  });

  describe("connectivity", () => {
    it("stops while offline and reconnects at once when back online", async () => {
      const { transport, fetch, sink, onStatus, net } = setup();
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(0);
      net.set(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(at(fetch)).toBe(1);
      expect(onStatus.mock.calls).toEqual([[true], [false]]);

      net.set(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(at(fetch)).toBe(2);
      stop();
    });

    it("does not start a request while offline", async () => {
      const { transport, fetch, sink, net } = setup();
      net.set(false);
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(at(fetch)).toBe(0);
      stop();
    });

    it("aborts the request in flight when the browser goes offline", async () => {
      const { transport, fetch, sink, net } = setup();
      let signal: AbortSignal | undefined;
      fetch.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init.signal ?? undefined;
            signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const stop = transport.start(sink);
      await vi.advanceTimersByTimeAsync(0);
      net.set(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(signal?.aborted).toBe(true);
      stop();
    });
  });

  it("stop ends the loop and aborts the request in flight", async () => {
    const { transport, fetch, sink } = setup();
    let signal: AbortSignal | undefined;
    fetch.mockImplementationOnce((_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const stop = transport.start(sink);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(at(fetch)).toBe(1);
  });
});
