import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDriveServer } from "@/lib/offline/drive/upload/drive-upload-fake-server.fixture";

const online = vi.hoisted(() => ({ value: true }));
const fake = vi.hoisted(() => ({ server: null as unknown as FakeDriveServer, hang: false }));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  readBrowserOnline: () => online.value,
  getConnectivitySnapshot: () => online.value,
}));

vi.mock("@/lib/api/wgw/drive-jmap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/drive-jmap")>()),
  driveJmapSession: async () => (fake.hang ? new Promise<never>(() => {}) : fake.server.session()),
}));

import { resetDriveUploadEventsForTests } from "@/lib/offline/drive/upload/drive-upload-events";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import {
  checkDriveUploadBatchSpace,
  driveUploadRootPath,
  serverHasSpaceForDriveUpload,
} from "@/lib/offline/drive/upload/drive-upload-space-check";
import {
  enqueueDriveUploadBatch,
  failDriveUpload,
  releaseDriveUploadBatch,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { rememberDriveFolderNodeId } from "@/lib/offline/drive/upload/drive-upload-target";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  UPLOAD_TEST_USER as user,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const HOME = "users/ada";
const TEAM = "groups/team";

function bytes(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: "application/octet-stream" });
}

async function add(folderPath: string, files: File[], targetId = "fn-docs") {
  return enqueueDriveUploadBatch(user, {
    folderPath,
    targetFolder: { kind: "server", id: targetId },
    files,
  });
}

/** Quota/get never answers, and the pre-check's time limit is already over. */
function hangQuotaGet() {
  fake.hang = true;
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort());
}

