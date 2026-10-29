import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPushMessage,
  JmapPushHub,
  type EventSourceContext,
  type PushMessage,
} from "./jmap-push-hub";
import { FakeCrossTabBus } from "./mock/fake-cross-tab-bus";
import { FakeWebLocks } from "./mock/fake-web-locks";
import type { PushSink, PushTransport, StateChange } from "./push-transport";

const H1 = "1".repeat(32);
const H2 = "2".repeat(32);
const HC = "c".repeat(32);

/** Let cross-tab messages (one task each) and lock hand-overs run. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

type FakeEventSource = {
  ctx: EventSourceContext;
  sink: PushSink | null;
  stopped: boolean;
  reconnectNow: ReturnType<typeof vi.fn<(reason: string) => void>>;
};

function visibility(initial = true) {
  const listeners = new Set<() => void>();
  let visible = initial;
  return {
    visible: () => visible,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: boolean) {
      visible = next;
      for (const listener of listeners) listener();
    },
  };
}

function browser() {
  const locks = new FakeWebLocks();
  const bus = new FakeCrossTabBus<PushMessage>();
  const streams: FakeEventSource[] = [];
  const hubs: JmapPushHub[] = [];
  const tab = (
    tabId: string,
    opts: { visible?: boolean; wakeTransports?: () => PushTransport[]; noLocks?: boolean } = {},
  ) => {
    const view = visibility(opts.visible ?? true);
    const hub = new JmapPushHub({
      tabId,
      topic: bus.topic(),
      locks: opts.noLocks ? null : locks.client(tabId),
      visibility: view,
      createEventSource: (ctx) => {
        const stream: FakeEventSource = {
          ctx,
          sink: null,
          stopped: false,
          reconnectNow: vi.fn<(reason: string) => void>(),
        };
        streams.push(stream);
        return {
          start(sink) {
            stream.sink = sink;
            return () => {
              stream.stopped = true;
            };
          },
          reconnectNow: stream.reconnectNow,
        };
      },
      wakeTransports: opts.wakeTransports,
    });
    hubs.push(hub);
    return { hub, view };
  };
  const live = () => streams.filter((stream) => !stream.stopped);
  return { locks, bus, streams, live, tab, hubs };
}

const change = (states: Record<string, string>): StateChange => ({
  "@type": "StateChange",
  changed: { alice: states },
});

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

describe("JmapPushHub", () => {
  it("opens one stream per browser, in the tab that holds the lock", async () => {
    const b = browser();
    const a = b.tab("a");
    const c = b.tab("c");
    cleanup.push(a.hub.subscribe(["Note"], vi.fn()), c.hub.subscribe(["Note"], vi.fn()));
    await settle();
    expect(b.streams).toHaveLength(1);
    expect(b.locks.holder("wgw-jmap-push/leader")).toBe("a");
  });

  it("opens no stream while nothing subscribes", async () => {
    const b = browser();
    b.tab("a");
    await settle();
    expect(b.streams).toHaveLength(0);
  });

  it("fans a StateChange out to every tab once, the leader included", async () => {
    const b = browser();
    const a = b.tab("a");
    const c = b.tab("c");
    const inA = vi.fn(async () => true);
    const inC = vi.fn(async () => true);
    cleanup.push(a.hub.subscribe(["Note"], inA), c.hub.subscribe(["Note"], inC));
    await settle();

    b.live()[0]!.sink!.deliver(change({ Note: "n2" }), `v1;Note=${H1}`);
    await settle();
    expect(inA.mock.calls).toEqual([[{ Note: "n2" }, "alice"]]);
    expect(inC.mock.calls).toEqual([[{ Note: "n2" }, "alice"]]);
  });

  it("only passes a listener the types it subscribed to", async () => {
    const b = browser();
    const a = b.tab("a");
    const notes = vi.fn(async () => true);
    cleanup.push(a.hub.subscribe(["Note"], notes));
    await settle();
    b.live()[0]!.sink!.deliver(change({ Calendar: "c2" }), `v1;Calendar=${HC}`);
    await settle();
    expect(notes).not.toHaveBeenCalled();
  });

  describe("confirmed hashes", () => {
    it("rebuilds Last-Event-ID from what every subscribed tab confirmed", async () => {
      const b = browser();
      const a = b.tab("a");
      const c = b.tab("c");
      let cOk = false;
      cleanup.push(
        a.hub.subscribe(["Note"], async () => true),
        c.hub.subscribe(["Note"], async () => cOk),
      );
      await settle();
      const stream = b.live()[0]!;
      expect(await stream.ctx.lastEventId()).toBeNull();

      stream.sink!.deliver(change({ Note: "n1", Calendar: "c1" }), `v1;Calendar=${HC};Note=${H1}`);
      await settle();
      // Tab c failed its sync: Note stays out, Calendar has no subscriber and counts as confirmed.
      expect(await stream.ctx.lastEventId()).toBe(`v1;Calendar=${HC}`);

      cOk = true;
      stream.sink!.deliver(change({ Note: "n1" }), `v1;Calendar=${HC};Note=${H1}`);
      await settle();
      expect(await stream.ctx.lastEventId()).toBe(`v1;Calendar=${HC};Note=${H1}`);
    });

    it("a new leader reconnects with the id rebuilt from its own copy", async () => {
      const b = browser();
      const a = b.tab("a");
      const c = b.tab("c");
      const leaveA = a.hub.subscribe(["Note"], async () => true);
      cleanup.push(c.hub.subscribe(["Note"], async () => true));
      await settle();
      b.live()[0]!.sink!.deliver(change({ Note: "n2" }), `v1;Note=${H2}`);
      await settle();

      leaveA();
      await settle();
      expect(b.streams).toHaveLength(2);
      const next = b.live();
      expect(next).toHaveLength(1);
      expect(b.locks.holder("wgw-jmap-push/leader")).toBe("c");
      expect(await next[0]!.ctx.lastEventId()).toBe(`v1;Note=${H2}`);
    });

    it("a new leader without a copy sends no id", async () => {
      const b = browser();
      const a = b.tab("a");
      const leaveA = a.hub.subscribe(["Note"], async () => true);
      await settle();
      b.live()[0]!.sink!.deliver(change({ Note: "n2" }), `v1;Note=${H2}`);
      await settle();
      leaveA();
      await settle();

      const late = b.tab("late");
      cleanup.push(late.hub.subscribe(["Note"], async () => true));
      await settle();
      expect(await b.live()[0]!.ctx.lastEventId()).toBeNull();
    });

    it("ignores a tab that crashed without saying bye", async () => {
      const b = browser();
      const a = b.tab("a");
      const c = b.tab("c");
      cleanup.push(
        a.hub.subscribe(["Note"], async () => true),
        c.hub.subscribe(["Note"], async () => false),
      );
      await settle();
      const stream = b.live()[0]!;
      stream.sink!.deliver(change({ Note: "n1" }), `v1;Note=${H1}`);
      await settle();
      expect(await stream.ctx.lastEventId()).toBeNull();

      b.locks.crash("c");
      expect(await stream.ctx.lastEventId()).toBe(`v1;Note=${H1}`);
    });

    it("forgets a tab that unsubscribed", async () => {
      const b = browser();
      const a = b.tab("a");
      const c = b.tab("c");
      cleanup.push(a.hub.subscribe(["Note"], async () => true));
      const leaveC = c.hub.subscribe(["Note"], async () => false);
      await settle();
      const stream = b.live()[0]!;
      stream.sink!.deliver(change({ Note: "n1" }), `v1;Note=${H1}`);
      await settle();
      leaveC();
      await settle();
      expect(await stream.ctx.lastEventId()).toBe(`v1;Note=${H1}`);
    });
  });

  describe("visibility", () => {
    it("reports every tab hidden only when no subscribed tab is visible", async () => {
      const b = browser();
      const a = b.tab("a", { visible: false });
      const c = b.tab("c", { visible: true });
      cleanup.push(a.hub.subscribe(["Note"], vi.fn()), c.hub.subscribe(["Note"], vi.fn()));
      await settle();
      const stream = b.live()[0]!;
      expect(await stream.ctx.everyTabHidden()).toBe(false);
      c.view.set(false);
      await settle();
      expect(await stream.ctx.everyTabHidden()).toBe(true);
    });

    it("a tab that becomes visible wakes the leader", async () => {
      const b = browser();
      const a = b.tab("a");
      const c = b.tab("c", { visible: false });
      cleanup.push(a.hub.subscribe(["Note"], vi.fn()), c.hub.subscribe(["Note"], vi.fn()));
      await settle();
      c.view.set(true);
      await settle();
      expect(b.live()[0]!.reconnectNow).toHaveBeenCalledWith("visible");
    });
  });

  describe("transports", () => {
    it("lets a wake-only transport wake the stream but never deliver", async () => {
      const b = browser();
      let meshSink: PushSink | null = null;
      const stopMesh = vi.fn();
      const mesh: PushTransport = {
        start(sink) {
          meshSink = sink;
          return stopMesh;
        },
      };
      const a = b.tab("a", { wakeTransports: () => [mesh] });
      const listener = vi.fn(async () => true);
      const leave = a.hub.subscribe(["Note"], listener);
      await settle();

      meshSink!.wake("check-now");
      expect(b.live()[0]!.reconnectNow).toHaveBeenCalledWith("check-now");
      meshSink!.deliver(change({ Note: "forged" }), `v1;Note=${H1}`);
      await settle();
      expect(listener).not.toHaveBeenCalled();

      leave();
      await settle();
      expect(stopMesh).toHaveBeenCalled();
    });

    it("a wake in another tab reaches the leader", async () => {
      const b = browser();
      const a = b.tab("a");
      const c = b.tab("c");
      cleanup.push(a.hub.subscribe(["Note"], vi.fn()), c.hub.subscribe(["Note"], vi.fn()));
      await settle();
      c.hub.wake("saved");
      await settle();
      expect(b.live()[0]!.reconnectNow).toHaveBeenCalledWith("saved");
    });
  });

  describe("status", () => {
    it("shares push connected or down with every tab", async () => {
      const b = browser();
      const a = b.tab("a");
      const c = b.tab("c");
      const seen = vi.fn();
      cleanup.push(
        a.hub.subscribe(["Note"], vi.fn()),
        c.hub.subscribe(["Note"], vi.fn()),
        c.hub.subscribeStatus(seen),
      );
      await settle();
      expect(c.hub.connected).toBe(false);

      b.live()[0]!.ctx.onStatus(true);
      await settle();
      expect(a.hub.connected).toBe(true);
      expect(c.hub.connected).toBe(true);
      expect(seen).toHaveBeenLastCalledWith(true);

      b.live()[0]!.ctx.onStatus(false);
      await settle();
      expect(c.hub.connected).toBe(false);
    });

    it("a tab that joins later learns the current status", async () => {
      const b = browser();
      const a = b.tab("a");
      cleanup.push(a.hub.subscribe(["Note"], vi.fn()));
      await settle();
      b.live()[0]!.ctx.onStatus(true);
      await settle();

      const late = b.tab("late");
      cleanup.push(late.hub.subscribe(["Note"], vi.fn()));
      await settle();
      expect(late.hub.connected).toBe(true);
    });

    it("a tab whose hub stopped reports push down", async () => {
      const b = browser();
      const a = b.tab("a");
      const leave = a.hub.subscribe(["Note"], vi.fn());
      await settle();
      b.live()[0]!.ctx.onStatus(true);
      leave();
      expect(a.hub.connected).toBe(false);
    });
  });

  it("without Web Locks it opens no stream and the apps keep polling", async () => {
    const b = browser();
    const a = b.tab("a", { noLocks: true });
    const listener = vi.fn();
    cleanup.push(a.hub.subscribe(["Note"], listener));
    await settle();
    expect(b.streams).toHaveLength(0);
    expect(a.hub.connected).toBe(false);
  });

  it("stops calling a listener after it unsubscribed", async () => {
    const b = browser();
    const a = b.tab("a");
    const c = b.tab("c");
    const inC = vi.fn(async () => true);
    cleanup.push(
      a.hub.subscribe(
        ["Note"],
        vi.fn(async () => true),
      ),
    );
    const leaveC = c.hub.subscribe(["Note"], inC);
    await settle();
    leaveC();
    b.live()[0]!.sink!.deliver(change({ Note: "n3" }), `v1;Note=${H1}`);
    await settle();
    expect(inC).not.toHaveBeenCalled();
  });
});

describe("isPushMessage", () => {
  it("accepts hub messages and drops anything else on the channel", () => {
    expect(isPushMessage({ v: 1, kind: "wake", reason: "x" })).toBe(true);
    expect(isPushMessage({ v: 2, kind: "wake" })).toBe(false);
    expect(isPushMessage({ v: 1, kind: "other" })).toBe(false);
    expect(isPushMessage(null)).toBe(false);
  });
});
