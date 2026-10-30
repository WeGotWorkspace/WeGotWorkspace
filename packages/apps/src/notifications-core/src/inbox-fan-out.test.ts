import { describe, expect, it, vi } from "vitest";
import { FakeCrossTabBus } from "@/lib/jmap-client/push/mock/fake-cross-tab-bus";
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

describe("InboxFanOut", () => {
  it("shares a fetched inbox with the other tabs only", async () => {
    const bus = new FakeCrossTabBus<InboxMessage>();
    const a = new InboxFanOut({ topic: bus.topic() });
    const c = new InboxFanOut({ topic: bus.topic() });
    const inA = vi.fn();
    const inC = vi.fn();
    const stops = [a.onShared(inA), c.onShared(inC)];

    a.share(payload);
    await tick();
    expect(inA).not.toHaveBeenCalled();
    expect(inC).toHaveBeenCalledWith(payload);

    for (const stop of stops) stop();
    a.share(payload);
    await tick();
    expect(inC).toHaveBeenCalledTimes(1);
  });
});

describe("InboxFanOut failure", () => {
  it("tells the other tabs the fetch failed", async () => {
    const bus = new FakeCrossTabBus<InboxMessage>();
    const a = new InboxFanOut({ topic: bus.topic() });
    const c = new InboxFanOut({ topic: bus.topic() });
    const failedInA = vi.fn();
    const failedInC = vi.fn();
    const sharedInC = vi.fn();
    a.onFailed(failedInA);
    c.onFailed(failedInC);
    c.onShared(sharedInC);
    a.shareFailure();
    await tick();
    expect(failedInA).not.toHaveBeenCalled();
    expect(failedInC).toHaveBeenCalledTimes(1);
    expect(sharedInC).not.toHaveBeenCalled();
  });
});

describe("isInboxMessage", () => {
  it("accepts an inbox payload and drops anything else", () => {
    expect(isInboxMessage({ v: 1, kind: "inbox", ...payload })).toBe(true);
    expect(isInboxMessage({ v: 1, kind: "inbox", list: "x", unreadCount: 1 })).toBe(false);
    expect(isInboxMessage({ v: 2, kind: "inbox", ...payload })).toBe(false);
    expect(isInboxMessage({ v: 1, kind: "inbox-failed" })).toBe(true);
    expect(isInboxMessage(null)).toBe(false);
  });
});
