import { describe, expect, it, vi } from "vitest";
import { FakeWebLocks } from "./mock/fake-web-locks";
import { browserWebLocks, holdWebLock, runWhileLeader } from "./web-locks-leader";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runWhileLeader", () => {
  it("lets one tab lead and hands over when it leaves", async () => {
    const locks = new FakeWebLocks();
    const stopA = vi.fn();
    const stopB = vi.fn();
    const leadA = vi.fn(() => stopA);
    const leadB = vi.fn(() => stopB);

    const leaveA = runWhileLeader(locks.client("a"), "leader", leadA);
    const leaveB = runWhileLeader(locks.client("b"), "leader", leadB);
    await tick();
    expect(leadA).toHaveBeenCalledTimes(1);
    expect(leadB).not.toHaveBeenCalled();

    leaveA();
    await tick();
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(leadB).toHaveBeenCalledTimes(1);
    expect(locks.holder("leader")).toBe("b");

    leaveB();
    await tick();
    expect(stopB).toHaveBeenCalledTimes(1);
    expect(locks.holder("leader")).toBeUndefined();
  });

  it("a tab that leaves while waiting never leads", async () => {
    const locks = new FakeWebLocks();
    const leaveA = runWhileLeader(locks.client("a"), "leader", () => () => undefined);
    const leadB = vi.fn(() => () => undefined);
    const leaveB = runWhileLeader(locks.client("b"), "leader", leadB);
    await tick();
    leaveB();
    leaveA();
    await tick();
    expect(leadB).not.toHaveBeenCalled();
  });

  it("the next tab leads when the leader crashes", async () => {
    const locks = new FakeWebLocks();
    runWhileLeader(locks.client("a"), "leader", () => () => undefined);
    const leadB = vi.fn(() => () => undefined);
    runWhileLeader(locks.client("b"), "leader", leadB);
    await tick();
    locks.crash("a");
    await tick();
    expect(leadB).toHaveBeenCalledTimes(1);
  });
});

describe("holdWebLock", () => {
  it("holds the lock until released", async () => {
    const locks = new FakeWebLocks();
    const release = holdWebLock(locks.client("a"), "tab/a");
    await tick();
    expect(locks.holder("tab/a")).toBe("a");
    release();
    await tick();
    expect(locks.holder("tab/a")).toBeUndefined();
  });
});

describe("browserWebLocks", () => {
  it("is null without navigator.locks and returns it when present", () => {
    vi.stubGlobal("navigator", {});
    expect(browserWebLocks()).toBeNull();
    const locks = { request: vi.fn(), query: vi.fn() };
    vi.stubGlobal("navigator", { locks });
    expect(browserWebLocks()).toBe(locks);
    vi.unstubAllGlobals();
  });
});
