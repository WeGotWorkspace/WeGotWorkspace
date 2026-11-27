import { beforeEach, describe, expect, it, vi } from "vitest";

const { makeDocsOfflineAvailable, readDriveEntryFromCache, net, meta, docs, blobPut } = vi.hoisted(
  () => ({
    makeDocsOfflineAvailable: vi.fn(),
    readDriveEntryFromCache: vi.fn(),
    docs: {
      lastSyncedAt: new Map<string, number>(),
      persisted: new Set<string>(),
    },
    net: { online: true, fetch: vi.fn() },
    meta: { values: new Map<string, string>() },
    blobPut: vi.fn(),
  }),
);

vi.mock("@/lib/api/wgw/http", () => ({ wgwFetch: (...args: unknown[]) => net.fetch(...args) }));
vi.mock("@/lib/offline/core/browser-online", () => ({ getConnectivitySnapshot: () => net.online }));
vi.mock("@/lib/offline/core/offline-device-settings", () => ({
  isEligibleForAutoContentSync: () => true,
  readOfflineDeviceContentSettings: () => ({
    contentSyncEnabled: true,
    maxFileSizeBytes: 10 * 1024 * 1024,
  }),
}));
vi.mock("@/lib/offline/core/meta-store", () => ({
  readMeta: async (_user: string, key: string) => meta.values.get(key) ?? null,
  writeMeta: async (_user: string, key: string, value: string) => {
    meta.values.set(key, value);
  },
}));
vi.mock("@/lib/offline/core/offline-db", async (importOriginal) => ({
  // Partial: docs-schema registers its tables on import (#2063 C4).
  ...(await importOriginal<typeof import("@/lib/offline/core/offline-db")>()),
  offlineAccountKeyFromUsername: (user: string) => user,
  offlineDbForAccount: () => ({}),
}));
vi.mock("@/lib/offline/drive/drive-schema", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/drive/drive-schema")>()),
  driveContentBlobsTable: () => ({ get: async () => undefined, put: blobPut }),
}));
vi.mock("@/lib/offline/core/background-sync-pacer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/background-sync-pacer")>();
  return {
    ...actual,
    backgroundSyncPacer: () => ({
      acquire: async () => {},
      reportRateLimited: () => {},
      reportSuccess: () => {},
    }),
  };
});

vi.mock("@/lib/offline/docs/docs-offline-pin-core", () => ({ makeDocsOfflineAvailable }));
vi.mock("@/lib/offline/docs/docs-availability-store", () => ({
  readDocsAvailability: async (_user: string, room: string) =>
    docs.lastSyncedAt.has(room)
      ? { id: room, lastSyncedAt: docs.lastSyncedAt.get(room) }
      : undefined,
}));
vi.mock("@/lib/offline/docs/docs-collab-offline-availability", () => ({
  hasDocsCollabOfflinePersistence: async (room: string) => docs.persisted.has(room),
}));
vi.mock("@/lib/offline/drive/drive-directory-offline-store", () => ({ readDriveEntryFromCache }));
vi.mock("@/lib/offline/drive/drive-availability-store", () => ({
  markDriveAvailabilitySynced: vi.fn(),
  writeDriveAvailability: vi.fn(),
}));

import {
  syncDriveContentFromCache,
  syncDriveFileContent,
} from "@/lib/offline/drive/drive-content-sync";
import { CollabHttpError } from "@/lib/collab/docs-collab-utils";
import {
  beginDriveContentRun,
  isDriveContentQueued,
  readDriveContentFailures,
  resetDriveContentRunStateForTests,
  subscribeDriveContentRunState,
} from "@/lib/offline/drive/drive-content-run-state";

describe("syncDriveFileContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the entry mtime in ms for a background sync", async () => {
    readDriveEntryFromCache.mockResolvedValue({ time: 20 });
    await syncDriveFileContent("alice", "/users/alice/a.md");
    expect(makeDocsOfflineAvailable).toHaveBeenCalledWith(
      "alice",
      expect.any(String),
      "",
      expect.objectContaining({ modifiedAtMs: 20_000 }),
    );
  });

  it("treats a cached time of 0 as unknown so the document is refreshed", async () => {
    readDriveEntryFromCache.mockResolvedValue({ time: 0 });
    await syncDriveFileContent("alice", "/users/alice/a.md");
    expect(makeDocsOfflineAvailable).toHaveBeenCalledWith(
      "alice",
      expect.any(String),
      "",
      expect.objectContaining({ modifiedAtMs: undefined }),
    );
  });
});

