import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { flushDocsOutbox } from "@/lib/offline/docs/docs-outbox-flush";
import { upsertDriveEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import { flushDriveOutbox } from "@/lib/offline/drive/drive-outbox-flush";
import { DRIVE_DOMAIN, driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { createHybridSetTags } from "@/lib/offline/shared/drive-tag-operations";

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return { ...actual, readBrowserOnline: vi.fn(() => false) };
});

const setTagsSpy = vi.fn();
const setStarSpy = vi.fn();
vi.mock("@/lib/api/wgw/drive", () => ({
  createWgwDriveOperations: () => ({ setTags: setTagsSpy, setStar: setStarSpy }),
}));

/** Exclusive Web Locks, queued per name. */
function installQueuedLocks(): void {
  const tails = new Map<string, Promise<unknown>>();
  const request = (name: string, _options: LockOptions, task: () => Promise<unknown>) => {
    const before = tails.get(name) ?? Promise.resolve();
    const run = before.then(() => task());
    tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  };
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
}

const username = "alice";
const path = "/users/alice/plan.md";

describe("tag rows across Drive and Docs flushes", () => {
  const db = () => offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const hybrid = (domain: string) =>
    createHybridSetTags(username, {} as DriveAPIOperations, domain, vi.fn(), vi.fn());

  beforeEach(async () => {
    installQueuedLocks();
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    await db().outbox.clear();
    await driveEntriesTable(db()).clear();
    await upsertDriveEntry(
      username,
      {
        path,
        name: "plan.md",
        type: "file",
        size: 1,
        time: 1,
        permissions: 644,
        myRights: fullDriveMyRights,
      },
      "home",
    );
    setTagsSpy.mockResolvedValue([]);
  });

  it("a Drive edit merged into a Docs row moves it to Drive, which sends it", async () => {
    await hybrid(DOCS_DOMAIN)({ path, tagsAdd: ["a"] });
    await hybrid(DRIVE_DOMAIN)({ path, tagsAdd: ["b"] });

    const rows = await db().outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe(DRIVE_DOMAIN);

    await flushDriveOutbox(username);

    expect(setTagsSpy).toHaveBeenCalledWith({ path, tagsAdd: ["a", "b"], tagsRemove: undefined });
    expect(await db().outbox.count()).toBe(0);
  });

  it("a row that moves to Drive while Docs sends it stays queued and is not resent by Docs", async () => {
    await hybrid(DOCS_DOMAIN)({ path, tagsAdd: ["a"] });
    setTagsSpy.mockImplementationOnce(async () => {
      await hybrid(DRIVE_DOMAIN)({ path, tagsAdd: ["b"] });
      return [];
    });

    await flushDocsOutbox(username);

    expect(setTagsSpy).toHaveBeenCalledTimes(1);
    const rows = await db().outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.domain).toBe(DRIVE_DOMAIN);
    expect(JSON.parse(rows[0]?.payload ?? "{}").tagsAdd).toEqual(["a", "b"]);
  });

  it("a delta merged into the row while Drive sends it is sent again", async () => {
    await hybrid(DRIVE_DOMAIN)({ path, tagsAdd: ["a"] });
    setTagsSpy.mockImplementationOnce(async () => {
      await hybrid(DRIVE_DOMAIN)({ path, tagsAdd: ["b"] });
      return [];
    });

    await flushDriveOutbox(username);

    expect(setTagsSpy).toHaveBeenCalledTimes(2);
    expect(setTagsSpy.mock.calls[1]?.[0].tagsAdd).toEqual(["a", "b"]);
    expect(await db().outbox.count()).toBe(0);
  });

  it("online with a queued add: a remove merges instead of racing the flush", async () => {
    await hybrid(DRIVE_DOMAIN)({ path, tagsAdd: ["work"] });
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const live = { setTags: vi.fn(async () => []) } as unknown as DriveAPIOperations;
    const flushAfterQueue = vi.fn();

    await createHybridSetTags(
      username,
      live,
      DRIVE_DOMAIN,
      vi.fn(),
      flushAfterQueue,
    )({ path, tagsRemove: ["work"] });

    expect(live.setTags).not.toHaveBeenCalled();
    expect(flushAfterQueue).toHaveBeenCalledTimes(1);
    await flushDriveOutbox(username);
    expect(setTagsSpy.mock.calls.flatMap((call) => call[0].tagsAdd ?? [])).not.toContain("work");
  });

  it("a remove made online while Docs sends an add waits for it and is sent after it", async () => {
    await hybrid(DOCS_DOMAIN)({ path, tagsAdd: ["a"] });
    let release: () => void = () => undefined;
    setTagsSpy.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          release = () => resolve([]);
        }),
    );
    const docsFlush = flushDocsOutbox(username);
    await vi.waitFor(() => expect(setTagsSpy).toHaveBeenCalledTimes(1));

    vi.mocked(readBrowserOnline).mockReturnValue(true);
    let driveFlush: Promise<unknown> = Promise.resolve();
    await createHybridSetTags(username, {} as DriveAPIOperations, DRIVE_DOMAIN, vi.fn(), () => {
      driveFlush = flushDriveOutbox(username);
    })({ path, tagsRemove: ["a"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setTagsSpy).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([docsFlush, driveFlush]);

    expect(setTagsSpy).toHaveBeenCalledTimes(2);
    const last = setTagsSpy.mock.calls[1]?.[0];
    expect(last.tagsRemove).toEqual(["a"]);
    expect(last.tagsAdd).toBeUndefined();
    expect(await db().outbox.count()).toBe(0);
  });

  it("a row Drive sent meanwhile is not sent again from a Docs flush that had listed it", async () => {
    await db().outbox.put({
      id: "star-1",
      domain: DOCS_DOMAIN,
      op: "star",
      payload: JSON.stringify({ op: "star", path, starred: true }),
      createdAt: 1,
      retries: 0,
    });
    await hybrid(DOCS_DOMAIN)({ path, tagsAdd: ["a"] });
    let release: () => void = () => undefined;
    setStarSpy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const docsFlush = flushDocsOutbox(username);
    await vi.waitFor(() => expect(setStarSpy).toHaveBeenCalledTimes(1));

    await hybrid(DRIVE_DOMAIN)({ path, tagsRemove: ["a"] });
    await flushDriveOutbox(username);
    release();
    await docsFlush;

    expect(setTagsSpy).toHaveBeenCalledTimes(1);
    expect(setTagsSpy.mock.calls[0]?.[0].tagsAdd).toBeUndefined();
    expect(await db().outbox.count()).toBe(0);
  });
});
