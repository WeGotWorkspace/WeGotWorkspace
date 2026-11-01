import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";

const online = vi.hoisted(() => ({ value: false }));
const liveDrive = vi.hoisted(() => ({
  uploadFiles: vi.fn(),
  renameItem: vi.fn(),
  setStar: vi.fn(),
  listStars: vi.fn(async () => []),
}));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  readBrowserOnline: () => online.value,
  getConnectivitySnapshot: () => online.value,
}));

vi.mock("@/lib/api/wgw/drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/drive")>()),
  createWgwDriveOperations: () => liveDrive,
}));

import { enqueueOutboxMutation, listOutboxMutations } from "@/lib/offline/core/outbox-store";
import { upsertDriveEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import { applyFetchedDirectorySnapshot } from "@/lib/offline/drive/drive-fetched-set-prune";
import { createHybridDriveOperations } from "@/lib/offline/drive/drive-hybrid-operations";
import { flushDriveOutbox, pathsForDriveOutboxRow } from "@/lib/offline/drive/drive-outbox-flush";
import { DRIVE_DOMAIN, driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { resetDriveUploadEventsForTests } from "@/lib/offline/drive/upload/drive-upload-events";
import { migrateDriveOutboxUploads } from "@/lib/offline/drive/upload/drive-upload-outbox-migration";
import {
  readDriveUploadBlob,
  readDriveUploadQueueRows,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { stopAllDriveUploaders } from "@/lib/offline/drive/upload/drive-upload-runner";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  UPLOAD_TEST_USER as user,
  uploadTestDb,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const folder = "/users/ada/docs";

function entry(path: string, nodeId: string, type: "file" | "dir"): WgwDriveDirectoryEntry {
  return {
    type,
    path,
    nodeId,
    name: path.split("/").pop() ?? path,
    size: 4,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
  };
}

/** An outbox row exactly as earlier versions wrote it for an offline upload. */
async function legacyUploadRow(cwd: string, name: string, bytes: Uint8Array, mimeType: string) {
  const payload = {
    op: "upload",
    cwd,
    name,
    base64: Buffer.from(bytes).toString("base64"),
    mimeType,
  };
  await enqueueOutboxMutation(user, {
    id: crypto.randomUUID(),
    domain: DRIVE_DOMAIN,
    op: "upload",
    payload: JSON.stringify(payload),
  });
}

async function blobBytes(itemId: string): Promise<Uint8Array> {
  const blob = await readDriveUploadBlob(user, itemId);
  return new Uint8Array(await blob!.arrayBuffer());
}

describe("moving old outbox uploads into the upload queue", () => {
  let restoreStorage: () => void = () => undefined;

  beforeEach(async () => {
    online.value = false;
    resetDriveUploadEventsForTests();
    resetPersistentStorageRequestForTests();
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
    for (const mock of Object.values(liveDrive)) mock.mockClear();
  });

  afterEach(async () => {
    await stopAllDriveUploaders();
    restoreStorage();
  });

  it("moves each row into one released batch per folder, as a Blob with the same bytes", async () => {
    // The folder is known on this device (its cached row carries its id).
    await upsertDriveEntry(user, entry(folder, "fn-docs", "dir"));
    const first = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    await legacyUploadRow(folder, "a.bin", first, "application/octet-stream");
    await legacyUploadRow(folder, "notes.txt", new TextEncoder().encode("héllo"), "text/plain");

    expect(await migrateDriveOutboxUploads(user)).toEqual({ moved: 2, waiting: 0 });

    expect(await listOutboxMutations(user)).toEqual([]);
    const { batches, items, folderPaths } = await readDriveUploadQueueRows(user);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ status: "released", keepOffline: "remove" });
    expect(items.map((item) => [item.name, item.status, item.size, item.mimeType])).toEqual([
      ["a.bin", "queued", 9, "application/octet-stream"],
      ["notes.txt", "queued", 6, "text/plain"],
    ]);
    expect(items.every((item) => item.localCopy && item.targetFolder.id === "fn-docs")).toBe(true);
    expect(await blobBytes(items[0]!.id)).toEqual(first);
    expect(new TextDecoder().decode(await blobBytes(items[1]!.id))).toBe("héllo");
    expect(folderPaths?.get(items[0]!.id)).toBe("users/ada/docs");

    // Running it again changes nothing.
    expect(await migrateDriveOutboxUploads(user)).toEqual({ moved: 0, waiting: 0 });
    expect((await readDriveUploadQueueRows(user)).items).toHaveLength(2);
  });

  it("keeps the prune protection: the queue's placeholders survive a refresh of the folder", async () => {
    await upsertDriveEntry(user, entry(folder, "fn-docs", "dir"));
    await legacyUploadRow(folder, "a.bin", new Uint8Array([1, 2, 3]), "application/octet-stream");
    await migrateDriveOutboxUploads(user);

    // The server lists the folder without the file: it is not uploaded yet.
    await applyFetchedDirectorySnapshot(user, "users/ada/docs", []);

    const { items } = await readDriveUploadQueueRows(user);
    const placeholders = await driveEntriesTable(uploadTestDb())
      .where("uploadId")
      .equals(items[0]!.id)
      .toArray();
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]?.parentPath).toBe("users/ada/docs");
  });

  it("leaves a row in the outbox, still protected, while its folder is unknown offline", async () => {
    // A cached file the old row would overwrite; the folder's own id is not known here.
    await upsertDriveEntry(user, entry(`${folder}/a.bin`, "fn-a", "file"));
    await legacyUploadRow(folder, "a.bin", new Uint8Array([1]), "application/octet-stream");

    expect(await migrateDriveOutboxUploads(user)).toEqual({ moved: 0, waiting: 1 });
    const [row] = await listOutboxMutations(user);
    expect(pathsForDriveOutboxRow(row!)).toEqual(["users/ada/docs/a.bin"]);

    await applyFetchedDirectorySnapshot(user, "users/ada/docs", []);
    expect(await driveEntriesTable(uploadTestDb()).get("users/ada/docs/a.bin")).toBeDefined();

    // Once the folder is known, the next run moves it.
    await upsertDriveEntry(user, entry(folder, "fn-docs", "dir"));
    expect(await migrateDriveOutboxUploads(user)).toEqual({ moved: 1, waiting: 0 });
    expect(await listOutboxMutations(user)).toEqual([]);
  });

  it("keeps going with the next folder when one folder fails to move", async () => {
    const other = "/users/ada/other";
    await upsertDriveEntry(user, entry(folder, "fn-docs", "dir"));
    await upsertDriveEntry(user, entry(other, "fn-other", "dir"));
    await legacyUploadRow(folder, "bad.bin", new Uint8Array([1]), "application/octet-stream");
    await legacyUploadRow(other, "good.bin", new Uint8Array([2, 3]), "application/octet-stream");
    // The first folder's file cannot be decoded; atob throws for it only.
    const realAtob = globalThis.atob;
    const bad = Buffer.from(new Uint8Array([1])).toString("base64");
    vi.spyOn(globalThis, "atob").mockImplementation((data) => {
      if (data === bad) throw new Error("bad payload");
      return realAtob(data);
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await migrateDriveOutboxUploads(user)).toEqual({ moved: 1, waiting: 1 });

    expect(await listOutboxMutations(user)).toHaveLength(1);
    const { items } = await readDriveUploadQueueRows(user);
    expect(items.map((item) => item.name)).toEqual(["good.bin"]);
    expect(await blobBytes(items[0]!.id)).toEqual(new Uint8Array([2, 3]));
    vi.restoreAllMocks();
  });

  it("flushing the outbox moves old uploads instead of sending them as base64", async () => {
    await upsertDriveEntry(user, entry(folder, "fn-docs", "dir"));
    await legacyUploadRow(folder, "a.bin", new Uint8Array([7, 7]), "application/octet-stream");

    const result = await flushDriveOutbox(user);

    expect(result).toEqual({ flushed: 0, failed: 0, stateMismatches: [] });
    expect(liveDrive.uploadFiles).not.toHaveBeenCalled();
    expect(await listOutboxMutations(user)).toEqual([]);
    expect((await readDriveUploadQueueRows(user)).items.map((item) => item.name)).toEqual([
      "a.bin",
    ]);
  });

  it("does not drop an old upload it cannot move yet when the outbox is flushed", async () => {
    await legacyUploadRow(folder, "a.bin", new Uint8Array([7]), "application/octet-stream");

    await flushDriveOutbox(user);

    expect(liveDrive.uploadFiles).not.toHaveBeenCalled();
    expect(await listOutboxMutations(user)).toHaveLength(1);
  });

  it("queues an offline uploadFiles as a Blob, never in the outbox", async () => {
    await upsertDriveEntry(user, entry(folder, "fn-docs", "dir"));
    const hybrid = createHybridDriveOperations(user);
    const file = new File([new Uint8Array([9, 8, 7])], "offline.bin", {
      type: "application/octet-stream",
    });

    await hybrid.uploadFiles({ cwd: folder, files: [file] });

    expect(await listOutboxMutations(user)).toEqual([]);
    const { batches, items } = await readDriveUploadQueueRows(user);
    expect(batches[0]).toMatchObject({ status: "released", spaceCheck: { status: "unknown" } });
    expect(items.map((item) => item.name)).toEqual(["offline.bin"]);
    expect(await blobBytes(items[0]!.id)).toEqual(new Uint8Array([9, 8, 7]));
  });
});
