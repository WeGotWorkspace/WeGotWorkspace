import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import {
  downloadQueuedDriveUpload,
  DriveUploadLocalFileMissingError,
  readQueuedDriveUploadFile,
} from "@/lib/offline/drive/upload/drive-upload-local-file";
import { forgetUploadInMemory } from "@/lib/offline/drive/upload/drive-upload-memory";
import {
  enqueueDriveUploadBatch,
  removeDriveUploadItem,
} from "@/lib/offline/drive/upload/drive-upload-store";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  UPLOAD_TEST_USER as user,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/offline/docs/docs-offline-download", () => ({
  triggerBrowserBlobDownload: download,
}));

const target = { kind: "server" as const, id: "fn-reports" };

async function enqueue(file: File): Promise<string> {
  const { itemIds } = await enqueueDriveUploadBatch(user, {
    folderPath: "/users/ada/reports",
    targetFolder: target,
    files: [file],
  });
  return itemIds[0]!;
}

async function updateItem(itemId: string, changes: Record<string, unknown>): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(user));
  await db.table("drive_upload_items").update(itemId, changes);
}

function deviceAlmostFull(): () => void {
  return stubNavigatorStorage({
    estimate: async () => ({ quota: 100 * 1024 * 1024, usage: 99 * 1024 * 1024 }),
    persist: async () => true,
  });
}

describe("files still in the upload queue", () => {
  let restoreStorage: () => void = () => undefined;

  beforeAll(async () => {
    await Promise.all([import("dexie"), import("@/lib/offline/core/offline-db")]);
  }, 30_000);

  beforeEach(async () => {
    await clearUploadTestDb();
    resetPersistentStorageRequestForTests();
    restoreStorage = stubNavigatorStorage(undefined);
    download.mockReset();
  });

  afterEach(() => restoreStorage());

  it("reads the stored copy under the file's own name", async () => {
    const itemId = await enqueue(testFile("plan.txt", "draft one"));

    const file = await readQueuedDriveUploadFile(user, itemId);

    expect(file?.name).toBe("plan.txt");
    expect(await file?.blob.text()).toBe("draft one");
  });

  it("reads the file this tab keeps in memory when the device had no room", async () => {
    restoreStorage();
    restoreStorage = deviceAlmostFull();
    const picked = testFile("big.bin", "x".repeat(10));
    const itemId = await enqueue(picked);

    expect((await readQueuedDriveUploadFile(user, itemId))?.blob).toBe(picked);
  });

  it("says where the bytes are when another tab holds them", async () => {
    restoreStorage();
    restoreStorage = deviceAlmostFull();
    const itemId = await enqueue(testFile("big.bin", "x".repeat(10)));
    forgetUploadInMemory(itemId);
    await updateItem(itemId, { memoryOwner: "another-tab" });

    await expect(readQueuedDriveUploadFile(user, itemId)).rejects.toThrow(
      /still uploading from another window/,
    );
  });

  it("says the file is gone, not held elsewhere, for a failed item without bytes", async () => {
    restoreStorage();
    restoreStorage = deviceAlmostFull();
    const itemId = await enqueue(testFile("big.bin", "x".repeat(10)));
    forgetUploadInMemory(itemId);
    await updateItem(itemId, { memoryOwner: "another-tab", status: "failed", errorCode: "quota" });

    const error = await readQueuedDriveUploadFile(user, itemId).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DriveUploadLocalFileMissingError);
    expect((error as Error).message).toMatch(/no longer has "big.bin"/);
    expect((error as Error).message).not.toMatch(/another window/);
  });

  it("saves the local copy, and reports false once the item is gone", async () => {
    const itemId = await enqueue(testFile("plan.txt", "draft one"));

    expect(await downloadQueuedDriveUpload(user, itemId)).toBe(true);
    expect(download).toHaveBeenCalledWith(expect.any(Blob), "plan.txt");

    await removeDriveUploadItem(user, itemId);
    download.mockClear();
    expect(await downloadQueuedDriveUpload(user, itemId)).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });
});