describe("syncDriveContentFromCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    meta.values.clear();
    net.online = true;
    resetDriveContentRunStateForTests();
    docs.lastSyncedAt.clear();
    docs.persisted.clear();
    makeDocsOfflineAvailable.mockResolvedValue(undefined);
    readDriveEntryFromCache.mockResolvedValue({ type: "file", size: 10, time: 7 });
  });

  it("queues only the files it downloads and empties the queue when done", async () => {
    const seen: boolean[] = [];
    net.fetch.mockImplementation(async () => {
      seen.push(isDriveContentQueued("alice", "/users/alice/a.png"));
      return new Response("x");
    });
    await syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    expect(seen).toEqual([true]);
    expect(isDriveContentQueued("alice", "/users/alice/a.png")).toBe(false);
  });

  it("records a download that fails while online", async () => {
    net.fetch.mockResolvedValue(new Response("", { status: 500 }));
    await syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    expect(await readDriveContentFailures("alice")).toEqual({
      "users/alice/a.png": { attempts: 1, modifiedAt: 7 },
    });
  });

  it("does not record a fetch that throws, even when the device is online again", async () => {
    net.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    expect(await readDriveContentFailures("alice")).toEqual({});
  });

  it("keeps a newer run's queue when an older run ends late, and the older run records nothing", async () => {
    let failOld: (() => void) | null = null;
    net.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          failOld = () => resolve(new Response("", { status: 500 }));
        }),
    );
    const older = syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    await vi.waitFor(() => expect(failOld).not.toBeNull());
    // A reconnect starts a second run while the first is still downloading.
    beginDriveContentRun("alice", ["/users/alice/a.png"]);
    failOld!();
    await older;
    expect(isDriveContentQueued("alice", "/users/alice/a.png")).toBe(true);
    expect(await readDriveContentFailures("alice")).toEqual({});
  });

  it("stops the spinner when the runner gives up on a file after repeated 429s", async () => {
    const seen: boolean[] = [];
    net.fetch.mockImplementation(async () => {
      seen.push(isDriveContentQueued("alice", "/users/alice/a.png"));
      return new Response("", { status: 429 });
    });
    const finished = vi.fn();
    const unsubscribe = subscribeDriveContentRunState(() => {
      if (!isDriveContentQueued("alice", "/users/alice/a.png")) finished();
    });
    await syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    unsubscribe();
    expect(seen.every(Boolean)).toBe(true);
    expect(seen.length).toBe(5);
    expect(finished).toHaveBeenCalled();
    expect(await readDriveContentFailures("alice")).toEqual({});
  });

  it("does not record a failure caused by going offline", async () => {
    net.fetch.mockImplementation(async () => {
      net.online = false;
      throw new TypeError("Failed to fetch");
    });
    await syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    expect(await readDriveContentFailures("alice")).toEqual({});
  });

  it("skips a file that failed too often until a new version arrives", async () => {
    meta.values.set(
      "drive:auto-sync:content-failures",
      JSON.stringify({ "users/alice/a.png": { attempts: 3, modifiedAt: 7 } }),
    );
    net.fetch.mockResolvedValue(new Response("x"));
    await syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    expect(net.fetch).not.toHaveBeenCalled();

    readDriveEntryFromCache.mockResolvedValue({ type: "file", size: 10, time: 8 });
    await syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    expect(net.fetch).toHaveBeenCalledTimes(1);
    expect(await readDriveContentFailures("alice")).toEqual({});
  });

  it("replaces a stale queue from an earlier run", async () => {
    beginDriveContentRun("alice", ["/users/alice/old.png"]);
    const listener = vi.fn();
    const unsubscribe = subscribeDriveContentRunState(listener);
    net.fetch.mockResolvedValue(new Response("x"));
    await syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    unsubscribe();
    expect(isDriveContentQueued("alice", "/users/alice/old.png")).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it("does not queue a collab document whose local copy is already current", async () => {
    docs.lastSyncedAt.set("users/alice/a.md", 7_000);
    docs.persisted.add("users/alice/a.md");
    const seen: boolean[] = [];
    const unsubscribe = subscribeDriveContentRunState(() => {
      seen.push(isDriveContentQueued("alice", "/users/alice/a.md"));
    });
    await syncDriveContentFromCache("alice", ["/users/alice/a.md"]);
    unsubscribe();
    expect(seen).not.toContain(true);
    expect(makeDocsOfflineAvailable).not.toHaveBeenCalled();
  });

  it("still queues a collab document Docs has never synced", async () => {
    await syncDriveContentFromCache("alice", ["/users/alice/a.md"]);
    expect(makeDocsOfflineAvailable).toHaveBeenCalledTimes(1);
  });

  it("still queues a synced collab document whose local Y.Doc is empty", async () => {
    docs.lastSyncedAt.set("users/alice/a.md", 7_000);
    await syncDriveContentFromCache("alice", ["/users/alice/a.md"]);
    expect(makeDocsOfflineAvailable).toHaveBeenCalledTimes(1);
  });

  it("still queues a collab document synced before the listing's mtime", async () => {
    docs.lastSyncedAt.set("users/alice/a.md", 6_999);
    docs.persisted.add("users/alice/a.md");
    await syncDriveContentFromCache("alice", ["/users/alice/a.md"]);
    expect(makeDocsOfflineAvailable).toHaveBeenCalledTimes(1);
  });

  it("records a collab document the server refuses", async () => {
    makeDocsOfflineAvailable.mockRejectedValue(new CollabHttpError("refused", 500, null));
    await syncDriveContentFromCache("alice", ["/users/alice/a.md"]);
    expect(await readDriveContentFailures("alice")).toEqual({
      "users/alice/a.md": { attempts: 1, modifiedAt: 7 },
    });
  });

  it("does not record a collab document whose request throws", async () => {
    makeDocsOfflineAvailable.mockRejectedValue(new TypeError("Failed to fetch"));
    await syncDriveContentFromCache("alice", ["/users/alice/a.md"]);
    expect(await readDriveContentFailures("alice")).toEqual({});
  });

  it("does not record a collab refusal once a newer run has started", async () => {
    let refuse: (() => void) | null = null;
    makeDocsOfflineAvailable.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          refuse = () => reject(new CollabHttpError("refused", 500, null));
        }),
    );
    const older = syncDriveContentFromCache("alice", ["/users/alice/a.md"]);
    await vi.waitFor(() => expect(refuse).not.toBeNull());
    beginDriveContentRun("alice", ["/users/alice/a.md"]);
    refuse!();
    await older;
    expect(await readDriveContentFailures("alice")).toEqual({});
  });

  it("drops a late answer for a replaced run: no copy written, the newer failure kept", async () => {
    let answerOld: (() => void) | null = null;
    net.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answerOld = () => resolve(new Response("old bytes"));
        }),
    );
    const older = syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    await vi.waitFor(() => expect(answerOld).not.toBeNull());
    beginDriveContentRun("alice", ["/users/alice/a.png"]);
    meta.values.set(
      "drive:auto-sync:content-failures",
      JSON.stringify({ "users/alice/a.png": { attempts: 1, modifiedAt: 7 } }),
    );
    answerOld!();
    await older;
    expect(blobPut).not.toHaveBeenCalled();
    expect(await readDriveContentFailures("alice")).toEqual({
      "users/alice/a.png": { attempts: 1, modifiedAt: 7 },
    });
  });

  it("keeps a failure a newer run records while the copy is being written", async () => {
    net.fetch.mockResolvedValue(new Response("x"));
    blobPut.mockImplementationOnce(async () => {
      beginDriveContentRun("alice", ["/users/alice/a.png"]);
      meta.values.set(
        "drive:auto-sync:content-failures",
        JSON.stringify({ "users/alice/a.png": { attempts: 1, modifiedAt: 7 } }),
      );
    });
    await syncDriveContentFromCache("alice", ["/users/alice/a.png"]);
    expect(await readDriveContentFailures("alice")).toEqual({
      "users/alice/a.png": { attempts: 1, modifiedAt: 7 },
    });
  });
});
