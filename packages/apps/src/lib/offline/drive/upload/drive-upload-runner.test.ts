import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JmapFileNode } from "@/lib/jmap-client";
import { JmapSetItemError } from "@/lib/jmap-client";
import { createCrossTabLock, type WithCrossTabLock } from "@/lib/cross-tab/cross-tab-lock";
import { simulateOrigin } from "@/lib/cross-tab/test-utils/simulated-origin";

const online = vi.hoisted(() => ({ value: true }));
const settings = vi.hoisted(() => ({ contentSyncEnabled: true, maxFileSizeBytes: 1_000 }));
const wgwFetch = vi.hoisted(() => vi.fn());
const server = vi.hoisted(() => ({
  maxSizeUpload: 10_000,
  nodes: [] as Array<{ id: string; parentId: string; name: string; size: number; blobId: string }>,
  /** Server clock ahead of the device, so `syncedAt` must not come from the local clock. */
  modified: "2099-01-01T00:00:00Z",
  createRaces: 0,
  getFailures: 0,
  setCalls: [] as unknown[],
}));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  readBrowserOnline: () => online.value,
  getConnectivitySnapshot: () => online.value,
}));

vi.mock("@/lib/offline/core/offline-device-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/offline-device-settings")>()),
  readOfflineDeviceContentSettings: () => ({ ...settings }),
}));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwFetch,
}));

function toNode(row: (typeof server.nodes)[number]): JmapFileNode {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    nodeType: "file",
    blobId: row.blobId,
    size: row.size,
    type: "text/plain",
    modified: server.modified,
    myRights: { mayRead: true, mayModifyContent: true },
  } as JmapFileNode;
}

vi.mock("@/lib/api/wgw/drive-jmap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/drive-jmap")>()),
  driveJmapSession: async () => ({
    accountId: "ada",
    maxSizeUpload: server.maxSizeUpload,
    uploadUrl: "/api/v1/jmap/upload/{accountId}/",
    fileNodes: {
      queryAndGetFileNodes: async (
        _account: string,
        filter: { parentId: string; name?: string },
      ) => ({
        list: server.nodes
          .filter((row) => row.parentId === filter.parentId)
          .filter((row) => filter.name === undefined || row.name === filter.name)
          .map(toNode),
      }),
      setFileNodes: async (args: {
        create: Record<string, { parentId: string; name: string; blobId: string }>;
      }) => {
        server.setCalls.push(args);
        const create = args.create.upload!;
        if (server.createRaces > 0) {
          server.createRaces -= 1;
          server.nodes.push({
            id: `race-${server.nodes.length}`,
            parentId: create.parentId,
            name: create.name,
            size: 1,
            blobId: "x",
          });
          throw new JmapSetItemError("create", "upload", { type: "alreadyExists" });
        }
        if (
          server.nodes.some((row) => row.parentId === create.parentId && row.name === create.name)
        ) {
          throw new JmapSetItemError("create", "upload", { type: "alreadyExists" });
        }
        const id = `fn-${server.nodes.length + 1}`;
        server.nodes.push({
          id,
          parentId: create.parentId,
          name: create.name,
          size: 5,
          blobId: create.blobId,
        });
        return { created: { upload: { id } } };
      },
      getFileNodes: async (_account: string, ids: string[]) => {
        if (server.getFailures > 0) {
          server.getFailures -= 1;
          throw new TypeError("Failed to fetch");
        }
        return { list: server.nodes.filter((row) => ids.includes(row.id)).map(toNode) };
      },
    },
  }),
}));

import { readDirectoryEntriesFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { syncDriveContentFromCache } from "@/lib/offline/drive/drive-content-sync";
import { readDriveAvailability } from "@/lib/offline/drive/drive-availability-store";
import { driveContentBlobsTable } from "@/lib/offline/drive/drive-schema";
import { resetDriveUploadEventsForTests } from "@/lib/offline/drive/upload/drive-upload-events";
import { driveUploaderLockName } from "@/lib/offline/drive/upload/drive-upload-lock-name";
import { simulateUploadMemoryReloadForTests } from "@/lib/offline/drive/upload/drive-upload-memory";
import { DriveUploader } from "@/lib/offline/drive/upload/drive-upload-runner";
import {
  driveUploadBlobsTable,
  driveUploadItemsTable,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import {
  enqueueDriveUploadBatch,
  readDriveUploadQueueRows,
  releaseDriveUploadBatch,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { subscribeDriveUploadQueue } from "@/lib/offline/drive/upload/drive-upload-subscription";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  UPLOAD_TEST_USER as user,
  uploadTestDb,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";

const folder = "/users/ada/docs";
const serverModifiedSeconds = Math.floor(Date.parse("2099-01-01T00:00:00Z") / 1000);

let lockNames: string[] = [];
let uploader: DriveUploader | null = null;
let restoreStorage: () => void = () => undefined;
let activeUploads = 0;
let maxActiveUploads = 0;

function recordingLock(): WithCrossTabLock {
  const lock = createCrossTabLock(simulateOrigin().tab("tab-a"));
  return (name, task, options) => {
    lockNames.push(name);
    return lock(name, task, options);
  };
}

async function queue(files: File[], keepOffline: "remove" | "keep" = "remove") {
  const batch = await enqueueDriveUploadBatch(user, {
    folderPath: folder,
    targetFolder: { kind: "server", id: "fn-docs" },
    files,
  });
  await releaseDriveUploadBatch(user, batch.batchId, { keepOffline });
  return batch;
}

async function runUploader(): Promise<void> {
  uploader ??= new DriveUploader(user, { lock: recordingLock() });
  uploader.wake();
  await uploader.whenIdle();
}

function uploadCalls() {
  return wgwFetch.mock.calls.filter(([path]) => String(path).startsWith("/jmap/upload/"));
}

describe("drive uploader", () => {
  beforeEach(async () => {
    online.value = true;
    Object.assign(settings, { contentSyncEnabled: true, maxFileSizeBytes: 1_000 });
    Object.assign(server, {
      maxSizeUpload: 10_000,
      nodes: [],
      createRaces: 0,
      getFailures: 0,
      setCalls: [],
    });
    lockNames = [];
    activeUploads = 0;
    maxActiveUploads = 0;
    resetDriveUploadEventsForTests();
    resetPersistentStorageRequestForTests();
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
    wgwFetch.mockReset();
    wgwFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(path).startsWith("/jmap/upload/")) {
        activeUploads += 1;
        maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeUploads -= 1;
        const size = (init?.body as Blob).size;
        return new Response(JSON.stringify({ blobId: `blob-${size}` }), { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    });
  });

  afterEach(() => {
    uploader?.stop();
    uploader = null;
    restoreStorage();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uploads one file at a time through wgwFetch under the account's uploader lock", async () => {
    const xhr = vi.fn();
    vi.stubGlobal("XMLHttpRequest", xhr);
    await queue([testFile("a.txt"), testFile("b.txt"), testFile("c.txt")]);

    await runUploader();

    const calls = uploadCalls();
    expect(calls).toHaveLength(3);
    expect(calls[0]![0]).toBe("/jmap/upload/ada/");
    expect(calls[0]![1]).toMatchObject({ method: "POST" });
    expect((calls[0]![1] as RequestInit).body).toBeInstanceOf(Blob);
    expect(maxActiveUploads).toBe(1);
    expect(xhr).not.toHaveBeenCalled();
    expect(lockNames.every((name) => name === driveUploaderLockName(user))).toBe(true);
    expect(lockNames.length).toBeGreaterThan(0);
  });

  it("replaces each placeholder with the real FileNode row", async () => {
    await queue([testFile("a.txt")]);

    await runUploader();

    const listing = await readDirectoryEntriesFromCache(user, folder);
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({
      name: "a.txt",
      nodeId: "fn-1",
      time: serverModifiedSeconds,
    });
    expect(listing[0]?.upload).toBeUndefined();
    expect((await readDriveUploadQueueRows(user)).items).toEqual([]);
  });

  it("reports per-file progress: queued, then uploading, then gone", async () => {
    const statuses: string[] = [];
    const stop = subscribeDriveUploadQueue(user, (snapshot) => {
      const item = snapshot.items[0];
      const label = item ? `${item.status}:${item.bytesDone}/${item.bytesTotal}` : "done";
      if (statuses[statuses.length - 1] !== label) statuses.push(label);
    });
    await queue([testFile("a.txt", "12345")]);

    await runUploader();
    await vi.waitFor(() => expect(statuses[statuses.length - 1]).toBe("done"));
    stop();

    expect(statuses).toContain("queued:0/5");
    expect(statuses).toContain("uploading:0/5");
  });

  it("keeps both on a name conflict with a plain create, never an update", async () => {
    server.nodes.push(
      { id: "fn-a", parentId: "fn-docs", name: "a.txt", size: 1, blobId: "old" },
      { id: "fn-a1", parentId: "fn-docs", name: "a (1).txt", size: 1, blobId: "old" },
    );
    await queue([testFile("a.txt")]);

    await runUploader();

    expect(server.nodes.map((row) => row.name)).toEqual(["a.txt", "a (1).txt", "a (2).txt"]);
    expect(server.nodes.slice(0, 2).map((row) => row.blobId)).toEqual(["old", "old"]);
    expect(server.setCalls.every((call) => !("update" in (call as object)))).toBe(true);
    const listing = await readDirectoryEntriesFromCache(user, folder);
    expect(listing.map((row) => row.name)).toEqual(["a (2).txt"]);
  });

  it("picks the next free name when a create loses a race for its name", async () => {
    server.createRaces = 1;
    await queue([testFile("a.txt")]);

    await runUploader();

    expect(server.nodes.map((row) => row.name)).toEqual(["a.txt", "a (1).txt"]);
  });

  it("does not upload or create again when the read-back after a create fails", async () => {
    server.getFailures = 1;
    await queue([testFile("a.txt")]);

    await runUploader();

    expect(server.nodes).toHaveLength(1);
    const { items } = await readDriveUploadQueueRows(user);
    expect(items).toHaveLength(1);
    expect(items[0]?.createdNodeId).toBe("fn-1");
    await driveUploadItemsTable(uploadTestDb()).update(items[0]!.id, { retryAt: 0 });

    await runUploader();

    expect(uploadCalls()).toHaveLength(1);
    expect(server.setCalls).toHaveLength(1);
    expect(server.nodes.map((row) => row.name)).toEqual(["a.txt"]);
    expect((await readDriveUploadQueueRows(user)).items).toEqual([]);
    expect((await readDirectoryEntriesFromCache(user, folder)).map((row) => row.name)).toEqual([
      "a.txt",
    ]);
  });

  it("hands a small file to the offline store as auto, with the server's modified", async () => {
    await queue([testFile("small.bin", "12345")]);

    await runUploader();

    const path = "users/ada/docs/small.bin";
    const stored = await driveContentBlobsTable(uploadTestDb()).get(path);
    expect(await stored?.blob.text()).toBe("12345");
    expect(stored!.syncedAt).toBeGreaterThanOrEqual(serverModifiedSeconds * 1000);
    expect(await readDriveAvailability(user, path)).toMatchObject({
      source: "auto",
      entryModifiedAt: serverModifiedSeconds,
    });
    wgwFetch.mockClear();
    await syncDriveContentFromCache(user, [path]);
    expect(wgwFetch).not.toHaveBeenCalled();
  });

  it("keeps a file over the limit as manual when the batch said keep", async () => {
    settings.maxFileSizeBytes = 2;
    await queue([testFile("big.bin", "12345")], "keep");

    await runUploader();

    const path = "users/ada/docs/big.bin";
    expect(await driveContentBlobsTable(uploadTestDb()).get(path)).toBeDefined();
    expect(await readDriveAvailability(user, path)).toMatchObject({
      source: "manual",
      entryModifiedAt: serverModifiedSeconds,
    });
  });

  it("drops the Blob of a file over the limit when the batch said remove", async () => {
    settings.maxFileSizeBytes = 2;
    await queue([testFile("big.bin", "12345")], "remove");

    await runUploader();

    const path = "users/ada/docs/big.bin";
    expect(await driveContentBlobsTable(uploadTestDb()).get(path)).toBeUndefined();
    expect(await readDriveAvailability(user, path)).toBeUndefined();
    expect(await driveUploadBlobsTable(uploadTestDb()).count()).toBe(0);
  });

  it("reads the device setting when the upload finishes, not when it was queued", async () => {
    await queue([testFile("small.bin", "12345")], "keep");
    settings.contentSyncEnabled = false;

    await runUploader();

    expect(await readDriveAvailability(user, "users/ada/docs/small.bin")).toMatchObject({
      source: "manual",
    });
  });

  it("still finishes the upload when the offline hand-off hits the quota", async () => {
    const blobs = driveContentBlobsTable(uploadTestDb());
    vi.spyOn(blobs, "put").mockRejectedValue(new DOMException("full", "QuotaExceededError"));
    const { batchId } = await queue([testFile("small.bin")]);

    await runUploader();

    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items).toEqual([]);
    expect(rows.batches.find((batch) => batch.id === batchId)?.notices).toEqual([
      { type: "offline_copy_failed", itemName: "small.bin", reason: "quota" },
    ]);
    const listing = await readDirectoryEntriesFromCache(user, folder);
    expect(listing.map((row) => row.nodeId)).toEqual(["fn-1"]);
  });

  it("leaves a Docs-editable file to the Docs offline path instead of handing off its Blob", async () => {
    await queue([testFile("notes.md", "# hi", "text/markdown")]);

    await runUploader();

    expect(
      await driveContentBlobsTable(uploadTestDb()).get("users/ada/docs/notes.md"),
    ).toBeUndefined();
    expect((await readDirectoryEntriesFromCache(user, folder)).map((row) => row.name)).toEqual([
      "notes.md",
    ]);
  });

  it("skips a direct file whose bytes another open tab still holds", async () => {
    const { itemIds } = await queue([testFile("theirs.bin")]);
    await driveUploadItemsTable(uploadTestDb()).update(itemIds[0]!, {
      localCopy: false,
      memoryOwner: "other-tab",
    });
    const otherTab = new BroadcastChannel("wgw-drive-upload-memory");
    otherTab.addEventListener("message", (event: MessageEvent) => {
      const message = event.data as { type: string; itemId: string; nonce: string };
      if (message.type === "probe") otherTab.postMessage({ ...message, type: "held" });
    });

    await runUploader();
    otherTab.close();

    expect((await readDriveUploadQueueRows(user)).items[0]).toMatchObject({ status: "queued" });
    expect(uploadCalls()).toHaveLength(0);
  });

  it("never uploads from two tabs at once", async () => {
    const origin = simulateOrigin();
    await queue([testFile("1.bin"), testFile("2.bin"), testFile("3.bin"), testFile("4.bin")]);
    const tabA = new DriveUploader(user, { lock: createCrossTabLock(origin.tab("a")) });
    const tabB = new DriveUploader(user, { lock: createCrossTabLock(origin.tab("b")) });

    tabA.wake();
    tabB.wake();
    await vi.waitFor(async () => expect((await readDriveUploadQueueRows(user)).items).toEqual([]), {
      timeout: 5_000,
    });
    await Promise.all([tabA.whenIdle(), tabB.whenIdle()]);
    tabA.stop();
    tabB.stop();

    expect(maxActiveUploads).toBe(1);
    expect(server.nodes.map((row) => row.name).sort()).toEqual([
      "1.bin",
      "2.bin",
      "3.bin",
      "4.bin",
    ]);
  });

  it("fails a file over maxSizeUpload as too_large and moves on", async () => {
    server.maxSizeUpload = 3;
    await queue([testFile("big.txt", "12345"), testFile("ok.txt", "12")]);

    await runUploader();

    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items.map((item) => [item.name, item.status, item.error?.code])).toEqual([
      ["big.txt", "failed", "too_large"],
    ]);
    expect(uploadCalls()).toHaveLength(1);
  });

  it("uploads a direct file from memory without an offline copy", async () => {
    restoreStorage();
    restoreStorage = stubNavigatorStorage({ estimate: async () => ({ quota: 10, usage: 9 }) });
    await queue([testFile("direct.bin", "12345")], "keep");

    await runUploader();

    expect(uploadCalls()).toHaveLength(1);
    expect(
      await driveContentBlobsTable(uploadTestDb()).get("users/ada/docs/direct.bin"),
    ).toBeUndefined();
  });

  it("fails a direct file as no_local_copy after a reload", async () => {
    restoreStorage();
    restoreStorage = stubNavigatorStorage({ estimate: async () => ({ quota: 10, usage: 9 }) });
    await queue([testFile("direct.txt")]);
    simulateUploadMemoryReloadForTests();

    await runUploader();

    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items[0]).toMatchObject({ status: "failed", error: { code: "no_local_copy" } });
    expect(uploadCalls()).toHaveLength(0);
  });

  it("waits while offline and uploads once the browser is back online", async () => {
    online.value = false;
    await queue([testFile("a.txt")]);

    await runUploader();
    expect(uploadCalls()).toHaveLength(0);

    online.value = true;
    await runUploader();
    expect(uploadCalls()).toHaveLength(1);
  });

  it("puts an item back in the queue when the network drops mid-upload", async () => {
    wgwFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await queue([testFile("a.txt")]);

    await runUploader();

    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items[0]).toMatchObject({ status: "queued", transientFailures: 0 });
    expect(rows.items[0]?.retryAt).toBeGreaterThan(Date.now());
  });

  it("makes every tab wait before retrying after a server error, and counts it", async () => {
    wgwFetch.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    await queue([testFile("a.bin")]);

    await runUploader();
    const other = new DriveUploader(user, { lock: recordingLock() });
    other.wake();
    await other.whenIdle();
    other.stop();

    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items[0]).toMatchObject({ status: "queued", transientFailures: 1 });
    expect(uploadCalls()).toHaveLength(1);
  });

  it("aborts the request in flight when stopped (sign-out) and keeps the item queued", async () => {
    let abortedRequest = false;
    wgwFetch.mockImplementationOnce(
      (_path: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            abortedRequest = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    await queue([testFile("a.bin")]);
    uploader = new DriveUploader(user, { lock: recordingLock() });
    uploader.wake();
    await vi.waitFor(() => expect(uploadCalls()).toHaveLength(1));

    uploader.stop();

    await vi.waitFor(() => expect(abortedRequest).toBe(true));
    await vi.waitFor(async () =>
      expect((await readDriveUploadQueueRows(user)).items[0]?.status).toBe("queued"),
    );
  });

  it("resumes on app start, including an item left uploading by a closed tab", async () => {
    const { itemIds } = await queue([testFile("a.txt"), testFile("b.txt")]);
    const items = driveUploadItemsTable(uploadTestDb());
    await items.update(itemIds[0]!, { status: "uploading" });

    await runUploader();

    expect((await readDriveUploadQueueRows(user)).items).toEqual([]);
    expect(server.nodes.map((row) => row.name)).toEqual(["a.txt", "b.txt"]);
  });
});
