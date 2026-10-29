import { describe, expect, it, vi } from "vitest";
import { FakeCrossTabBus } from "@/lib/jmap-client/push/mock/fake-cross-tab-bus";
import { FakeWebLocks } from "@/lib/jmap-client/push/mock/fake-web-locks";
import { InboxFanOut, isInboxMessage, type InboxMessage } from "./inbox-fan-out";

const tick = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const payload = {
  list: [
    {
      id: "n1",
      domain: "chat",
      action: "message_posted",
      title: "t",
      body: "b",
      navigate: "/meet",
      tag: null,
      readAt: null,
      createdAt: "2026-10-29T12:00:00Z",
    },
  ],
  unreadCount: 1,
};

function browser() {
  const locks = new FakeWebLocks();
  const bus = new FakeCrossTabBus<InboxMessage>();
  const tab = (id: string) => new InboxFanOut({ locks: locks.client(id), topic: bus.topic() });
  return { locks, tab };
}

describe("InboxFanOut", () => {
  it("lets one tab lead the inbox fetch and hands over when it leaves", async () => {
    const b = browser();
    const a = b.tab("a");
    const c = b.tab("c");
    const leaveA = a.start();
    const leaveC = c.start();
    await tick();
    expect(a.leading).toBe(true);
    expect(c.leading).toBe(false);

    leaveA();
    await tick();
    expect(a.leading).toBe(false);
    expect(c.leading).toBe(true);
    leaveC();
  });

  it("shares a fetched inbox with the other tabs only", async () => {
    const b = browser();
    const a = b.tab("a");
    const c = b.tab("c");
    const inA = vi.fn();
    const inC = vi.fn();
    const stops = [a.start(), c.start(), a.onShared(inA), c.onShared(inC)];
    await tick();

    a.share(payload);
    await tick();
    expect(inA).not.toHaveBeenCalled();
    expect(inC).toHaveBeenCalledWith(payload);
    for (const stop of stops) stop();
  });

  it("counts starts, so two providers in one tab share one lock", async () => {
    const b = browser();
    const a = b.tab("a");
    const first = a.start();
    const second = a.start();
    await tick();
    first();
    await tick();
    expect(a.leading).toBe(true);
    second();
    await tick();
    expect(a.leading).toBe(false);
  });

  it("without Web Locks every tab fetches for itself", () => {
    const bus = new FakeCrossTabBus<InboxMessage>();
    const solo = new InboxFanOut({ locks: null, topic: bus.topic() });
    expect(solo.leading).toBe(true);
  });
});

describe("isInboxMessage", () => {
  it("accepts an inbox payload and drops anything else", () => {
    expect(isInboxMessage({ v: 1, kind: "inbox", ...payload })).toBe(true);
    expect(isInboxMessage({ v: 1, kind: "inbox", list: "x", unreadCount: 1 })).toBe(false);
    expect(isInboxMessage({ v: 2, kind: "inbox", ...payload })).toBe(false);
    expect(isInboxMessage(null)).toBe(false);
  });
});
