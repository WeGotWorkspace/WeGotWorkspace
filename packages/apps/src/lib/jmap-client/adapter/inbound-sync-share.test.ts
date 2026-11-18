import { describe, expect, it, vi } from "vitest";
import { isInboundSyncMessage, type InboundSyncHandlers } from "./inbound-sync-share";
import { FakeSyncBrowser, settleTabs, type FakeSyncTab } from "./mock/fake-sync-tabs";

function join(tab: FakeSyncTab) {
  const handlers = {
    onOwn: vi.fn(),
    onLose: vi.fn(),
    onRound: vi.fn(),
  } satisfies InboundSyncHandlers;
  const leave = tab.share.start(handlers);
  /** True while this tab owns the sync, by its own callbacks. */
  const owns = () => handlers.onOwn.mock.calls.length > handlers.onLose.mock.calls.length;
  return { ...handlers, leave, owns };
}

describe("inboundSyncShare", () => {
  it("the first tab owns the sync; a tab that opens later does not", async () => {
    const browser = new FakeSyncBrowser();
    const a = join(browser.tab("a"));
    await settleTabs();
    const b = join(browser.tab("b"));
    await settleTabs();

    expect(a.owns()).toBe(true);
    expect(a.onOwn).toHaveBeenCalledWith(false);
    expect(b.onOwn).not.toHaveBeenCalled();
    expect(browser.owner()).toBe("a");
  });

  it("the next tab takes over when the owner closes or crashes", async () => {
    const browser = new FakeSyncBrowser();
    const a = join(browser.tab("a"));
    const b = join(browser.tab("b"));
    const c = join(browser.tab("c"));
    await settleTabs();

    a.leave();
    await settleTabs();
    expect(a.owns()).toBe(false);
    expect(b.owns()).toBe(true);
    // It follows another tab, so it has to catch up.
    expect(b.onOwn).toHaveBeenCalledWith(true);

    browser.locks.crash("b");
    await settleTabs();
    expect(c.owns()).toBe(true);
  });

  it("of two tabs that open together, the one that waits knows it follows the other", async () => {
    const browser = new FakeSyncBrowser();
    // Both join before the lock is granted, so both see it free.
    const a = join(browser.tab("a"));
    const b = join(browser.tab("b"));
    await settleTabs();
    expect(a.owns()).toBe(true);

    a.leave();
    await settleTabs();

    expect(b.onOwn).toHaveBeenCalledWith(true);
  });

  it("a hidden owner hands over to a visible tab", async () => {
    const browser = new FakeSyncBrowser();
    const tabA = browser.tab("a");
    const a = join(tabA);
    const b = join(browser.tab("b"));
    await settleTabs();

    tabA.setVisible(false);
    await settleTabs();

    expect(a.owns()).toBe(false);
    expect(b.owns()).toBe(true);
    expect(browser.owner()).toBe("b");

    // The lock comes back to the first tab: another tab synced in between.
    b.leave();
    await settleTabs();
    expect(a.onOwn).toHaveBeenLastCalledWith(true);
  });

  it("a hidden owner keeps the sync while no other tab is visible", async () => {
    const browser = new FakeSyncBrowser();
    const tabA = browser.tab("a");
    const a = join(tabA);
    const b = join(browser.tab("b", { visible: false }));
    await settleTabs();

    tabA.setVisible(false);
    await settleTabs();

    expect(a.owns()).toBe(true);
    expect(a.onLose).not.toHaveBeenCalled();
    expect(b.onOwn).not.toHaveBeenCalled();
  });

  it("the lock passes hidden tabs in the queue until it reaches the visible one", async () => {
    const browser = new FakeSyncBrowser();
    const tabA = browser.tab("a");
    const a = join(tabA);
    const b = join(browser.tab("b", { visible: false }));
    const c = join(browser.tab("c"));
    await settleTabs();

    tabA.setVisible(false);
    await settleTabs();

    expect(browser.owner()).toBe("c");
    expect(c.owns()).toBe(true);
    expect(a.owns()).toBe(false);
    // The hidden tab in between held the lock for a moment and never synced.
    expect(b.onOwn).not.toHaveBeenCalled();
  });

  it("a tab that becomes visible takes over from a hidden owner", async () => {
    const browser = new FakeSyncBrowser();
    const a = join(browser.tab("a", { visible: false }));
    const tabB = browser.tab("b", { visible: false });
    const b = join(tabB);
    await settleTabs();
    expect(a.owns()).toBe(true);

    // The browser grants the visible lock late: the owner goes by the message.
    const grant = browser.locks.deferGrants("sync/notes/alice/visible/");
    tabB.setVisible(true);
    await settleTabs();
    grant();
    await settleTabs();

    expect(b.owns()).toBe(true);
    expect(a.owns()).toBe(false);
  });

  it("a hidden tab that gets the lock asks who is visible and hands over", async () => {
    const browser = new FakeSyncBrowser();
    // The visible tab's lock is not granted yet when the hidden tab checks.
    const grant = browser.locks.deferGrants("sync/notes/alice/visible/");
    const a = join(browser.tab("a", { visible: false }));
    await settleTabs();
    const b = join(browser.tab("b"));
    await settleTabs();
    grant();
    await settleTabs();

    expect(b.owns()).toBe(true);
    expect(a.owns()).toBe(false);
  });

  it("a visible owner never hands over", async () => {
    const browser = new FakeSyncBrowser();
    const a = join(browser.tab("a"));
    const tabB = browser.tab("b", { visible: false });
    join(tabB);
    await settleTabs();

    tabB.setVisible(true);
    await settleTabs();

    expect(a.owns()).toBe(true);
    expect(a.onLose).not.toHaveBeenCalled();
  });

  it("shares a round with the other tabs of the same app and account only", async () => {
    const browser = new FakeSyncBrowser();
    const tabA = browser.tab("a");
    const a = join(tabA);
    const b = join(browser.tab("b"));
    const contacts = join(browser.tab("c", { name: "sync/contacts/alice" }));
    const bob = join(browser.tab("d", { name: "sync/notes/bob" }));
    await settleTabs();

    tabA.share.publishRound({ Note: "n2" });
    await settleTabs();

    expect(b.onRound).toHaveBeenCalledWith({ Note: "n2" });
    expect(a.onRound).not.toHaveBeenCalled();
    expect(contacts.onRound).not.toHaveBeenCalled();
    expect(bob.onRound).not.toHaveBeenCalled();
    // Each app and account has its own owner.
    expect(contacts.owns()).toBe(true);
    expect(bob.owns()).toBe(true);
  });

  it("a tab that left hears nothing and holds no lock", async () => {
    const browser = new FakeSyncBrowser();
    const tabA = browser.tab("a");
    const a = join(tabA);
    const tabB = browser.tab("b");
    const b = join(tabB);
    await settleTabs();

    b.leave();
    tabA.share.publishRound({ Note: "n2" });
    a.leave();
    await settleTabs();

    expect(b.onRound).not.toHaveBeenCalled();
    expect(b.onOwn).not.toHaveBeenCalled();
    expect(browser.owner()).toBeUndefined();
    expect(browser.locks.holder("sync/notes/alice/visible/a")).toBeUndefined();
    expect(browser.locks.holder("sync/notes/alice/visible/b")).toBeUndefined();
  });

  it("accepts only its own messages", () => {
    const base = { v: 1, name: "sync/notes/alice", tabId: "a" };
    expect(isInboundSyncMessage({ ...base, kind: "visible" })).toBe(true);
    expect(isInboundSyncMessage({ ...base, kind: "roll-call" })).toBe(true);
    expect(isInboundSyncMessage({ ...base, kind: "round", states: { Note: "n2" } })).toBe(true);
    expect(isInboundSyncMessage({ ...base, kind: "round" })).toBe(false);
    expect(isInboundSyncMessage({ ...base, kind: "other" })).toBe(false);
    expect(isInboundSyncMessage({ ...base, v: 2, kind: "visible" })).toBe(false);
    expect(isInboundSyncMessage(null)).toBe(false);
  });
});