describe("drive upload space pre-check", () => {
  let server: FakeDriveServer;
  let restoreStorage: () => void = () => undefined;

  beforeEach(async () => {
    online.value = true;
    fake.hang = false;
    server = new FakeDriveServer();
    fake.server = server;
    resetDriveUploadEventsForTests();
    resetPersistentStorageRequestForTests();
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
    // Root ids as this device learned them while browsing.
    await rememberDriveFolderNodeId(user, HOME, "fn-home");
    await rememberDriveFolderNodeId(user, TEAM, "fn-team");
    server.quotas = [
      { id: "dq-fn-home", used: 1_000, hardLimit: 1_500 },
      { id: "dq-fn-team", used: 0, hardLimit: 10_000 },
    ];
  });

  afterEach(() => {
    restoreStorage();
    vi.restoreAllMocks();
  });

  it("finds the drive root of a folder path", () => {
    expect(driveUploadRootPath("users/ada/docs/2026")).toBe("users/ada");
    expect(driveUploadRootPath("/groups/team")).toBe("groups/team");
    expect(driveUploadRootPath("users")).toBeNull();
    expect(driveUploadRootPath(undefined)).toBeNull();
  });

  it("fits when the batch plus the rest of the queue fits in the root's free space", async () => {
    const { batchId } = await add(`${HOME}/docs`, [bytes("a.bin", 200), bytes("b.bin", 100)]);

    const check = await checkDriveUploadBatchSpace(user, batchId);

    expect(check).toMatchObject({
      status: "fits",
      quotaId: "dq-fn-home",
      batchBytes: 300,
      queuedBytes: 0,
      neededBytes: 300,
      freeBytes: 500,
      fresh: true,
    });
    // The server lists Drive quotas only when the request also uses FileNode.
    expect(server.callsNamed("Quota/get")[0]?.using).toEqual([
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:filenode",
      "urn:ietf:params:jmap:quota",
    ]);
  });

  it("does not fit once the remaining queue for the same root is counted", async () => {
    const earlier = await add(`${HOME}/docs`, [bytes("earlier.bin", 400)]);
    await releaseDriveUploadBatch(user, earlier.batchId, { keepOffline: "remove" });
    const { batchId } = await add(`${HOME}/docs`, [bytes("new.bin", 200)]);

    const check = await checkDriveUploadBatchSpace(user, batchId);

    expect(check).toMatchObject({
      status: "does_not_fit",
      batchBytes: 200,
      queuedBytes: 400,
      neededBytes: 600,
      freeBytes: 500,
    });
  });

  it("picks the target root's quota when roots report different free space", async () => {
    const { batchId } = await add(`${TEAM}/plans`, [bytes("plan.bin", 5_000)], "fn-plans");

    const check = await checkDriveUploadBatchSpace(user, batchId);

    // The personal drive has only 500 bytes free; the group drive has 10 000.
    expect(check).toMatchObject({ status: "fits", quotaId: "dq-fn-team", freeBytes: 10_000 });
  });

  it("does not count queued files of another root", async () => {
    const elsewhere = await add(`${TEAM}/plans`, [bytes("big.bin", 9_000)], "fn-plans");
    await releaseDriveUploadBatch(user, elsewhere.batchId, { keepOffline: "remove" });
    const { batchId } = await add(`${HOME}/docs`, [bytes("small.bin", 100)]);

    const check = await checkDriveUploadBatchSpace(user, batchId);

    expect(check).toMatchObject({ status: "fits", queuedBytes: 0, neededBytes: 100 });
  });

  it("is unknown without a quota for the target root, or without quota support", async () => {
    server.quotas = [{ id: "dq-fn-team", used: 0, hardLimit: 10 }];
    const { batchId } = await add(`${HOME}/docs`, [bytes("a.bin", 200)]);
    expect(await checkDriveUploadBatchSpace(user, batchId)).toEqual({ status: "unknown" });

    server.quotas = [];
    expect(await checkDriveUploadBatchSpace(user, batchId)).toEqual({ status: "unknown" });

    server.quotas = null;
    expect(await checkDriveUploadBatchSpace(user, batchId)).toEqual({ status: "unknown" });
  });

  it("uses the last known free space with its age while offline", async () => {
    const before = Date.now();
    const first = await add(`${HOME}/docs`, [bytes("a.bin", 100)]);
    await checkDriveUploadBatchSpace(user, first.batchId);

    online.value = false;
    server.quotas = [{ id: "dq-fn-home", used: 0, hardLimit: 1_000_000 }];
    const { batchId } = await add(`${HOME}/docs`, [bytes("b.bin", 450)]);
    const check = await checkDriveUploadBatchSpace(user, batchId);

    expect(check).toMatchObject({ status: "does_not_fit", freeBytes: 500, fresh: false });
    expect(check.status !== "unknown" && check.measuredAt).toBeGreaterThanOrEqual(before);
    expect(server.callsNamed("Quota/get")).toHaveLength(1);
  });

  it("falls back to the stored reading when Quota/get never answers", async () => {
    const first = await add(`${HOME}/docs`, [bytes("a.bin", 100)]);
    await checkDriveUploadBatchSpace(user, first.batchId);

    const { batchId } = await add(`${HOME}/docs`, [bytes("b.bin", 100)]);
    hangQuotaGet();
    expect(await checkDriveUploadBatchSpace(user, batchId)).toMatchObject({
      status: "fits",
      fresh: false,
    });
  });

  it("is unknown when Quota/get never answers and nothing is stored", async () => {
    const { batchId } = await add(`${HOME}/docs`, [bytes("b.bin", 100)]);
    hangQuotaGet();
    expect(await checkDriveUploadBatchSpace(user, batchId)).toEqual({ status: "unknown" });
  });

  it("is unknown offline when this device never saw a quota", async () => {
    online.value = false;
    const { batchId } = await add(`${HOME}/docs`, [bytes("a.bin", 100)]);
    expect(await checkDriveUploadBatchSpace(user, batchId)).toEqual({ status: "unknown" });
  });

  it("counts a file waiting on a full server, by what is left of it", async () => {
    const held = await add(`${HOME}/docs`, [bytes("held.bin", 400)]);
    await releaseDriveUploadBatch(user, held.batchId, { keepOffline: "remove" });
    await failDriveUpload(user, held.itemIds[0]!, { code: "server_full", message: "full" });
    const { batchId } = await add(`${HOME}/docs`, [bytes("new.bin", 50)]);

    expect(await checkDriveUploadBatchSpace(user, batchId)).toMatchObject({
      queuedBytes: 400,
      status: "fits",
    });
  });

  it("only resumes from a fresh answer with room in the item's own root", async () => {
    const item = { size: 600, bytesDone: 200 };
    expect(await serverHasSpaceForDriveUpload(user, item, `${HOME}/docs`)).toBe(true);
    expect(await serverHasSpaceForDriveUpload(user, { ...item, bytesDone: 0 }, HOME)).toBe(false);
    expect(await serverHasSpaceForDriveUpload(user, { ...item, bytesDone: 0 }, TEAM)).toBe(true);

    online.value = false;
    expect(await serverHasSpaceForDriveUpload(user, item, `${HOME}/docs`)).toBe(false);
  });
});
