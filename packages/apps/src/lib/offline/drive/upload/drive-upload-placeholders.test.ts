import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import { JmapMethodError } from "@/lib/jmap-client";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";

const listFileNodeEntries = vi.hoisted(() => vi.fn());
const fileNodeChanges = vi.hoisted(() => vi.fn());
const getFileNodes = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  getConnectivitySnapshot: () => true,
  readBrowserOnline: () => true,
}));

vi.mock("@/lib/api/wgw/drive-jmap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/drive-jmap")>()),
  driveJmapSession: async () => ({
    accountId: "ada",
    fileNodes: { fileNodeChanges, getFileNodes },
    cache: { nodeIdForPath: () => undefined },
  }),
  listFileNodeEntries,
}));

import {
  listAllCachedDriveEntryPaths,
  readDirectoryEntriesFromCache,
  searchDriveEntriesFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { applyFetchedDirectorySnapshot } from "@/lib/offline/drive/drive-fetched-set-prune";
import { syncDriveInboundFromFileNodes } from "@/lib/offline/drive/drive-inbound-sync";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { applyDriveSidecarPathMigration } from "@/lib/offline/shared/drive-sidecar-mutations";
import {
  findUploadPlaceholder,
  uploadPlaceholderRowId,
  withUploadPlaceholders,
} from "@/lib/offline/drive/upload/drive-upload-placeholders";
import {
  enqueueDriveUploadBatch,
  removeDriveUploadItem,
} from "@/lib/offline/drive/upload/drive-upload-store";
import { driveUploadItemsTable } from "@/lib/offline/drive/upload/drive-upload-schema";
import {
  clearUploadTestDb,
  stubNavigatorStorage,
  testFile,
  UPLOAD_TEST_USER as user,
  uploadTestDb,
} from "@/lib/offline/drive/upload/drive-upload-test-helpers.fixture";

function entry(
  path: string,
  nodeId: string,
  type: "file" | "dir" = "file",
): WgwDriveDirectoryEntry {
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

async function queueInto(folderPath: string, name = "report.pdf") {
  const { itemIds } = await enqueueDriveUploadBatch(user, {
    folderPath,
    targetFolder: { kind: "server", id: "fn-target" },
    files: [testFile(name)],
  });
  return itemIds[0]!;
}

async function placeholderPaths(folderPath: string): Promise<string[]> {
  const listing = await readDirectoryEntriesFromCache(user, folderPath);
  return listing.filter((row) => row.upload).map((row) => row.name);
}

describe("upload placeholders in the path-keyed cache", () => {
  let restoreStorage: () => void = () => undefined;

  beforeEach(async () => {
    await clearUploadTestDb();
    restoreStorage = stubNavigatorStorage(undefined);
    listFileNodeEntries.mockReset();
    fileNodeChanges.mockReset();
    getFileNodes.mockReset();
  });

  afterEach(() => restoreStorage());

  it("survives a folder refresh that does not list it, while its item is queued", async () => {
    await upsertDriveEntry(user, entry("/users/ada/docs/old.txt", "fn-old"));
    await queueInto("/users/ada/docs");

    const result = await applyFetchedDirectorySnapshot(user, "/users/ada/docs", [
      entry("/users/ada/docs/new.txt", "fn-new"),
    ]);

    expect(result.removedPaths).toEqual(["users/ada/docs/old.txt"]);
    expect(await placeholderPaths("/users/ada/docs")).toEqual(["report.pdf"]);
  });

  it("prunes a placeholder whose queue item is gone", async () => {
    const itemId = await queueInto("/users/ada/docs");
    await driveUploadItemsTable(uploadTestDb()).delete(itemId);

    await applyFetchedDirectorySnapshot(user, "/users/ada/docs", []);

    expect(await placeholderPaths("/users/ada/docs")).toEqual([]);
  });

  it("keeps a placeholder and its folder when the server stops listing the folder", async () => {
    await upsertDriveEntry(user, entry("/users/ada/docs", "fn-docs", "dir"));
    await queueInto("/users/ada/docs");

    await applyFetchedDirectorySnapshot(user, "/users/ada", []);

    expect(await placeholderPaths("/users/ada/docs")).toEqual(["report.pdf"]);
    expect(await driveEntriesTable(uploadTestDb()).get("users/ada/docs")).toBeDefined();
  });

  it("still protects outbox rows next to placeholders", async () => {
    await upsertDriveEntry(user, entry("/users/ada/docs/pending.txt", "fn-p"));
    await enqueueOutboxMutation(user, {
      id: "o1",
      domain: "drive",
      op: "star",
      payload: JSON.stringify({ op: "star", path: "/users/ada/docs/pending.txt", starred: true }),
    });
    await queueInto("/users/ada/docs");

    const result = await applyFetchedDirectorySnapshot(user, "/users/ada/docs", []);

    expect(result.removedPaths).toEqual([]);
  });

  it("survives the full-resync fallback (cannotCalculateChanges → metadata crawl)", async () => {
    await upsertDriveEntry(user, entry("/users/ada/docs", "fn-docs", "dir"));
    await upsertDriveEntry(user, entry("/users/ada/docs/stale.txt", "fn-stale"));
    await queueInto("/users/ada/docs");
    fileNodeChanges.mockRejectedValue(
      new JmapMethodError("FileNode/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    getFileNodes.mockResolvedValue({ accountId: "ada", state: "7", list: [], notFound: [] });
    listFileNodeEntries.mockImplementation(async (_session: unknown, dir: string) => {
      if (dir === "/users/ada") return [entry("/users/ada/docs", "fn-docs", "dir")];
      return [];
    });

    const result = await syncDriveInboundFromFileNodes(user);

    expect(result.usedFullResync).toBe(true);
    expect(await driveEntriesTable(uploadTestDb()).get("users/ada/docs/stale.txt")).toBeUndefined();
    expect(await placeholderPaths("/users/ada/docs")).toEqual(["report.pdf"]);
  });

  it("follows its folder on rename through the shared path migration", async () => {
    await upsertDriveEntry(user, entry("/users/ada/docs", "fn-docs", "dir"));
    const itemId = await queueInto("/users/ada/docs/sub");

    await applyDriveSidecarPathMigration(user, "/users/ada/docs", "/users/ada", "papers");

    const moved = await findUploadPlaceholder(user, itemId);
    expect(moved?.id).toBe(uploadPlaceholderRowId("/users/ada/papers/sub", itemId));
    expect(moved?.parentPath).toBe("users/ada/papers/sub");
    expect(await placeholderPaths("/users/ada/papers/sub")).toEqual(["report.pdf"]);
    expect(await placeholderPaths("/users/ada/docs/sub")).toEqual([]);
  });

  it("is left out of content sync and search", async () => {
    await upsertDriveEntry(user, entry("/users/ada/report-final.pdf", "fn-real"));
    await queueInto("/users/ada", "report.pdf");

    expect(await listAllCachedDriveEntryPaths(user)).toEqual(["users/ada/report-final.pdf"]);
    const found = await searchDriveEntriesFromCache(user, "report");
    expect(found.map((row) => row.nodeId)).toEqual(["fn-real"]);
  });

  it("adds the folder's placeholders to a server listing", async () => {
    const itemId = await queueInto("/users/ada");
    const data = {
      user: { username: user, name: user, role: "user" as const, roots: [] },
      cwd: "/users/ada",
      directory: { location: "/users/ada", files: [entry("/users/ada/x.txt", "fn-x")] },
    };

    const merged = await withUploadPlaceholders(user, data);

    expect(merged.directory.files.map((row) => row.upload?.id ?? row.nodeId)).toEqual([
      "fn-x",
      itemId,
    ]);
    await removeDriveUploadItem(user, itemId);
    expect((await withUploadPlaceholders(user, data)).directory.files).toHaveLength(1);
  });
});
