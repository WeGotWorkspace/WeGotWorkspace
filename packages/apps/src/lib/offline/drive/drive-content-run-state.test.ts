import { beforeEach, describe, expect, it, vi } from "vitest";

const meta = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("@/lib/offline/core/meta-store", () => ({
  readMeta: async (user: string, key: string) => meta.values.get(`${user}:${key}`) ?? null,
  writeMeta: async (user: string, key: string, value: string) => {
    meta.values.set(`${user}:${key}`, value);
  },
}));

import {
  beginDriveContentRun,
  clearDriveContentFailure,
  endDriveContentRun,
  finishDriveContentRunItem,
  isCurrentDriveContentRun,
  isDriveContentQueued,
  MAX_AUTO_CONTENT_ATTEMPTS,
  readDriveContentFailures,
  recordDriveContentFailure,
  resetDriveContentRunStateForTests,
  shouldAutoRetryDriveContent,
  subscribeDriveContentRunState,
} from "@/lib/offline/drive/drive-content-run-state";

describe("drive content run state", () => {
  beforeEach(() => {
    meta.values.clear();
    resetDriveContentRunStateForTests();
  });

  it("queues the run's paths per account, with or without a leading slash", () => {
    const run = beginDriveContentRun("alice", ["/users/alice/a.png"]);
    expect(isDriveContentQueued("alice", "users/alice/a.png")).toBe(true);
    expect(isDriveContentQueued("bob", "users/alice/a.png")).toBe(false);
    finishDriveContentRunItem(run, "/users/alice/a.png");
    expect(isDriveContentQueued("alice", "/users/alice/a.png")).toBe(false);
  });

  it("forgets the whole queue when the run ends", () => {
    const run = beginDriveContentRun("alice", ["/a", "/b"]);
    endDriveContentRun(run);
    expect(isDriveContentQueued("alice", "/a")).toBe(false);
    expect(isDriveContentQueued("alice", "/b")).toBe(false);
  });

  it("tells subscribers when the queue changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDriveContentRunState(listener);
    const run = beginDriveContentRun("alice", ["/a"]);
    finishDriveContentRunItem(run, "/a");
    finishDriveContentRunItem(run, "/a");
    endDriveContentRun(run);
    unsubscribe();
    // begin, one finish, end; the repeated finish changes nothing.
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("a replaced run cannot touch the newer run's queue", () => {
    const older = beginDriveContentRun("alice", ["/a", "/b"]);
    const newer = beginDriveContentRun("alice", ["/a", "/b"]);
    expect(isCurrentDriveContentRun(older)).toBe(false);
    finishDriveContentRunItem(older, "/a");
    endDriveContentRun(older);
    expect(isDriveContentQueued("alice", "/a")).toBe(true);
    expect(isDriveContentQueued("alice", "/b")).toBe(true);
    endDriveContentRun(newer);
    expect(isDriveContentQueued("alice", "/a")).toBe(false);
  });

  it("counts failed attempts per version and keeps parallel writes", async () => {
    await Promise.all([
      recordDriveContentFailure("alice", "/a", 10),
      recordDriveContentFailure("alice", "/b", 10),
      recordDriveContentFailure("alice", "/a", 10),
    ]);
    expect(await readDriveContentFailures("alice")).toEqual({
      a: { attempts: 2, modifiedAt: 10 },
      b: { attempts: 1, modifiedAt: 10 },
    });
    await recordDriveContentFailure("alice", "/a", 11);
    expect((await readDriveContentFailures("alice")).a).toEqual({ attempts: 1, modifiedAt: 11 });
  });

  it("clears a failure once the file is stored", async () => {
    await recordDriveContentFailure("alice", "/a", 10);
    await clearDriveContentFailure("alice", "a");
    expect(await readDriveContentFailures("alice")).toEqual({});
  });

  it("stops automatic retries after the cap until a new version arrives", () => {
    const capped = { attempts: MAX_AUTO_CONTENT_ATTEMPTS, modifiedAt: 10 };
    expect(shouldAutoRetryDriveContent(undefined, 10)).toBe(true);
    expect(shouldAutoRetryDriveContent({ attempts: 1, modifiedAt: 10 }, 10)).toBe(true);
    expect(shouldAutoRetryDriveContent(capped, 10)).toBe(false);
    expect(shouldAutoRetryDriveContent(capped, 11)).toBe(true);
  });
});
