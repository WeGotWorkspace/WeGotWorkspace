import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveUIData } from "@/lib/files/drive-types";
import { FakeCrossTabBus } from "@/lib/jmap-client/push/mock/fake-cross-tab-bus";
import { FakeWebLocks } from "@/lib/jmap-client/push/mock/fake-web-locks";
import { createDriveFolderFetchShare, type DriveFolderFetched } from "./drive-folder-fetch-share";

const USER = "alice";
const PATH = "/users/alice/Projects";
const WAIT_MS = 5_000;

function listing(name: string): DriveUIData {
  return {
    user: { username: USER, name: USER, role: "user", roots: ["/users"] },
    cwd: PATH,
    directory: {
      location: PATH,
      files: [{ name, path: `${PATH}/${name}`, type: "file", size: 1, time: 1 }],
    },
  } as DriveUIData;
}
const names = (data: DriveUIData) => data.directory.files.map((file) => file.name);

/** One browser: each tab has its own lock client and its own end of the channel. */
function browser(options: { locks?: boolean } = {}) {
  const locks = new FakeWebLocks();
  const bus = new FakeCrossTabBus<DriveFolderFetched>();
  return {
    bus,
    locks,
    tab(id: string) {
      const client = locks.client(id);
      return createDriveFolderFetchShare({
        topic: bus.topic(),
        waitMs: WAIT_MS,
        lockIfFree:
          options.locks === false
            ? (_name, task) => task()
            : (name, task) =>
                client.request(name, { ifAvailable: true }, (lock) =>
                  lock ? task() : undefined,
                ) as Promise<never>,
      });
    },
  };
}

/** A fetch that stays open until `finish` runs. */
function openFetch() {
  let finish: (data: DriveUIData) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const fetchLive = vi.fn(
    () =>
      new Promise<DriveUIData>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  );
  return { fetchLive, finish: (data: DriveUIData) => finish(data), fail: (e: Error) => fail(e) };
}

describe("createDriveFolderFetchShare", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fetches a folder once for three tabs that show it", async () => {
    const { tab } = browser();
    const first = openFetch();
    const others = [vi.fn(), vi.fn()];
    const request = { username: USER, path: PATH, wave: 10 };

    const a = tab("a")({ ...request, fetchLive: first.fetchLive });
    await vi.advanceTimersByTimeAsync(0);
    const b = tab("b")({ ...request, fetchLive: others[0] });
    const c = tab("c")({ ...request, fetchLive: others[1] });
    await vi.advanceTimersByTimeAsync(0);
    first.finish(listing("new.md"));
    await vi.advanceTimersByTimeAsync(0);

    for (const result of [a, b, c]) expect(names(await result)).toEqual(["new.md"]);
    expect(first.fetchLive).toHaveBeenCalledTimes(1);
    for (const fetchLive of others) expect(fetchLive).not.toHaveBeenCalled();
  });

  it("does not take over a listing fetched for an older change", async () => {
    const { tab } = browser();
    const old = openFetch();
    const a = tab("a")({ username: USER, path: PATH, wave: 10, fetchLive: old.fetchLive });
    await vi.advanceTimersByTimeAsync(0);
    const fresh = vi.fn(async () => listing("newer.md"));
    const b = tab("b")({ username: USER, path: PATH, wave: 20, fetchLive: fresh });
    await vi.advanceTimersByTimeAsync(0);

    old.finish(listing("old.md"));
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1);
    expect(fresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(names(await a)).toEqual(["old.md"]);
    expect(names(await b)).toEqual(["newer.md"]);
  });

  it("takes over a listing fetched for a newer change", async () => {
    const { tab } = browser();
    const newer = openFetch();
    void tab("a")({ username: USER, path: PATH, wave: 20, fetchLive: newer.fetchLive });
    await vi.advanceTimersByTimeAsync(0);
    const own = vi.fn();
    const b = tab("b")({ username: USER, path: PATH, wave: 10, fetchLive: own });
    await vi.advanceTimersByTimeAsync(0);
    newer.finish(listing("newer.md"));
    await vi.advanceTimersByTimeAsync(0);

    expect(names(await b)).toEqual(["newer.md"]);
    expect(own).not.toHaveBeenCalled();
  });

  it("fetches for itself when the fetching tab fails", async () => {
    const { tab } = browser();
    const failing = openFetch();
    const a = tab("a")({ username: USER, path: PATH, wave: 10, fetchLive: failing.fetchLive });
    a.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const own = vi.fn(async () => listing("own.md"));
    const b = tab("b")({ username: USER, path: PATH, wave: 10, fetchLive: own });
    await vi.advanceTimersByTimeAsync(0);

    failing.fail(new Error("GET failed (503)"));
    await expect(a).rejects.toThrow("503");
    await vi.advanceTimersByTimeAsync(WAIT_MS);

    expect(names(await b)).toEqual(["own.md"]);
  });

  it("stops waiting when the folder view closes", async () => {
    const { tab } = browser();
    const slow = openFetch();
    void tab("a")({ username: USER, path: PATH, wave: 10, fetchLive: slow.fetchLive });
    await vi.advanceTimersByTimeAsync(0);
    const controller = new AbortController();
    const own = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const b = tab("b")({
      username: USER,
      path: PATH,
      wave: 10,
      fetchLive: own,
      signal: controller.signal,
    });
    b.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();
    await expect(b).rejects.toThrow("aborted");
  });

  it("fetches each folder and each account on its own", async () => {
    const { tab } = browser();
    const first = openFetch();
    void tab("a")({ username: USER, path: PATH, wave: 10, fetchLive: first.fetchLive });
    await vi.advanceTimersByTimeAsync(0);
    const otherFolder = vi.fn(async () => listing("other.md"));
    const otherUser = vi.fn(async () => listing("bob.md"));

    const b = tab("b")({ username: USER, path: `${PATH}/Sub`, wave: 10, fetchLive: otherFolder });
    const c = tab("c")({ username: "bob", path: PATH, wave: 10, fetchLive: otherUser });
    await vi.advanceTimersByTimeAsync(0);

    expect(names(await b)).toEqual(["other.md"]);
    expect(names(await c)).toEqual(["bob.md"]);
  });

  it("fetches in every tab without Web Locks", async () => {
    const { tab } = browser({ locks: false });
    const fetches = [vi.fn(async () => listing("a.md")), vi.fn(async () => listing("b.md"))];
    const request = { username: USER, path: PATH, wave: 10 };

    const a = tab("a")({ ...request, fetchLive: fetches[0] });
    const b = tab("b")({ ...request, fetchLive: fetches[1] });
    await vi.advanceTimersByTimeAsync(0);

    expect(names(await a)).toEqual(["a.md"]);
    expect(names(await b)).toEqual(["b.md"]);
  });

  it("hands the next tab a listing that arrived just before its turn", async () => {
    const { tab, bus, locks } = browser();
    const own = vi.fn();
    // The browser answers this tab's lock request a while later.
    const grant = locks.deferGrants("wgw.drive.folder-fetch.");
    const b = tab("b")({ username: USER, path: PATH, wave: 10, fetchLive: own });
    bus.topic().publish({ v: 1, username: USER, path: PATH, wave: 10, data: listing("early.md") });
    await vi.advanceTimersByTimeAsync(0);
    grant();
    await vi.advanceTimersByTimeAsync(0);

    expect(names(await b)).toEqual(["early.md"]);
    expect(own).not.toHaveBeenCalled();
  });
});
