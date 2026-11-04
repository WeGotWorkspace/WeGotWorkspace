import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCrossTabLock } from "@/lib/cross-tab/cross-tab-lock";
import { simulateOrigin } from "@/lib/cross-tab/test-utils/simulated-origin";
import {
  FakeDriveServer,
  memoryLocalStorage,
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

import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import {
  readDirectoryEntriesFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { resetDriveUploadEventsForTests } from "@/lib/offline/drive/upload/drive-upload-events";
import {
  enqueueDriveUploadFolderBatch,
  type DriveUploadTreeInput,
} from "@/lib/offline/drive/upload/drive-upload-folder-enqueue";
import {
  removeDriveUploadTreeItem,
  resolveDriveUploadFolder,
  retryDriveUploadTreeItem,
} from "@/lib/offline/drive/upload/drive-upload-folder-store";
import { applyDriveUploadFolderChoice } from "@/lib/offline/drive/upload/drive-upload-folder-conflicts";
import { isPendingUploadFolderPath } from "@/lib/offline/drive/upload/drive-upload-folder-placeholders";
import { DriveUploader } from "@/lib/offline/drive/upload/drive-upload-runner";
import { driveUploadItemsTable } from "@/lib/offline/drive/upload/drive-upload-schema";
import {
  listStartableDriveUploads,
  readDriveUploadQueueRows,
  releaseDriveUploadBatch,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { readDriveUploadQueueSnapshot } from "@/lib/offline/drive/upload/drive-upload-subscription";
import { resetDriveUploadTargetChecksForTests } from "@/lib/offline/drive/upload/drive-upload-target-check";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  uploadTestDb,
  UPLOAD_TEST_USER as user,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";
import type { JmapFileNode } from "@/lib/jmap-client";

const docs = "users/ada/docs";

let server: FakeDriveServer;
let uploader: DriveUploader | null = null;
let restoreStorage: () => void = () => undefined;

/** Photos/a.txt, Photos/2024/b.txt, and top.txt next to the folder. */
function photosTree(): DriveUploadTreeInput {
  return {
    folders: ["Photos", "Photos/2024"],
    files: [
      { file: testFile("a.txt", "aaa"), folder: "Photos" },
      { file: testFile("b.txt", "bbbbb"), folder: "Photos/2024" },
      { file: testFile("top.txt"), folder: "" },
    ],
  };
}

async function queueTree(tree: DriveUploadTreeInput = photosTree(), release = true) {
  const batch = await enqueueDriveUploadFolderBatch(user, {
    folderPath: `/${docs}`,
    targetFolder: { kind: "server", id: "fn-docs" },
    tree,
  });
  if (release) await releaseDriveUploadBatch(user, batch.batchId, { keepOffline: "remove" });
  return batch;
}

async function runUploader(): Promise<void> {
  uploader ??= new DriveUploader(user, { lock: createCrossTabLock(simulateOrigin().tab("tab-a")) });
  uploader.wake();
  await uploader.whenIdle();
}

/** A fresh uploader, as after a reload, with the retry wait over. */
async function reloadAfterWait(): Promise<void> {
  await uploader?.stop();
  uploader = null;
  const items = driveUploadItemsTable(uploadTestDb());
  await items.toCollection().modify((item) => {
    delete item.retryAt;
  });
}

function folderId(parentId: string, name: string): string {
  return [...server.folders.values()].find((row) => row.parentId === parentId && row.name === name)!
    .id;
}

function filesIn(parentId: string): string[] {
  return server.nodes
    .filter((row) => row.parentId === parentId)
    .map((row) => row.name)
    .sort();
}

async function listing(path: string) {
  return (await readDirectoryEntriesFromCache(user, path))
    .map((entry) => `${entry.type}:${entry.name}${entry.upload ? `:${entry.upload.status}` : ""}`)
    .sort();
}

function cachedFolder(path: string, nodeId: string) {
  return upsertDriveEntry(user, {
    type: "dir",
    path: `/${path}`,
    name: path.slice(path.lastIndexOf("/") + 1),
    size: 0,
    time: 1,
    permissions: 0,
    nodeId,
  } as WgwDriveDirectoryEntry);
}

describe("folder upload through the queue", () => {
  beforeEach(async () => {
    online.value = true;
    server = new FakeDriveServer();
    fake.server = server;
    vi.stubGlobal("localStorage", memoryLocalStorage());
    resetDriveUploadEventsForTests();
    resetPersistentStorageRequestForTests();
    resetDriveUploadTargetChecksForTests();
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
  });

  afterEach(async () => {
    await uploader?.stop();
    uploader = null;
    restoreStorage();
    vi.unstubAllGlobals();
  });

  it("creates the folders parents first, then uploads every file into its folder", async () => {
    await queueTree();
    expect(await listing(docs)).toEqual(["dir:Photos:queued", "file:top.txt:queued"]);
    expect(await listing(`${docs}/Photos`)).toEqual(["dir:2024:queued", "file:a.txt:queued"]);
    expect(await isPendingUploadFolderPath(user, `/${docs}/Photos/2024`)).toBe(true);

    await runUploader();

    const creates = server.fileNodeSets
      .map((set) => Object.values((set.create ?? {}) as Record<string, { name: string }>)[0])
      .filter((create) => create && !("blobId" in create))
      .map((create) => create!.name);
    expect(creates).toEqual(["Photos", "2024"]);
    const photos = folderId("fn-docs", "Photos");
    expect(filesIn("fn-docs")).toEqual(["top.txt"]);
    expect(filesIn(photos)).toEqual(["a.txt"]);
    expect(filesIn(folderId(photos, "2024"))).toEqual(["b.txt"]);
    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items).toEqual([]);
    expect(rows.batches).toEqual([]);
    // The rows are plain folders now, with their node ids.
    expect(await listing(docs)).toEqual(["dir:Photos", "file:top.txt"]);
    expect(await listing(`${docs}/Photos`)).toEqual(["dir:2024", "file:a.txt"]);
    expect(await isPendingUploadFolderPath(user, `/${docs}/Photos`)).toBe(false);
  });

  it("points the waiting items at the server id once their folder exists", async () => {
    const batch = await queueTree();
    const [photosItem, yearItem] = batch.folderIds;
    let startable = await listStartableDriveUploads(user);
    expect(startable.map((item) => item.name)).toEqual(["Photos", "top.txt"]);

    const node = { id: "fd-77", parentId: "fn-docs", name: "Photos", nodeType: "directory" };
    await resolveDriveUploadFolder(user, photosItem!, node as JmapFileNode);

    const { items } = await readDriveUploadQueueRows(user);
    const byName = new Map(items.map((item) => [item.name, item]));
    expect(byName.get("a.txt")!.targetFolder).toEqual({ kind: "server", id: "fd-77" });
    expect(byName.get("2024")!.targetFolder).toEqual({ kind: "server", id: "fd-77" });
    expect(byName.get("b.txt")!.targetFolder).toEqual({ kind: "temporary", id: yearItem });
    startable = await listStartableDriveUploads(user);
    expect(startable.map((item) => item.name)).toEqual(["2024", "a.txt", "top.txt"]);
    // Created, still marked while its contents upload.
    expect(await listing(docs)).toEqual(["dir:Photos:queued", "file:top.txt:queued"]);
  });

  it("never creates a folder twice when the create's answer was lost", async () => {
    server.loseFolderCreateAnswers = 1;
    await queueTree();
    await runUploader();
    expect(server.foldersIn("fn-docs")).toEqual(["Photos"]);
    const waiting = (await readDriveUploadQueueRows(user)).items;
    expect(waiting.map((item) => [item.name, item.status, item.createdNodeId])).toEqual([
      ["Photos", "queued", undefined],
      ["2024", "queued", undefined],
      ["a.txt", "queued", undefined],
      ["b.txt", "queued", undefined],
    ]);

    await reloadAfterWait();
    await runUploader();

    expect(server.foldersIn("fn-docs")).toEqual(["Photos"]);
    expect(filesIn(folderId("fn-docs", "Photos"))).toEqual(["a.txt"]);
    expect((await readDriveUploadQueueRows(user)).items).toEqual([]);
  });

  it("finds its folder by the stored id after a reload between create and resolve", async () => {
    server.failFolderReadBacks = 1;
    await queueTree();
    await runUploader();
    const stored = (await readDriveUploadQueueRows(user)).items.find((i) => i.name === "Photos");
    expect(stored?.placing?.nodeId).toBe(folderId("fn-docs", "Photos"));
    expect(stored?.createdNodeId).toBeUndefined();

    await reloadAfterWait();
    await runUploader();

    expect(server.foldersIn("fn-docs")).toEqual(["Photos"]);
    expect((await readDriveUploadQueueRows(user)).items).toEqual([]);
  });

  it("keeps both when the folder name was taken meanwhile, with a notice and moved rows", async () => {
    server.folders.set("fd-old", { id: "fd-old", parentId: "fn-docs", name: "Photos" });
    const batch = await queueTree({
      folders: ["Photos"],
      files: [{ file: testFile("a.txt"), folder: "Photos" }],
    });
    await runUploader();

    expect(server.foldersIn("fn-docs")).toEqual(["Photos", "Photos (1)"]);
    expect(filesIn(folderId("fn-docs", "Photos (1)"))).toEqual(["a.txt"]);
    expect(filesIn("fd-old")).toEqual([]);
    const rows = await readDriveUploadQueueRows(user);
    expect(rows.batches.find((b) => b.id === batch.batchId)?.notices).toEqual([
      { type: "kept_both", itemName: "Photos", keptAsName: "Photos (1)" },
    ]);
    expect(await listing(docs)).toEqual(["dir:Photos (1)"]);
    expect(await listing(`${docs}/Photos (1)`)).toEqual(["file:a.txt"]);
  });

  it("tries the next name when a create loses the race for its name", async () => {
    const query = server.fileNodes.queryAndGetFileNodes;
    let hidden = false;
    // The name looks free, but another device creates it just before us.
    server.fileNodes.queryAndGetFileNodes = async (account, filter) => {
      if (!hidden && filter.name === "Photos") {
        hidden = true;
        server.folders.set("fd-race", { id: "fd-race", parentId: "fn-docs", name: "Photos" });
        return { list: [] };
      }
      return query(account, filter);
    };
    const batch = await queueTree({ folders: ["Photos"], files: [] });
    await runUploader();

    expect(server.foldersIn("fn-docs")).toEqual(["Photos", "Photos (1)"]);
    expect(server.foldersIn("fd-race")).toEqual([]);
    const { batches } = await readDriveUploadQueueRows(user);
    expect(batches.find((b) => b.id === batch.batchId)?.notices).toEqual([
      { type: "kept_both", itemName: "Photos", keptAsName: "Photos (1)" },
    ]);
  });

  it("adds into an existing nested folder instead of creating a second one", async () => {
    const photos = "fd-photos";
    server.folders.set(photos, { id: photos, parentId: "fn-docs", name: "Photos" });
    server.folders.set("fd-2024", { id: "fd-2024", parentId: photos, name: "2024" });
    await cachedFolder(`${docs}/Photos`, photos);
    const batch = await queueTree(photosTree(), false);
    await applyDriveUploadFolderChoice(user, batch.batchId, "merge");
    await releaseDriveUploadBatch(user, batch.batchId, { keepOffline: "remove" });

    await runUploader();

    expect(server.foldersIn("fn-docs")).toEqual(["Photos"]);
    expect(server.foldersIn(photos)).toEqual(["2024"]);
    expect(filesIn(photos)).toEqual(["a.txt"]);
    expect(filesIn("fd-2024")).toEqual(["b.txt"]);
  });

  it("fails everything below a folder that cannot be created, and retries it all", async () => {
    server.refuseNames.set("Photos", "forbidden");
    const batch = await queueTree();
    await runUploader();

    const failed = (await readDriveUploadQueueRows(user)).items;
    expect(failed.map((item) => [item.name, item.status, item.error?.code])).toEqual([
      ["Photos", "failed", "forbidden"],
      ["2024", "failed", "forbidden"],
      ["a.txt", "failed", "forbidden"],
      ["b.txt", "failed", "forbidden"],
    ]);
    expect(filesIn("fn-docs")).toEqual(["top.txt"]);
    const snapshot = await readDriveUploadQueueSnapshot(user);
    expect(snapshot.state).toBe("idle");
    expect(snapshot.items.map((item) => item.name)).toEqual(["a.txt", "b.txt"]);
    expect(snapshot.folders.map((f) => [f.name, f.status, f.failedFiles])).toEqual([
      ["Photos", "failed", 2],
      ["2024", "failed", 1],
    ]);

    server.refuseNames.clear();
    const bFile = failed.find((item) => item.name === "b.txt")!;
    // *Retry* on one file brings its folders back with it.
    expect(await retryDriveUploadTreeItem(user, bFile.id)).toBe(true);
    await runUploader();
    expect(filesIn(folderId(folderId("fn-docs", "Photos"), "2024"))).toEqual(["b.txt"]);
    const left = (await readDriveUploadQueueRows(user)).items;
    expect(left.map((item) => [item.name, item.status])).toEqual([
      ["Photos", "uploading"],
      ["2024", "uploading"],
      ["a.txt", "failed"],
    ]);
    // *Retry* on the folder brings back what failed below it.
    expect(await retryDriveUploadTreeItem(user, batch.folderIds[0]!)).toBe(true);
    await runUploader();
    expect(filesIn(folderId("fn-docs", "Photos"))).toEqual(["a.txt"]);
    expect((await readDriveUploadQueueRows(user)).items).toEqual([]);
  });

  it("removes a folder with everything below it, and finishes the batch", async () => {
    server.refuseNames.set("2024", "forbidden");
    const batch = await queueTree();
    await runUploader();
    expect(await removeDriveUploadTreeItem(user, batch.folderIds[1]!)).toBe(true);

    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items).toEqual([]);
    expect(rows.batches).toEqual([]);
    expect(await listing(`${docs}/Photos`)).toEqual(["file:a.txt"]);
  });

  it("finishes a batch of empty folders", async () => {
    await queueTree({ folders: ["A", "A/B", "A/B/C"], files: [] });
    await runUploader();
    const a = folderId("fn-docs", "A");
    expect(server.foldersIn(folderId(a, "B"))).toEqual(["C"]);
    const rows = await readDriveUploadQueueRows(user);
    expect(rows.items).toEqual([]);
    expect(rows.batches).toEqual([]);
    expect(await listing(`${docs}/A/B`)).toEqual(["dir:C"]);
  });

  it("queues a tree offline and creates it once back online", async () => {
    online.value = false;
    await queueTree();
    await runUploader();
    expect(server.foldersIn("fn-docs")).toEqual([]);
    expect((await readDriveUploadQueueSnapshot(user)).state).toBe("paused_offline");

    online.value = true;
    await runUploader();
    expect(filesIn(folderId(folderId("fn-docs", "Photos"), "2024"))).toEqual(["b.txt"]);
    expect((await readDriveUploadQueueSnapshot(user)).state).toBe("idle");
  });

  it("shows folders apart from files, with their progress, and is not stuck on created ones", async () => {
    await queueTree();
    let snapshot = await readDriveUploadQueueSnapshot(user);
    expect(snapshot.items.map((item) => item.name)).toEqual(["a.txt", "b.txt", "top.txt"]);
    expect(snapshot.folders.map((f) => [f.name, f.status, f.subtreeFiles, f.subtreeBytes])).toEqual(
      [
        ["Photos", "waiting", 2, 8],
        ["2024", "waiting", 1, 5],
      ],
    );

    // b.txt fails on its own; a.txt and the folders are done.
    server.refuseNames.set("b.txt", "forbidden");
    await runUploader();
    snapshot = await readDriveUploadQueueSnapshot(user);
    expect(snapshot.items.map((item) => [item.name, item.status])).toEqual([["b.txt", "failed"]]);
    expect(snapshot.folders.map((f) => [f.name, f.status, f.filesDone, f.bytesDone])).toEqual([
      ["Photos", "created", 1, 3],
      ["2024", "created", 0, 0],
    ]);
    expect(snapshot.state).toBe("idle");
  });
});
