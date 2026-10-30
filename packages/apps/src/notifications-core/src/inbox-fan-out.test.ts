import { afterEach, describe, expect, it, vi } from "vitest";
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

function twoTabs() {
  const bus = new FakeCrossTabBus<InboxMessage>();
  return { a: new InboxFanOut({ topic: bus.topic() }), c: new InboxFanOut({ topic: bus.topic() }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("InboxFanOut", () => {
  it("shares a fetched inbox with the other tabs only", async () => {
    const { a, c } = twoTabs();
    const inA = vi.fn();
    const inC = vi.fn();
    const stops = [a.onShared(inA), c.onShared(inC)];

    a.share(payload, "7");
    await tick();
    expect(inA).not.toHaveBeenCalled();
    expect(inC).toHaveBeenCalledWith(payload, "7");

    for (const stop of stops) stop();
    a.share(payload, "8");
    await tick();
    expect(inC).toHaveBeenCalledTimes(1);
  });

  it("waitFor resolves the rows shared for that state and ignores other states", async () => {
    const { a, c } = twoTabs();
    const waiting = c.waitFor("7", 10_000);
    a.share(payload, "6");
    await tick();
    a.share(payload, "7");
    await expect(waiting).resolves.toEqual(payload);
  });

  it("waitFor resolves at once when the share for that state already arrived", async () => {
    const { a, c } = twoTabs();
    a.share(payload, "7");
    await tick();
    await expect(c.waitFor("7", 10_000)).resolves.toEqual(payload);
  });

  // Notification states are the server's per-user inbox counter: "8" holds everything "7" did.
  it("waitFor resolves on the rows of a newer state too", async () => {
    const { a, c } = twoTabs();
    const waiting = c.waitFor("7", 10_000);
    a.share(payload, "8");
    await expect(waiting).resolves.toEqual(payload);
  });

  it("an older share arriving late does not hide the newer one from waitFor", async () => {
    const { a, c } = twoTabs();
    a.share(payload, "8");
    a.share({ list: [], unreadCount: 0 }, "7");
    await tick();
    await expect(c.waitFor("8", 10_000)).resolves.toEqual(payload);
  });

  it("a failure from an earlier attempt does not end a new wait; one during the wait does", async () => {
    const { a, c } = twoTabs();
    a.shareFailed("7");
    await tick();
    let result: unknown = "pending";
    const waiting = c.waitFor("7", 10_000);
    void waiting.then((value) => (result = value));
    await tick();
    expect(result).toBe("pending");
    a.shareFailed("7");
    await expect(waiting).resolves.toBeNull();
  });

  it("waitFor resolves null when the fetching tab reports a failed fetch for that state", async () => {
    const { a, c } = twoTabs();
    const waiting = c.waitFor("7", 10_000);
    a.shareFailed("7");
    await expect(waiting).resolves.toBeNull();
  });

  it("waitFor resolves null when nothing is shared in time (the fetching tab went away)", async () => {
    vi.useFakeTimers();
    const { c } = twoTabs();
    const waiting = c.waitFor("7", 10_000);
    let result: unknown = "pending";
    void waiting.then((value) => (result = value));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
  });
});

describe("isInboxMessage", () => {
  it("accepts a shared inbox or a failed fetch and drops anything else", () => {
    expect(isInboxMessage({ v: 1, kind: "inbox", state: "7", ...payload })).toBe(true);
    expect(isInboxMessage({ v: 1, kind: "inbox-failed", state: "7" })).toBe(true);
    expect(isInboxMessage({ v: 1, kind: "inbox", state: "7", list: "x", unreadCount: 1 })).toBe(
      false,
    );
    expect(isInboxMessage({ v: 1, kind: "inbox", ...payload })).toBe(false);
    expect(isInboxMessage({ v: 1, kind: "inbox-failed" })).toBe(false);
    expect(isInboxMessage({ v: 2, kind: "inbox", state: "7", ...payload })).toBe(false);
    expect(isInboxMessage(null)).toBe(false);
  });
});
