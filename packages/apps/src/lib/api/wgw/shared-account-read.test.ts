// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSharedAccountRead, type AccountRead } from "@/lib/api/wgw/shared-account-read";
import { resetCrossTabLockForTests } from "@/lib/cross-tab/cross-tab-lock";

const ok = (json: Record<string, unknown>): AccountRead => ({ ok: true, status: 200, json });

function make(options: {
  load: () => Promise<AccountRead>;
  identity?: () => string | null;
  now?: () => number;
  name?: string;
}) {
  return createSharedAccountRead({
    name: options.name ?? "t",
    load: options.load,
    identity: options.identity ?? (() => "alice"),
    now: options.now,
  });
}

describe("createSharedAccountRead", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCrossTabLockForTests();
  });

  it("sends one request for five concurrent readers and keeps the answer", async () => {
    const load = vi.fn(async () => ok({ apps: { tasks: true } }));
    const shared = make({ load });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => shared.read()));
    expect(results.every((r) => r.ok)).toBe(true);
    await shared.read();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares the answer with another page of the same browser through storage", async () => {
    const load = vi.fn(async () => ok({ a: 1 }));
    await make({ load }).read();
    const secondPage = make({ load });
    expect(await secondPage.read()).toEqual(ok({ a: 1 }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failure, so the next reader asks again", async () => {
    const load = vi
      .fn<() => Promise<AccountRead>>()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce(ok({ a: 1 }));
    const shared = make({ load });
    expect((await shared.read()).ok).toBe(false);
    expect((await shared.read()).ok).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never serves one user's answer to another", async () => {
    let who = "alice";
    const load = vi.fn(async () => ok({ who }));
    const shared = make({ load, identity: () => who });
    expect(await shared.read()).toEqual(ok({ who: "alice" }));
    who = "bob";
    expect(await shared.read()).toEqual(ok({ who: "bob" }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("only joins a request in flight when the identity is unknown", async () => {
    const load = vi.fn(async () => ok({}));
    const shared = make({ load, identity: () => null });
    await Promise.all([shared.read(), shared.read()]);
    await shared.read();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("asks again once the answer is older than the safety net", async () => {
    let t = 0;
    const load = vi.fn(async () => ok({}));
    const shared = make({ load, now: () => t, name: "aged" });
    await shared.read();
    t += 5 * 60_000 + 1;
    await shared.read();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("uses a written value at once, in this and every other page, and tells subscribers", async () => {
    const load = vi.fn(async () => ok({ locale: "en" }));
    const shared = make({ load });
    await shared.read();
    const heard = vi.fn();
    shared.subscribe(heard);
    shared.set({ locale: "nl" });
    expect(await shared.read()).toEqual(ok({ locale: "nl" }));
    expect(heard).toHaveBeenCalledWith({ locale: "nl" });
    expect(await make({ load }).read()).toEqual(ok({ locale: "nl" }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("drops the value everywhere on invalidate, and a read in flight cannot bring it back", async () => {
    let release: (value: AccountRead) => void = () => undefined;
    const load = vi
      .fn<() => Promise<AccountRead>>()
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValueOnce(ok({ v: 2 }));
    const shared = make({ load });
    const pending = shared.read();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    shared.invalidate();
    release(ok({ v: 1 }));
    await pending;
    expect(window.localStorage.length).toBe(0);
    expect(await shared.readFresh()).toEqual(ok({ v: 2 }));
  });

  it("another page's write reaches this page's memory over the channel", async () => {
    const load = vi.fn(async () => ok({ v: 1 }));
    const page = make({ load, name: "bus" });
    await page.read();
    const channel = new BroadcastChannel("wgw.account-read.bus");
    window.localStorage.clear(); // what the invalidating page does before it announces
    channel.postMessage({ type: "clear" });
    await vi.waitFor(async () => {
      await page.read();
      expect(load).toHaveBeenCalledTimes(2);
    });
    channel.close();
  });

  it("a clear from another page also empties storage after an older read wrote it", async () => {
    const load = vi.fn(async () => ok({ v: 1 }));
    const page = make({ load, name: "bus-clear" });
    await page.read(); // store() wrote { v: 1 }
    const channel = new BroadcastChannel("wgw.account-read.bus-clear");
    channel.postMessage({ type: "clear" });
    await vi.waitFor(() =>
      expect(window.localStorage.getItem("wgw.account-read.v1.bus-clear")).toBeNull(),
    );
    channel.close();
  });

  it("a set from another page is what a new page reads back, not an older read's body", async () => {
    const load = vi.fn(async () => ok({ v: "old" }));
    const page = make({ load, name: "bus-set" });
    await page.read();
    const channel = new BroadcastChannel("wgw.account-read.bus-set");
    channel.postMessage({ type: "set", identity: "alice", at: Date.now(), json: { v: "new" } });
    await vi.waitFor(async () => expect(await page.read()).toEqual(ok({ v: "new" })));
    expect(await make({ load, name: "bus-set" }).read()).toEqual(ok({ v: "new" }));
    expect(load).toHaveBeenCalledTimes(1);
    channel.close();
  });
});
