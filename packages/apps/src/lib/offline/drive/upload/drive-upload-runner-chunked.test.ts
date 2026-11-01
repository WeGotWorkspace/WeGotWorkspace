import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
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

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  readBrowserOnline: () => online.value,
  getConnectivitySnapshot: () => online.value,
}));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwFetch: (path: string, init?: RequestInit) => fake.server.fetch(path, init),
}));

vi.mock("@/lib/api/wgw/drive-jmap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/drive-jmap")>()),
  driveJmapSession: async () => fake.server.session(),
}));

import { resetDriveUploadEventsForTests } from "@/lib/offline/drive/upload/drive-upload-events";
import { DriveUploader } from "@/lib/offline/drive/upload/drive-upload-runner";
import {
  dismissDriveUploadBatchNotices,
  enqueueDriveUploadBatch,
  readDriveUploadQueueRows,
  releaseDriveUploadBatch,
  retryDriveUploadItem,
  type DriveUploadBatchReleaseAnswers,
} from "@/lib/offline/drive/upload/drive-upload-store";
import {
  subscribeDriveUploadQueue,
  type DriveUploadQueueSnapshot,
} from "@/lib/offline/drive/upload/drive-upload-subscription";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { readDirectoryEntriesFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  UPLOAD_TEST_USER as user,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const folder = "/users/ada/docs";

let server: FakeDriveServer;
let uploader: DriveUploader | null = null;
let restoreStorage: () => void = () => undefined;

async function queue(files: File[], answers: Partial<DriveUploadBatchReleaseAnswers> = {}) {
  const batch = await enqueueDriveUploadBatch(user, {
    folderPath: folder,
    targetFolder: { kind: "server", id: "fn-docs" },
    files,
  });
  const replaceTargets = answers.replaceTargets
    ? Object.fromEntries(
        Object.values(answers.replaceTargets).map((target, index) => [
          batch.itemIds[index]!,
          target,
        ]),
      )
    : undefined;
  await releaseDriveUploadBatch(user, batch.batchId, {
    keepOffline: "remove",
    ...answers,
    ...(replaceTargets ? { replaceTargets } : {}),
  });
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

describe("drive uploader with parts, resume, and the conflict policy", () => {
  beforeEach(async () => {
    online.value = true;
    server = new FakeDriveServer();
    server.maxSizeUpload = 200;
    server.stepBudgetBytes = 400;
    fake.server = server;
    vi.stubGlobal("localStorage", memoryLocalStorage());
    resetDriveUploadEventsForTests();
    resetPersistentStorageRequestForTests();
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
  });

  afterEach(async () => {
    await uploader?.stop();
    uploader = null;
    restoreStorage();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uploads a large file in parts and replaces its placeholder with the real file", async () => {
    const file = patternedFile("big.bin", 1_000);
    await queue([file]);
    await runUploader();

    expect((await readDriveUploadQueueRows(user)).items).toEqual([]);
    expect(server.uploads.map((upload) => upload.length)).toEqual([200, 200, 200, 200, 200]);
    const node = server.nodes.find((row) => row.name === "big.bin")!;
    expect(server.bytesOf(node.blobId)).toEqual(await fileBytes(file));
    const listing = await readDirectoryEntriesFromCache(user, folder);
    expect(listing.map((entry) => [entry.name, Boolean(entry.upload)])).toEqual([
      ["big.bin", false],
    ]);
  });

  it("shows the assembling phase with its own progress in the queue snapshot", async () => {
    const snapshots: DriveUploadQueueSnapshot[] = [];
    const stop = subscribeDriveUploadQueue(user, (snapshot) => snapshots.push(snapshot));
    await queue([patternedFile("big.bin", 1_000)]);
    await runUploader();
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();

    const assembling = snapshots
      .flatMap((snapshot) => snapshot.items)
      .filter((item) => item.phase === "assembling");
    expect(assembling.length).toBeGreaterThan(0);
    expect(assembling.every((item) => item.bytesDone === item.bytesTotal)).toBe(true);
    expect(assembling.some((item) => (item.assembledBytes ?? 0) > 0)).toBe(true);
  });

  it("resumes an unfinished upload from the next part after a reload", async () => {
    const file = patternedFile("big.bin", 1_000);
    await queue([file]);
    const original = server.fetch.bind(server);
    let calls = 0;
    vi.spyOn(server, "fetch").mockImplementation(async (path, init) => {
      calls += 1;
      if (calls === 3) {
        // The tab goes away in the middle of the third part.
        online.value = false;
        throw new TypeError("Failed to fetch");
      }
      return original(path, init);
    });
    await runUploader();
    const stopped = (await readDriveUploadQueueRows(user)).items[0]!;
    expect(stopped.status).toBe("queued");
    expect(stopped.chunk?.parts).toHaveLength(2);
    expect(stopped.bytesDone).toBe(400);

    await reload();
    online.value = true;
    server.uploads.length = 0;
    await runUploader();

    expect(server.uploads.map((upload) => upload.length)).toEqual([200, 200, 200]);
    expect(server.callsNamed("BlobAssembly/set")).toHaveLength(1);
    const node = server.nodes.find((row) => row.name === "big.bin")!;
    expect(server.bytesOf(node.blobId)).toEqual(await fileBytes(file));
  });

  it("stops on a 507 without retrying, keeps the parts, and resumes only on Retry", async () => {
    const file = patternedFile("big.bin", 1_000);
    const { itemIds } = await queue([file]);
    const original = server.fetch.bind(server);
    let calls = 0;
    vi.spyOn(server, "fetch").mockImplementation(async (path, init) => {
      calls += 1;
      if (calls === 3) server.full = true;
      return original(path, init);
    });
    await runUploader();

    const failed = (await readDriveUploadQueueRows(user)).items[0]!;
    expect(failed).toMatchObject({ status: "failed", error: { code: "server_full" } });
    expect(failed.retryAt).toBeUndefined();
    expect(failed.transientFailures).toBe(0);
    expect(failed.chunk?.parts).toHaveLength(2);
    expect(server.uploads).toHaveLength(3);

    // Nothing happens until the user retries.
    await runUploader();
    expect(server.uploads).toHaveLength(3);

    server.full = false;
    server.uploads.length = 0;
    expect(await retryDriveUploadItem(user, itemIds[0]!)).toBe(true);
    await runUploader();
    expect(server.uploads.map((upload) => upload.length)).toEqual([200, 200, 200]);
    expect((await readDriveUploadQueueRows(user)).items).toEqual([]);
  });

  it("fails a large file with insecure_context without crypto.subtle; a small one still uploads", async () => {
    vi.stubGlobal("crypto", { randomUUID });
    await queue([patternedFile("big.bin", 1_000), patternedFile("small.bin", 100)]);
    await runUploader();

    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items.map((item) => [item.name, item.status, item.error?.code])).toEqual([
      ["big.bin", "failed", "insecure_context"],
    ]);
    expect(server.uploads.map((upload) => upload.length)).toEqual([100]);
    const listing = await readDirectoryEntriesFromCache(user, folder);
    expect(listing.find((entry) => entry.name === "big.bin")?.upload).toMatchObject({
      status: "failed",
      reason: "insecure_context",
    });
  });

  it("skips only the colliding file and its placeholder", async () => {
    server.nodes.push({ id: "fn-a", parentId: "fn-docs", name: "a.txt", blobId: "jb-a" });
    await queue([patternedFile("a.txt", 10), patternedFile("b.txt", 10)], { conflict: "skip" });
    await runUploader();

    expect((await readDriveUploadQueueRows(user)).items).toEqual([]);
    expect(server.nodes.map((row) => row.name)).toEqual(["a.txt", "b.txt"]);
    const listing = await readDirectoryEntriesFromCache(user, folder);
    expect(listing.map((entry) => entry.name)).toEqual(["b.txt"]);
  });

  it("keeps the replace_fell_back notice after the file finished, until the user saw it", async () => {
    server.nodes.push({
      id: "fn-r",
      parentId: "fn-docs",
      name: "report.pdf",
      blobId: "jb-changed",
    });
    const { batchId } = await queue([patternedFile("report.pdf", 10)], {
      conflict: "replace",
      replaceTargets: { first: { nodeId: "fn-r", blobId: "jb-seen" } },
    });
    await runUploader();

    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items).toEqual([]);
    expect(rows.batches.find((batch) => batch.id === batchId)?.notices).toEqual([
      { type: "replace_fell_back", itemName: "report.pdf", keptAsName: "report (1).pdf" },
    ]);
    expect(server.nodes.find((row) => row.id === "fn-r")?.blobId).toBe("jb-changed");

    await dismissDriveUploadBatchNotices(user, batchId);
    expect((await readDriveUploadQueueRows(user)).batches).toEqual([]);
  });

  it("replaces the file the user saw when it did not change", async () => {
    server.nodes.push({ id: "fn-r", parentId: "fn-docs", name: "report.pdf", blobId: "jb-seen" });
    const file = patternedFile("report.pdf", 10);
    await queue([file], {
      conflict: "replace",
      replaceTargets: { first: { nodeId: "fn-r", blobId: "jb-seen" } },
    });
    await runUploader();

    expect(server.nodes).toHaveLength(1);
    expect(server.bytesOf(server.nodes[0]!.blobId)).toEqual(await fileBytes(file));
    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items).toEqual([]);
    expect(rows.batches).toEqual([]);
  });

  it("records a kept_both notice for a conflict found at upload time in a batch without a choice", async () => {
    server.nodes.push({ id: "fn-a", parentId: "fn-docs", name: "a.txt", blobId: "jb-a" });
    const { batchId } = await queue([patternedFile("a.txt", 10)]);
    await runUploader();

    const rows = await readDriveUploadQueueRows(user);
    expect(rows.batches.find((batch) => batch.id === batchId)?.notices).toEqual([
      { type: "kept_both", itemName: "a.txt", keptAsName: "a (1).txt" },
    ]);
  });
});
