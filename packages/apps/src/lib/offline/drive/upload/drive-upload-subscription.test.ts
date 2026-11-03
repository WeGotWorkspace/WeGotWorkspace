import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const online = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  readBrowserOnline: () => online.value,
}));

import {
  addDriveUploadBatchNotice,
  enqueueDriveUploadBatch,
  failDriveUpload,
  hasPendingDriveUploads,
  releaseDriveUploadBatch,
} from "@/lib/offline/drive/upload/drive-upload-store";
import {
  subscribeDriveUploadQueue,
  type DriveUploadQueueSnapshot,
} from "@/lib/offline/drive/upload/drive-upload-subscription";
import { resetDriveUploadEventsForTests } from "@/lib/offline/drive/upload/drive-upload-events";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  UPLOAD_TEST_USER as user,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const target = { kind: "server" as const, id: "fn-docs" };

function collect() {
  const snapshots: DriveUploadQueueSnapshot[] = [];
  const latest = () => snapshots[snapshots.length - 1];
  return { snapshots, latest, listener: (s: DriveUploadQueueSnapshot) => snapshots.push(s) };
}

describe("drive upload queue subscription", () => {
  let restoreStorage: () => void = () => undefined;
  let unsubscribe: () => void = () => undefined;

  beforeEach(async () => {
    online.value = true;
    resetDriveUploadEventsForTests();
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
  });

  afterEach(() => {
    unsubscribe();
    restoreStorage();
  });

  it("reports items across folders, batch status, notices, and queue state", async () => {
    const seen = collect();
    unsubscribe = subscribeDriveUploadQueue(user, seen.listener);
    await vi.waitFor(() => expect(seen.latest()?.state).toBe("idle"));

    const first = await enqueueDriveUploadBatch(user, {
      folderPath: "/users/ada/docs",
      targetFolder: target,
      files: [testFile("a.txt", "12345")],
    });
    await vi.waitFor(() => expect(seen.latest()?.items).toHaveLength(1));
    expect(seen.latest()).toMatchObject({
      state: "idle",
      hasItems: true,
      totalBytes: 5,
      batches: [{ id: first.batchId, status: "awaiting_input" }],
      items: [{ name: "a.txt", status: "queued", bytesDone: 0, bytesTotal: 5, localCopy: true }],
    });

    await releaseDriveUploadBatch(user, first.batchId, { keepOffline: "remove" });
    await vi.waitFor(() => expect(seen.latest()?.state).toBe("running"));

    const second = await enqueueDriveUploadBatch(user, {
      folderPath: "/users/ada/photos",
      targetFolder: { kind: "server", id: "fn-photos" },
      files: [testFile("b.jpg", "123")],
    });
    await failDriveUpload(user, second.itemIds[0]!, { code: "too_large", message: "big" });
    await addDriveUploadBatchNotice(user, second.batchId, {
      type: "offline_copy_failed",
      itemName: "b.jpg",
      reason: "quota",
    });
    await vi.waitFor(() =>
      expect(seen.latest()?.items.map((item) => item.status)).toEqual(["queued", "failed"]),
    );
    expect(seen.latest()?.items[1]?.error).toEqual({ code: "too_large", message: "big" });
    await vi.waitFor(() =>
      expect(seen.latest()?.batches[1]?.notices).toEqual([
        { type: "offline_copy_failed", itemName: "b.jpg", reason: "quota" },
      ]),
    );
    expect(seen.latest()?.totalBytes).toBe(8);
    expect(await hasPendingDriveUploads(user)).toBe(true);
  });

  it("says paused_offline while items wait and the browser is offline", async () => {
    online.value = false;
    const { batchId } = await enqueueDriveUploadBatch(user, {
      folderPath: "/users/ada",
      targetFolder: target,
      files: [testFile("a.txt")],
    });
    await releaseDriveUploadBatch(user, batchId, { keepOffline: "remove" });
    const seen = collect();
    unsubscribe = subscribeDriveUploadQueue(user, seen.listener);
    await vi.waitFor(() => expect(seen.latest()?.state).toBe("paused_offline"));
  });

  it("updates when another tab changes the queue", async () => {
    const seen = collect();
    unsubscribe = subscribeDriveUploadQueue(user, seen.listener);
    await vi.waitFor(() => expect(seen.snapshots.length).toBeGreaterThan(0));
    const before = seen.snapshots.length;

    // Another tab writes to the shared database and announces it on the channel.
    const otherTab = new BroadcastChannel("wgw-drive-upload-queue:ada");
    await enqueueDriveUploadBatch(user, {
      folderPath: "/users/ada",
      targetFolder: target,
      files: [testFile("from-other-tab.txt")],
    });
    otherTab.postMessage({ type: "changed" });
    otherTab.close();

    await vi.waitFor(() => expect(seen.snapshots.length).toBeGreaterThan(before));
    expect(seen.latest()?.items.map((item) => item.name)).toEqual(["from-other-tab.txt"]);
  });

  it("announces its own changes to other tabs", async () => {
    const otherTab = new BroadcastChannel("wgw-drive-upload-queue:ada");
    const received: unknown[] = [];
    otherTab.addEventListener("message", (event) => received.push(event.data));

    await enqueueDriveUploadBatch(user, {
      folderPath: "/users/ada",
      targetFolder: target,
      files: [testFile("a.txt")],
    });

    await vi.waitFor(() =>
      expect(received).toContainEqual(expect.objectContaining({ type: "changed" })),
    );
    otherTab.close();
  });
});
