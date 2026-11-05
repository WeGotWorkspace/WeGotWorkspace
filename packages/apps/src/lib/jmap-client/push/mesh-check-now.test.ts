import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourceTransport } from "./event-source-transport";
import {
  MeshCheckNowTransport,
  meshLinked,
  registerMeshCheckNowPort,
  sendMeshCheckNow,
  subscribeMeshLinked,
  type MeshCheckNowPort,
} from "./mesh-check-now";

function fakePort() {
  const listeners = new Set<() => void>();
  const linkListeners = new Set<() => void>();
  const sent: string[][] = [];
  let linked = false;
  const port: MeshCheckNowPort = {
    sendCheckNow: (usernames) => sent.push([...usernames]),
    subscribeCheckNow: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    meshLinked: () => linked,
    subscribeMeshLinked: (listener) => {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
  };
  const setLinked = (next: boolean) => {
    linked = next;
    linkListeners.forEach((listener) => listener());
  };
  return {
    port,
    sent,
    receive: () => listeners.forEach((listener) => listener()),
    listeners,
    linkListeners,
    setLinked,
  };
}

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

describe("mesh check-now port", () => {
  it("sends nothing without a mesh, and through the registered port with one", () => {
    sendMeshCheckNow(["bob"]);
    const mesh = fakePort();
    cleanup.push(registerMeshCheckNowPort(mesh.port));
    sendMeshCheckNow([]);
    sendMeshCheckNow(["bob"]);
    expect(mesh.sent).toEqual([["bob"]]);
  });

  it("the transport wakes its sink, also for a mesh that registers after it started", () => {
    const wake = vi.fn();
    const stop = new MeshCheckNowTransport().start({ deliver: vi.fn(), wake });
    cleanup.push(stop);
    const mesh = fakePort();
    cleanup.push(registerMeshCheckNowPort(mesh.port));

    mesh.receive();
    expect(wake).toHaveBeenCalledWith("check-now");

    stop();
    mesh.receive();
    expect(wake).toHaveBeenCalledTimes(1);
    expect(mesh.listeners.size).toBe(0);
  });

  it("mesh linked follows the registered port, also across store swaps", () => {
    const changes = vi.fn();
    cleanup.push(subscribeMeshLinked(changes));
    expect(meshLinked()).toBe(false);

    const first = fakePort();
    const unregisterFirst = registerMeshCheckNowPort(first.port);
    expect(changes).toHaveBeenCalledTimes(1);
    first.setLinked(true);
    expect(meshLinked()).toBe(true);
    expect(changes).toHaveBeenCalledTimes(2);

    unregisterFirst();
    expect(meshLinked()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(3);
    expect(first.linkListeners.size).toBe(0);

    const second = fakePort();
    cleanup.push(registerMeshCheckNowPort(second.port));
    second.setLinked(true);
    expect(meshLinked()).toBe(true);
    expect(changes).toHaveBeenCalledTimes(5);
  });

  it("an old port's unregister does not drop a newer port", () => {
    const first = fakePort();
    const second = fakePort();
    const unregisterFirst = registerMeshCheckNowPort(first.port);
    cleanup.push(registerMeshCheckNowPort(second.port));
    unregisterFirst();
    sendMeshCheckNow(["bob"]);
    expect(second.sent).toEqual([["bob"]]);
  });
});

describe("mesh check-now reconnects the event source", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function stream() {
    const fetch = vi.fn(
      async () =>
        new Response("retry: 3000\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    );
    const transport = new EventSourceTransport({
      url: "/jmap/events/*/state/0",
      fetch,
      lastEventId: () => null,
      connectivity: { online: () => true, subscribe: () => () => undefined },
      // As wired in `lib/api/wgw/jmap-push.ts`.
      mesh: { linked: meshLinked, subscribe: subscribeMeshLinked },
    });
    const sink = { deliver: vi.fn(), wake: (reason: string) => transport.reconnectNow(reason) };
    const mesh = fakePort();
    cleanup.push(registerMeshCheckNowPort(mesh.port));
    cleanup.push(transport.start(sink));
    cleanup.push(new MeshCheckNowTransport().start(sink));
    return { fetch, mesh };
  }

  it("asks the server at once instead of waiting for retry", async () => {
    const { fetch, mesh } = stream();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    mesh.receive();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits 5 s while the presence mesh has held a link, 3 s once it is lost", async () => {
    const { fetch, mesh } = stream();
    mesh.setLinked(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(11);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(13);

    mesh.setLinked(false);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetch).toHaveBeenCalledTimes(16);
  });

  it("allows at most one early reconnect per 2 s, however many peers nudge", async () => {
    const { fetch, mesh } = stream();
    await vi.advanceTimersByTimeAsync(2_000);
    for (let i = 0; i < 10; i++) mesh.receive();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 10; i++) mesh.receive();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
