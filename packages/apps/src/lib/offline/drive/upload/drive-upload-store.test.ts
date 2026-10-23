import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readDirectoryEntriesFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import {
  driveUploadBatchesTable,
  driveUploadBlobsTable,
  driveUploadItemsTable,
} from "@/lib/offline/drive/upload/drive-upload-schema";
import {
  cancelDriveUploadBatch,
  enqueueDriveUploadBatch,
  failDriveUpload,
  hasPendingDriveUploads,
  listStartableDriveUploads,
  markDriveUploadStarted,
  readDriveUploadBlob,
  releaseDriveUploadBatch,
  removeDriveUploadItem,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { uploadFromMemory } from "@/lib/offline/drive/upload/drive-upload-memory";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  UPLOAD_TEST_USER as user,
  uploadTestDb,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import { wipeOfflineAccountData } from "@/lib/offline/core/offline-wipe";

const folder = "/users/ada/reports";
const target = { kind: "server" as const, id: "fn-reports" };

async function enqueue(files: File[]) {
  return enqueueDriveUploadBatch(user, { folderPath: folder, targetFolder: target, files });
}

describe("drive upload store", () => {
  let restoreStorage: () => void = () => undefined;

  beforeEach(async () => {
    await clearUploadTestDb();
    resetPersistentStorageRequestForTests();
    restoreStorage = stubNavigatorStorage(undefined);
  });

  afterEach(() => {
    restoreStorage();
    vi.restoreAllMocks();
  });

  it("stores each picked file as a Blob with its size and folder id before any dialog", async () => {
    const { batchId, itemIds } = await enqueue([
      testFile("a.txt", "alpha"),
      testFile("b.txt", "be"),
    ]);

    const batch = await driveUploadBatchesTable(uploadTestDb()).get(batchId);
    expect(batch).toMatchObject({ status: "awaiting_input", targetFolder: target, notices: [] });
    const items = await driveUploadItemsTable(uploadTestDb()).bulkGet(itemIds);
    expect(items.map((item) => [item?.name, item?.size, item?.status, item?.targetFolder])).toEqual(
      [
        ["a.txt", 5, "queued", target],
        ["b.txt", 2, "queued", target],
      ],
    );
    const stored = await readDriveUploadBlob(user, itemIds[0]!);
    expect(stored).toBeInstanceOf(Blob);
    expect(await stored!.text()).toBe("alpha");
  });

  it("shows a placeholder per file in the folder listing right away", async () => {
    await upsertDriveEntry(user, {
      type: "file",
      path: `${folder}/a.txt`,
      name: "a.txt",
      size: 1,
      time: 1,
      permissions: 0,
      myRights: fullDriveMyRights,
      nodeId: "fn-existing",
    });
    const { batchId, itemIds } = await enqueue([testFile("a.txt"), testFile("a.txt")]);

    const listing = await readDirectoryEntriesFromCache(user, folder);
    const placeholders = listing.filter((entry) => entry.upload);
    expect(placeholders).toHaveLength(2);
    expect(placeholders.map((entry) => entry.name)).toEqual(["a.txt", "a.txt"]);
    expect(placeholders.map((entry) => entry.upload)).toEqual(
      expect.arrayContaining([
        { id: itemIds[0], batchId, status: "queued" },
        { id: itemIds[1], batchId, status: "queued" },
      ]),
    );
    // The real file with the same name is untouched.
    expect(listing.find((entry) => entry.nodeId === "fn-existing")?.name).toBe("a.txt");
  });

  it("keeps an awaiting_input batch away from the uploader until it is released", async () => {
    const { batchId } = await enqueue([testFile("a.txt")]);
    expect(await listStartableDriveUploads(user)).toHaveLength(0);

    await releaseDriveUploadBatch(user, batchId, { keepOffline: "keep" });

    expect(await listStartableDriveUploads(user)).toHaveLength(1);
    expect((await driveUploadBatchesTable(uploadTestDb()).get(batchId))?.keepOffline).toBe("keep");
  });

  it("removes the batch, its placeholders, and its Blobs on Cancel", async () => {
    const { batchId, itemIds } = await enqueue([testFile("a.txt"), testFile("b.txt")]);
    const other = await enqueue([testFile("c.txt")]);

    await cancelDriveUploadBatch(user, batchId);

    const db = uploadTestDb();
    expect(await driveUploadBatchesTable(db).get(batchId)).toBeUndefined();
    expect(await driveUploadItemsTable(db).bulkGet(itemIds)).toEqual([undefined, undefined]);
    expect(await driveUploadBlobsTable(db).count()).toBe(1);
    const listing = await readDirectoryEntriesFromCache(user, folder);
    expect(listing.map((entry) => entry.upload?.batchId)).toEqual([other.batchId]);
  });

  it("removes a queued item before upload, with its Blob and placeholder", async () => {
    const { batchId, itemIds } = await enqueue([testFile("a.txt"), testFile("b.txt")]);
    await releaseDriveUploadBatch(user, batchId, { keepOffline: "remove" });

    expect(await removeDriveUploadItem(user, itemIds[0]!)).toBe(true);

    expect(await readDriveUploadBlob(user, itemIds[0]!)).toBeNull();
    const listing = await readDirectoryEntriesFromCache(user, folder);
    expect(listing.map((entry) => entry.upload?.id)).toEqual([itemIds[1]]);
    expect(await driveUploadBatchesTable(uploadTestDb()).get(batchId)).toBeDefined();
  });

  it("removes a failed item and drops the batch once it is empty", async () => {
    const { batchId, itemIds } = await enqueue([testFile("a.txt")]);
    await failDriveUpload(user, itemIds[0]!, { code: "upload_failed", message: "nope" });
    expect((await readDirectoryEntriesFromCache(user, folder))[0]?.upload?.status).toBe("failed");

    expect(await removeDriveUploadItem(user, itemIds[0]!)).toBe(true);

    expect(await hasPendingDriveUploads(user)).toBe(false);
    expect(await driveUploadBatchesTable(uploadTestDb()).get(batchId)).toBeUndefined();
  });

  it("does not remove an item that is uploading right now", async () => {
    const { batchId, itemIds } = await enqueue([testFile("a.txt")]);
    await releaseDriveUploadBatch(user, batchId, { keepOffline: "remove" });
    await markDriveUploadStarted(user, itemIds[0]!);

    expect(await removeDriveUploadItem(user, itemIds[0]!)).toBe(false);
    expect(await hasPendingDriveUploads(user)).toBe(true);
  });

  it("is wiped with the rest of the offline data on sign-out", async () => {
    await enqueue([testFile("a.txt")]);
    expect(await hasPendingDriveUploads(user)).toBe(true);

    await wipeOfflineAccountData();

    expect(await hasPendingDriveUploads(user)).toBe(false);
  });

  it("keeps a file in memory and marks it when the device has no room", async () => {
    restoreStorage();
    restoreStorage = stubNavigatorStorage({
      estimate: async () => ({ quota: 100 * 1024 * 1024, usage: 99 * 1024 * 1024 }),
      persist: async () => true,
    });
    const file = testFile("big.bin", "x".repeat(10));

    const { itemIds } = await enqueue([file]);

    const item = await driveUploadItemsTable(uploadTestDb()).get(itemIds[0]!);
    expect(item).toMatchObject({ localCopy: false, status: "queued" });
    expect(item?.memoryOwner).toBeTruthy();
    expect(await readDriveUploadBlob(user, itemIds[0]!)).toBeNull();
    expect(uploadFromMemory(itemIds[0]!)).toBe(file);
  });

  it("reports a quota error from IndexedDB on that file only", async () => {
    const blobs = driveUploadBlobsTable(uploadTestDb());
    const realPut = blobs.put.bind(blobs);
    const quotaPut = (row: { id: string; blob: Blob }, key?: string) => {
      if (row.blob instanceof File && row.blob.name === "full.bin") {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      return realPut(row, key);
    };
    vi.spyOn(blobs, "put").mockImplementation(quotaPut as typeof blobs.put);

    const { itemIds } = await enqueue([testFile("full.bin"), testFile("fine.txt")]);

    const items = await driveUploadItemsTable(uploadTestDb()).bulkGet(itemIds);
    expect(items[0]).toMatchObject({
      status: "failed",
      error: { code: "quota" },
      localCopy: false,
    });
    expect(items[1]).toMatchObject({ status: "queued", localCopy: true });
    const listing = await readDirectoryEntriesFromCache(user, folder);
    const byName = Object.fromEntries(listing.map((entry) => [entry.name, entry.upload?.status]));
    expect(byName).toEqual({ "full.bin": "failed", "fine.txt": "queued" });
  });
});
