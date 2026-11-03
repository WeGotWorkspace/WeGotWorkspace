import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  readBrowserOnline: () => false,
  getConnectivitySnapshot: () => false,
}));

import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import {
  readDirectoryEntriesFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { memoryLocalStorage } from "@/lib/offline/drive/upload/drive-upload-fake-server.fixture";
import { driveUploadKeepOfflineQuestion } from "@/lib/offline/drive/upload/drive-upload-keep-offline";
import { driveUploadQueueOperations } from "@/lib/offline/drive/upload/drive-upload-operations";
import { stopAllDriveUploaders } from "@/lib/offline/drive/upload/drive-upload-runner";
import { readDriveUploadQueueRows } from "@/lib/offline/drive/upload/drive-upload-store";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  UPLOAD_TEST_USER as user,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const docs = "users/ada/docs";
let restoreStorage: () => void = () => undefined;

function cached(path: string, type: "dir" | "file", nodeId: string) {
  return upsertDriveEntry(user, {
    type,
    path: `/${path}`,
    name: path.slice(path.lastIndexOf("/") + 1),
    size: 1,
    time: 1,
    permissions: 0,
    nodeId,
    ...(type === "file" ? { blobId: `jb-${nodeId}` } : {}),
  } as WgwDriveDirectoryEntry);
}

async function listing(path: string) {
  return (await readDirectoryEntriesFromCache(user, path))
    .map((entry) => `${entry.type}:${entry.name}${entry.upload ? ":upload" : ""}`)
    .sort();
}

function enqueuePhotos() {
  return driveUploadQueueOperations(user).enqueueUploads({
    cwd: `/${docs}`,
    files: [],
    tree: {
      folders: ["Photos", "Photos/2024"],
      files: [
        { file: testFile("a.txt"), folder: "Photos" },
        { file: testFile("b.txt"), folder: "Photos/2024" },
      ],
    },
  });
}

async function folderItem(itemId: string) {
  return (await readDriveUploadQueueRows(user)).items.find((item) => item.id === itemId)!;
}

describe("folder upload questions and answers", () => {
  beforeEach(async () => {
    vi.stubGlobal("localStorage", memoryLocalStorage());
    resetPersistentStorageRequestForTests();
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
    await cached(docs, "dir", "fn-docs");
  });

  afterEach(async () => {
    await stopAllDriveUploaders();
    restoreStorage();
    vi.unstubAllGlobals();
  });

  it("queues a tree offline with no folder question when the name is free", async () => {
    const queued = await enqueuePhotos();

    expect(queued.folderIds).toHaveLength(2);
    expect(queued.itemIds).toHaveLength(2);
    expect(queued.questions.folders).toBeUndefined();
    const { items } = await readDriveUploadQueueRows(user);
    expect(items.map((item) => [item.name, item.kind ?? "file", item.targetFolder.kind])).toEqual([
      ["Photos", "folder", "server"],
      ["2024", "folder", "temporary"],
      ["a.txt", "file", "temporary"],
      ["b.txt", "file", "temporary"],
    ]);
    expect(await listing(docs)).toEqual(["dir:Photos:upload"]);
    expect(await listing(`${docs}/Photos/2024`)).toEqual(["file:b.txt:upload"]);
  });

  it("asks about a taken folder name: keep both by default, or merge with its file conflicts", async () => {
    await cached(`${docs}/Photos`, "dir", "fd-photos");
    await cached(`${docs}/Photos/a.txt`, "file", "fn-a");

    const { batchId, folderIds, questions } = await enqueuePhotos();

    expect(questions.conflicts).toBeNull();
    expect(questions.folders?.folders).toEqual([
      { itemId: folderIds![0], name: "Photos", keptAsName: "Photos (1)", canMerge: true },
    ]);
    expect(questions.folders?.mergeConflicts?.conflicts.map((c) => c.name)).toEqual(["a.txt"]);
    expect((await folderItem(folderIds![0]!)).name).toBe("Photos (1)");
    expect(await listing(docs)).toEqual(["dir:Photos", "dir:Photos (1):upload"]);
    expect(batchId).toBeTruthy();
  });

  it("applies Merge once, however often it is given, and Keep both moves it back", async () => {
    await cached(`${docs}/Photos`, "dir", "fd-photos");
    await cached(`${docs}/Photos/old.txt`, "file", "fn-old");
    const ops = driveUploadQueueOperations(user);
    const { batchId, folderIds } = await enqueuePhotos();
    const { applyDriveUploadFolderChoice } =
      await import("@/lib/offline/drive/upload/drive-upload-folder-conflicts");

    await applyDriveUploadFolderChoice(user, batchId, "merge");
    await applyDriveUploadFolderChoice(user, batchId, "merge");
    expect(await folderItem(folderIds![0]!)).toMatchObject({ name: "Photos", onExisting: "merge" });
    expect(await listing(docs)).toEqual(["dir:Photos:upload"]);
    expect(await listing(`${docs}/Photos`)).toEqual([
      "dir:2024:upload",
      "file:a.txt:upload",
      "file:old.txt",
    ]);

    await applyDriveUploadFolderChoice(user, batchId, "keep_both");
    expect(await folderItem(folderIds![0]!)).toMatchObject({
      name: "Photos (1)",
      onExisting: "keep_both",
    });
    expect(await listing(docs)).toEqual(["dir:Photos", "dir:Photos (1):upload"]);
    expect(await listing(`${docs}/Photos`)).toEqual(["file:old.txt"]);

    await ops.releaseUploadBatch(batchId, { keepOffline: "remove", folderConflict: "merge" });
    expect(await listing(`${docs}/Photos/2024`)).toEqual(["file:b.txt:upload"]);
    const rows = await readDriveUploadQueueRows(user);
    expect(rows.batches[0]?.status).toBe("released");

    // Cancel leaves the existing folder, without the upload's marker.
    await ops.cancelUploadBatch(batchId);
    expect(await listing(docs)).toEqual(["dir:Photos"]);
    expect(await listing(`${docs}/Photos`)).toEqual(["file:old.txt"]);
  });

  it("keeps both when the name belongs to a file, whatever the answer", async () => {
    await cached(`${docs}/Photos`, "file", "fn-photos-file");
    const ops = driveUploadQueueOperations(user);
    const { batchId, folderIds, questions } = await enqueuePhotos();

    expect(questions.folders?.folders[0]).toMatchObject({
      keptAsName: "Photos (1)",
      canMerge: false,
    });
    expect(questions.folders?.mergeConflicts).toBeNull();
    // The folder is no file conflict.
    expect(questions.conflicts).toBeNull();
    await ops.releaseUploadBatch(batchId, { keepOffline: "remove", folderConflict: "merge" });
    expect((await folderItem(folderIds![0]!)).name).toBe("Photos (1)");
  });

  it("removes a folder that is still waiting, with everything below it", async () => {
    const ops = driveUploadQueueOperations(user);
    const { folderIds } = await enqueuePhotos();

    expect(await ops.removeQueuedUpload(folderIds![1]!)).toBe(true);
    expect((await readDriveUploadQueueRows(user)).items.map((item) => item.name)).toEqual([
      "Photos",
      "a.txt",
    ]);
    expect(await listing(`${docs}/Photos`)).toEqual(["file:a.txt:upload"]);
  });

  it("never asks to keep a folder offline", () => {
    const settings = { contentSyncEnabled: false, maxFileSizeBytes: 1 } as Parameters<
      typeof driveUploadKeepOfflineQuestion
    >[1];
    const base = { size: 0, localCopy: true, status: "queued" as const };
    const question = driveUploadKeepOfflineQuestion(
      [
        { ...base, id: "f", name: "Photos", kind: "folder" },
        { ...base, id: "a", name: "a.pdf" },
      ],
      settings,
    );
    expect(question?.files.map((file) => file.itemId)).toEqual(["a"]);
  });
});
