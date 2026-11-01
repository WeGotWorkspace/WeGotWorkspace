import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCrossTabLock } from "@/lib/cross-tab/cross-tab-lock";
import { simulateOrigin } from "@/lib/cross-tab/test-utils/simulated-origin";
import {
  FakeDriveServer,
  fileBytes,
  memoryLocalStorage,
  patternedFile,
} from "@/lib/offline/drive/upload/drive-upload-fake-server.fixture";

const online = vi.hoisted(() => ({ value: true }));
const fake = vi.hoisted(() => ({ server: null as unknown as FakeDriveServer }));
const clearWgwSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  readBrowserOnline: () => online.value,
  getConnectivitySnapshot: () => online.value,
}));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwFetch: (path: string, init?: RequestInit) => fake.server.fetch(path, init),
  clearWgwSession,
}));

vi.mock("@/lib/api/wgw/drive-jmap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/drive-jmap")>()),
  driveJmapSession: async () => fake.server.session(),
}));

import { driveUploadRowState } from "@/drive-core/src/drive-upload-row-state";
import { readDirectoryEntriesFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { applyFetchedDirectorySnapshot } from "@/lib/offline/drive/drive-fetched-set-prune";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { resetDriveUploadEventsForTests } from "@/lib/offline/drive/upload/drive-upload-events";
import { DriveUploader } from "@/lib/offline/drive/upload/drive-upload-runner";
import {
  driveUploadBlobsTable,
  driveUploadItemsTable,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import {
  enqueueDriveUploadBatch,
  readDriveUploadQueueRows,
  releaseDriveUploadBatch,
  resumeDriveUploadQueue,
  retargetDriveUploadItem,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { readDriveUploadQueueSnapshot } from "@/lib/offline/drive/upload/drive-upload-subscription";
import { rememberDriveFolderNodeId } from "@/lib/offline/drive/upload/drive-upload-target";
import { resetDriveUploadTargetChecksForTests } from "@/lib/offline/drive/upload/drive-upload-target-check";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  UPLOAD_TEST_USER as user,
  uploadTestDb,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const folder = "/users/ada/docs";

let server: FakeDriveServer;
let uploader: DriveUploader | null = null;
let restoreStorage: () => void = () => undefined;

async function queue(files: File[]) {
  const batch = await enqueueDriveUploadBatch(user, {
    folderPath: folder,
    targetFolder: { kind: "server", id: "fn-docs" },
    files,
  });
  await releaseDriveUploadBatch(user, batch.batchId, { keepOffline: "remove" });
  return batch;
}

async function runUploader(): Promise<void> {
  uploader ??= new DriveUploader(user, { lock: createCrossTabLock(simulateOrigin().tab("tab-a")) });
  uploader.wake();
  await uploader.whenIdle();
}

/** A fresh uploader, as after a reload. */
async function reload(): Promise<void> {
  await uploader?.stop();
  uploader = null;
}

async function items() {
  return (await readDriveUploadQueueRows(user)).items;
}

/** Lets the next uploader cycle ask the server for room right away. */
async function makeSpaceCheckDue(itemId: string): Promise<void> {
  await driveUploadItemsTable(uploadTestDb()).update(itemId, { retryAt: 0 });
}

describe("drive uploader error classes, server-full pause, and re-targeting", () => {
  beforeEach(async () => {
    online.value = true;
    server = new FakeDriveServer();
    server.maxSizeUpload = 200;
    server.stepBudgetBytes = 400;
    fake.server = server;
    clearWgwSession.mockClear();
    vi.stubGlobal("localStorage", memoryLocalStorage());
    resetDriveUploadEventsForTests();
    resetPersistentStorageRequestForTests();
    resetDriveUploadTargetChecksForTests();
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
    await rememberDriveFolderNodeId(user, "users/ada", "fn-home");
  });

  afterEach(async () => {
    await uploader?.stop();
    uploader = null;
    restoreStorage();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("server full", () => {
    async function fillUpDuringFirstFile() {
      const batch = await queue([patternedFile("big.bin", 1_000), patternedFile("next.bin", 100)]);
      const original = server.fetch.bind(server);
      let calls = 0;
      vi.spyOn(server, "fetch").mockImplementation(async (path, init) => {
        calls += 1;
        if (calls === 3) server.full = true;
        return original(path, init);
      });
      await runUploader();
      return batch;
    }

    it("pauses the whole queue without backoff: no other file starts", async () => {
      await fillUpDuringFirstFile();

      const [big, next] = await items();
      expect(big).toMatchObject({ status: "failed", error: { code: "server_full" } });
      expect(big?.transientFailures).toBe(0);
      expect(next).toMatchObject({ status: "queued", bytesDone: 0 });
      expect(server.uploads).toHaveLength(3);
      const snapshot = await readDriveUploadQueueSnapshot(user);
      expect(snapshot.state).toBe("paused_server_full");
      const waiting = snapshot.items.find((item) => item.name === "next.bin")!;
      expect(
        driveUploadRowState(
          { id: waiting.id, status: "queued" },
          { item: waiting, queueState: snapshot.state },
        ).statusText,
      ).toBe("Waiting for space on the server");

      // Waking again does not start anything: the server has not said it has room.
      await runUploader();
      expect(server.uploads).toHaveLength(3);
      expect(server.callsNamed("Quota/get")).toHaveLength(0);
    });

    it("resumes on Retry, from the stored parts, and then uploads the rest", async () => {
      const big = patternedFile("big.bin", 1_000);
      await fillUpDuringFirstFile();
      server.full = false;
      server.uploads.length = 0;

      expect(await resumeDriveUploadQueue(user)).toBe(1);
      await runUploader();

      expect(server.uploads.map((upload) => upload.length)).toEqual([200, 200, 200, 100]);
      expect(await items()).toEqual([]);
      const node = server.nodes.find((row) => row.name === "big.bin")!;
      expect(server.bytesOf(node.blobId)).toEqual(await fileBytes(big));
      expect((await readDriveUploadQueueSnapshot(user)).state).toBe("idle");
    });

    it("resumes on its own once Quota/get reports room for the next file in its root", async () => {
      await fillUpDuringFirstFile();
      const [held] = await items();
      server.full = false;
      // 600 bytes are left to send; the personal drive has only 500 free.
      server.quotas = [
        { id: "dq-fn-home", used: 9_500, hardLimit: 10_000 },
        { id: "dq-fn-team", used: 0, hardLimit: 1_000_000 },
      ];
      await makeSpaceCheckDue(held!.id);
      await runUploader();

      expect(server.callsNamed("Quota/get")).toHaveLength(1);
      const stillHeld = (await items())[0]!;
      expect(stillHeld).toMatchObject({ status: "failed", error: { code: "server_full" } });
      // The next question waits a while, in every tab.
      expect(stillHeld.retryAt).toBeGreaterThan(Date.now());

      server.quotas = [{ id: "dq-fn-home", used: 9_000, hardLimit: 10_000 }];
      await makeSpaceCheckDue(held!.id);
      server.uploads.length = 0;
      await runUploader();

      expect(server.callsNamed("Quota/get")).toHaveLength(2);
      expect(server.uploads.map((upload) => upload.length)).toEqual([200, 200, 200, 100]);
      expect(await items()).toEqual([]);
    });
  });

  it("fails as forbidden when write access to the folder is gone, without a sign-in", async () => {
    server.folders.get("fn-docs")!.mayAddChildren = false;
    const [id] = (await queue([patternedFile("a.bin", 100)])).itemIds;
    await runUploader();

    const [item] = await items();
    expect(item).toMatchObject({ id, status: "failed", error: { code: "forbidden" } });
    expect(server.uploads).toHaveLength(0);
    expect(clearWgwSession).not.toHaveBeenCalled();
    const snapshot = await readDriveUploadQueueSnapshot(user);
    expect(snapshot.items[0]?.canRetry).toBe(true);
  });

  it("fails as auth on a 401 from the server", async () => {
    vi.spyOn(server, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    await queue([patternedFile("a.bin", 100)]);
    await runUploader();

    expect((await items())[0]).toMatchObject({ status: "failed", error: { code: "auth" } });
  });

  it("uploads into a folder that was renamed and moved while the file waited", async () => {
    const file = patternedFile("a.bin", 100);
    await queue([file]);
    server.folders.set("fn-archive", { id: "fn-archive", parentId: "fn-home", name: "archive" });
    server.folders.set("fn-docs", { id: "fn-docs", parentId: "fn-archive", name: "docs 2026" });
    await runUploader();

    const node = server.nodes.find((row) => row.name === "a.bin")!;
    expect(node.parentId).toBe("fn-docs");
    expect(server.bytesOf(node.blobId)).toEqual(await fileBytes(file));
  });

  it("fails as target_missing when the folder is in the trash, sending no bytes", async () => {
    server.folders.get("fn-docs")!.parentId = "fn-trash";
    await queue([patternedFile("a.bin", 100)]);
    await runUploader();

    expect((await items())[0]).toMatchObject({
      status: "failed",
      error: { code: "target_missing" },
    });
    expect(server.uploads).toHaveLength(0);
    expect(server.nodes).toHaveLength(0);
  });

  it("re-targets a target_missing file to another folder, keeping its stored file", async () => {
    const file = patternedFile("a.bin", 100);
    server.folders.delete("fn-docs");
    const [id] = (await queue([file])).itemIds;
    await runUploader();
    expect((await items())[0]).toMatchObject({
      status: "failed",
      error: { code: "target_missing" },
    });

    server.folders.set("fn-other", { id: "fn-other", parentId: "fn-home", name: "other" });
    const moved = await retargetDriveUploadItem(user, id!, {
      folderPath: "/users/ada/other",
      targetFolder: { kind: "server", id: "fn-other" },
    });
    expect(moved).toBe(true);
    expect(await readDirectoryEntriesFromCache(user, folder)).toEqual([]);
    const [placeholder] = await readDirectoryEntriesFromCache(user, "/users/ada/other");
    expect(placeholder?.upload).toMatchObject({ id, status: "queued" });

    await runUploader();

    const node = server.nodes.find((row) => row.name === "a.bin")!;
    expect(node.parentId).toBe("fn-other");
    expect(server.bytesOf(node.blobId)).toEqual(await fileBytes(file));
    expect(await items()).toEqual([]);
  });

  it("keeps failed files with their stored file across a reload and a folder refresh", async () => {
    server.folders.delete("fn-docs");
    const [id] = (await queue([patternedFile("a.bin", 100)])).itemIds;
    await runUploader();
    await reload();
    await runUploader();
    // The folder listing (here empty) never prunes the failed placeholder.
    await applyFetchedDirectorySnapshot(user, "users/ada/docs", []);

    expect((await items()).map((item) => [item.id, item.status, item.error?.code])).toEqual([
      [id, "failed", "target_missing"],
    ]);
    expect(await driveUploadBlobsTable(uploadTestDb()).get(id!)).toBeDefined();
    const [placeholder] = await readDirectoryEntriesFromCache(user, folder);
    expect(placeholder?.upload).toMatchObject({ id, status: "failed", reason: "target_missing" });
  });

  it("refuses to re-target a file that is uploading or already created", async () => {
    const [id] = (await queue([patternedFile("a.bin", 100)])).itemIds;
    const target = { folderPath: "/users/ada/x", targetFolder: { kind: "server", id: "x" } };
    await driveUploadItemsTable(uploadTestDb()).update(id!, { status: "uploading" });
    expect(await retargetDriveUploadItem(user, id!, target as never)).toBe(false);
    await driveUploadItemsTable(uploadTestDb()).update(id!, {
      status: "failed",
      createdNodeId: "fn-9",
    });
    expect(await retargetDriveUploadItem(user, id!, target as never)).toBe(false);
    expect(await retargetDriveUploadItem(user, "missing", target as never)).toBe(false);
  });
});
