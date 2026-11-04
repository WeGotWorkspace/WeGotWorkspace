import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/core/browser-online", () => ({ readBrowserOnline: () => false }));

import { driveUploadQueueOperations } from "@/lib/offline/drive/upload/drive-upload-operations";
import {
  enqueueDriveUploadBatch,
  releaseDriveUploadBatch,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import {
  isAskingUploadBatchHere,
  simulateUploadMemoryReloadForTests,
} from "@/lib/offline/drive/upload/drive-upload-memory";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  UPLOAD_TEST_USER as user,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const folder = "/users/ada/reports";
const target = { kind: "server" as const, id: "fn-reports" };

describe("claimUnansweredUploadBatches", () => {
  let restoreStorage: () => void = () => undefined;

  beforeEach(async () => {
    await clearUploadTestDb();
    resetPersistentStorageRequestForTests();
    simulateUploadMemoryReloadForTests();
    restoreStorage = stubNavigatorStorage(undefined);
  });

  afterEach(() => {
    restoreStorage();
  });

  it("takes over a batch whose dialog no open tab shows, once", async () => {
    const big = "x".repeat(9 * 1024 * 1024);
    const batch = await enqueueDriveUploadBatch(user, {
      folderPath: folder,
      targetFolder: target,
      files: [testFile("a.pdf", big), testFile("small.pdf"), testFile("b.pdf", big)],
    });
    const operations = driveUploadQueueOperations(user);

    const claimed = await operations.claimUnansweredUploadBatches();
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.batchId).toBe(batch.batchId);
    expect(claimed[0]!.itemIds).toEqual(batch.itemIds);
    // Only the files above the default 8 MB device limit are asked about.
    expect(claimed[0]!.questions.keepOffline?.files.map((file) => file.name)).toEqual([
      "a.pdf",
      "b.pdf",
    ]);
    expect(isAskingUploadBatchHere(batch.batchId)).toBe(true);

    // This tab asks now; a second look does not take it again.
    expect(await operations.claimUnansweredUploadBatches()).toEqual([]);
  });

  it("leaves released batches alone, and stops asking once a batch is answered", async () => {
    const released = await enqueueDriveUploadBatch(user, {
      folderPath: folder,
      targetFolder: target,
      files: [testFile("a.pdf")],
    });
    await releaseDriveUploadBatch(user, released.batchId, { keepOffline: "remove" });
    const operations = driveUploadQueueOperations(user);
    expect(await operations.claimUnansweredUploadBatches()).toEqual([]);

    const waiting = await enqueueDriveUploadBatch(user, {
      folderPath: folder,
      targetFolder: target,
      files: [testFile("c.pdf")],
    });
    const [claimed] = await operations.claimUnansweredUploadBatches();
    expect(claimed?.batchId).toBe(waiting.batchId);
    // No question applies (small file, offline files on): the caller releases it.
    expect(claimed?.questions).toEqual({ space: null, conflicts: null, keepOffline: null });
    await operations.releaseUploadBatch(waiting.batchId, { keepOffline: "remove" });
    expect(isAskingUploadBatchHere(waiting.batchId)).toBe(false);
  });
});
