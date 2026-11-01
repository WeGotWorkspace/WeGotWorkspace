import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readDriveUploadCapabilities,
  rememberDriveSessionCapabilities,
} from "@/lib/api/wgw/drive-upload-capabilities";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import {
  BLOB_ASSEMBLY_CAPABILITY,
  BLOB_CAPABILITY,
  FILENODE_VERSION_CHECK_CAPABILITY,
  type JmapSession,
} from "@/lib/jmap-client";
import { upsertDriveEntry } from "@/lib/offline/drive/drive-directory-offline-store";
import {
  describeDriveUploadBatchConflicts,
  driveUploadSessionVersionCheck,
} from "@/lib/offline/drive/upload/drive-upload-conflicts";
import { memoryLocalStorage } from "@/lib/offline/drive/upload/drive-upload-fake-server.fixture";
import { resetPersistentStorageRequestForTests } from "@/lib/offline/drive/upload/drive-upload-device-storage";
import { enqueueDriveUploadBatch } from "@/lib/offline/drive/upload/drive-upload-store";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  UPLOAD_TEST_USER as user,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

const folder = "/users/ada/docs";
let restoreStorage: () => void = () => undefined;

function cachedFile(name: string, extra: Partial<WgwDriveDirectoryEntry> = {}) {
  return upsertDriveEntry(user, {
    type: "file",
    path: `${folder}/${name}`,
    name,
    size: 1,
    time: 1,
    permissions: 0,
    nodeId: `fn-${name}`,
    blobId: `jb-${name}`,
    ...extra,
  } as WgwDriveDirectoryEntry);
}

async function queue(...names: string[]) {
  return enqueueDriveUploadBatch(user, {
    folderPath: folder,
    targetFolder: { kind: "server", id: "fn-docs" },
    files: names.map((name) => testFile(name)),
  });
}

describe("batch conflicts and the Replace offer", () => {
  beforeEach(async () => {
    resetPersistentStorageRequestForTests();
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
    vi.stubGlobal("localStorage", memoryLocalStorage());
  });

  afterEach(() => {
    restoreStorage();
    vi.unstubAllGlobals();
  });

  it("lists no conflict and no choice for a batch whose names are free", async () => {
    await cachedFile("other.txt");
    const { batchId } = await queue("new.txt");
    expect(await describeDriveUploadBatchConflicts(user, batchId, true)).toEqual({
      conflicts: [],
      choices: [],
      replaceTargets: {},
    });
  });

  it("offers Replace with the capability and stores the seen node id and blobId", async () => {
    await cachedFile("report.pdf");
    const { batchId, itemIds } = await queue("report.pdf", "new.txt");
    const described = await describeDriveUploadBatchConflicts(user, batchId, true);

    expect(described.choices).toEqual(["replace", "keep_both", "skip"]);
    expect(described.replaceTargets).toEqual({
      [itemIds[0]!]: { nodeId: "fn-report.pdf", blobId: "jb-report.pdf" },
    });
  });

  it("offers only keep both and skip without the capability", async () => {
    await cachedFile("report.pdf");
    const { batchId } = await queue("report.pdf");
    const described = await describeDriveUploadBatchConflicts(user, batchId, false);
    expect(described.choices).toEqual(["keep_both", "skip"]);
    expect(described.replaceTargets).toEqual({});
  });

  it("never offers Replace for a file whose hash is still pending", async () => {
    await cachedFile("report.pdf", { contentHashPending: true });
    const { batchId } = await queue("report.pdf");
    const described = await describeDriveUploadBatchConflicts(user, batchId, true);
    expect(described.conflicts[0]?.existing.hashPending).toBe(true);
    expect(described.choices).toEqual(["keep_both", "skip"]);
  });

  it("offline, lets the last known Session decide, and offers no Replace without one", () => {
    expect(driveUploadSessionVersionCheck(user, null)).toBeNull();
    rememberDriveSessionCapabilities(user, { versionCheck: true });
    expect(driveUploadSessionVersionCheck(user, null)).toBe(true);
    rememberDriveSessionCapabilities(user, { versionCheck: false });
    expect(driveUploadSessionVersionCheck(user, null)).toBe(false);
    // Online, the live Session wins.
    expect(driveUploadSessionVersionCheck(user, { versionCheck: true })).toBe(true);
  });

  it("offers no Replace offline when no Session is known", async () => {
    await cachedFile("report.pdf");
    const { batchId } = await queue("report.pdf");
    const versionCheck = driveUploadSessionVersionCheck(user, null);
    const described = await describeDriveUploadBatchConflicts(user, batchId, versionCheck);
    expect(described.choices).toEqual(["keep_both", "skip"]);
  });
});

describe("upload capabilities from the Session", () => {
  function session(capabilities: Record<string, unknown>, account: Record<string, unknown>) {
    return {
      capabilities,
      accounts: { ada: { accountCapabilities: account } },
    } as unknown as JmapSession;
  }

  it("reads the step budget, maxDataSources, and the version check", () => {
    const caps = readDriveUploadCapabilities(
      session(
        {
          [BLOB_CAPABILITY]: {},
          [BLOB_ASSEMBLY_CAPABILITY]: {},
          [FILENODE_VERSION_CHECK_CAPABILITY]: {},
        },
        {
          [BLOB_CAPABILITY]: { maxDataSources: 120, maxSizeBlobSet: 4_000 },
          [BLOB_ASSEMBLY_CAPABILITY]: {
            stepBudgetBytes: 1_000,
            maxSizeAssembly: 4_000,
            assemblyTtlSeconds: 60,
          },
        },
      ),
      "ada",
    );
    expect(caps).toEqual({
      blob: { maxDataSources: 120, maxSizeBlobSet: 4_000 },
      assembly: { stepBudgetBytes: 1_000, maxSizeAssembly: 4_000, assemblyTtlSeconds: 60 },
      versionCheck: true,
    });
  });

  it("ignores an account capability the Session does not advertise", () => {
    const caps = readDriveUploadCapabilities(
      session({}, { [BLOB_ASSEMBLY_CAPABILITY]: { stepBudgetBytes: 1_000 } }),
      "ada",
    );
    expect(caps).toEqual({ blob: null, assembly: null, versionCheck: false });
  });
});
