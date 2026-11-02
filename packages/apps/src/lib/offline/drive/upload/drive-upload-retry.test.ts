import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDirectoryEntriesFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { driveUploadItemsTable } from "@/lib/offline/drive/upload/drive-upload-schema";
import {
  enqueueDriveUploadBatch,
  failDriveUpload,
  listStartableDriveUploads,
  releaseDriveUploadBatch,
  requeueDriveUpload,
  retryAllFailedDriveUploads,
  retryDriveUploadItem,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { readDriveUploadQueueSnapshot } from "@/lib/offline/drive/upload/drive-upload-subscription";
import {
  resetSharedDriveUploadQueueWatches,
  sharedDriveUploadQueueWatch,
} from "@/lib/offline/drive/upload/drive-upload-queue-watch";
import { resetDriveUploadEventsForTests } from "@/lib/offline/drive/upload/drive-upload-events";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  UPLOAD_TEST_USER as user,
  uploadTestDb,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const folder = "/users/ada/reports";
const target = { kind: "server" as const, id: "fn-reports" };

async function released(names: string[]) {
  const files = names.map((name) => testFile(name));
  const batch = await enqueueDriveUploadBatch(user, {
    folderPath: folder,
    targetFolder: target,
    files,
  });
  await releaseDriveUploadBatch(user, batch.batchId, { keepOffline: "remove" });
  return batch;
}

describe("drive upload retry", () => {
  let restoreStorage: () => void = () => undefined;

  beforeEach(async () => {
    resetDriveUploadEventsForTests();
    resetSharedDriveUploadQueueWatches();
    await clearUploadTestDb();
    resetPersistentStorageRequestForTests();
    restoreStorage = stubNavigatorStorage(undefined);
  });

  afterEach(() => {
    restoreStorage();
    vi.restoreAllMocks();
  });

  it("puts a failed file back in the queue with a clean slate", async () => {
    const { itemIds } = await released(["a.txt"]);
    const id = itemIds[0]!;
    await requeueDriveUpload(user, id, { countFailure: true, retryAt: Date.now() + 60_000 });
    await failDriveUpload(user, id, { code: "permanent", message: "nope" });
    expect(await listStartableDriveUploads(user)).toEqual([]);

    expect(await retryDriveUploadItem(user, id)).toBe(true);

    const row = await driveUploadItemsTable(uploadTestDb()).get(id);
    expect(row).toMatchObject({ status: "queued", transientFailures: 0, bytesDone: 0 });
    expect(row?.error).toBeUndefined();
    expect(row?.retryAt).toBeUndefined();
    expect((await listStartableDriveUploads(user)).map((item) => item.id)).toEqual([id]);
    const [placeholder] = await readDirectoryEntriesFromCache(user, folder);
    expect(placeholder?.upload).toMatchObject({ status: "queued" });
    expect(placeholder?.upload?.reason).toBeUndefined();
  });

  it("refuses files whose bytes are gone, and files that did not fail", async () => {
    const { itemIds } = await released(["gone.bin", "full.bin", "waiting.txt"]);
    await failDriveUpload(user, itemIds[0]!, { code: "no_local_copy", message: "gone" });
    // The device refused to store it: no local copy.
    await driveUploadItemsTable(uploadTestDb()).update(itemIds[1]!, { localCopy: false });
    await failDriveUpload(user, itemIds[1]!, { code: "quota", message: "full" });

    expect(await retryDriveUploadItem(user, itemIds[0]!)).toBe(false);
    expect(await retryDriveUploadItem(user, itemIds[1]!)).toBe(false);
    expect(await retryDriveUploadItem(user, itemIds[2]!)).toBe(false);
    expect(await retryDriveUploadItem(user, "missing")).toBe(false);
  });

  it("retries every failed file that can be retried at once", async () => {
    const { itemIds } = await released(["a.txt", "b.txt", "c.txt"]);
    await failDriveUpload(user, itemIds[0]!, { code: "too_large", message: "big" });
    await failDriveUpload(user, itemIds[1]!, { code: "no_local_copy", message: "gone" });
    await failDriveUpload(user, itemIds[2]!, { code: "permanent", message: "nope" });

    expect(await retryAllFailedDriveUploads(user)).toBe(2);

    const snapshot = await readDriveUploadQueueSnapshot(user);
    expect(snapshot.items.map((item) => [item.name, item.status, item.canRetry])).toEqual([
      ["a.txt", "queued", false],
      ["b.txt", "failed", false],
      ["c.txt", "queued", false],
    ]);
  });

  it("reports each file's target folder for the Uploads view", async () => {
    await released(["a.txt"]);
    const snapshot = await readDriveUploadQueueSnapshot(user);
    expect(snapshot.items[0]?.folderPath).toBe("users/ada/reports");
  });

  it("shares one queue subscription and replays the last snapshot to a new listener", async () => {
    await released(["a.txt"]);
    const watch = sharedDriveUploadQueueWatch(user);
    expect(sharedDriveUploadQueueWatch(user.toUpperCase())).toBe(watch);
    const first = vi.fn();
    const stopFirst = watch(first);
    await vi.waitFor(() => expect(first).toHaveBeenCalled());

    const second = vi.fn();
    const stopSecond = watch(second);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]?.[0].items).toHaveLength(1);
    stopFirst();
    stopSecond();
  });
});
