/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import type { JmapFileNode } from "@/lib/jmap-client";
import { JmapMethodError } from "@/lib/jmap-client";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readDocsAvailability,
  stampDocsAvailabilityNodeIds,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import "@/lib/offline/docs/docs-schema";
import {
  readCachedDriveNodeId,
  readDriveEntryFromCache,
  upsertDriveEntry,
  writeDriveBootstrapToCache,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import "@/lib/offline/drive/drive-schema";
import {
  docsCollabIndexedDbKey,
  docsCollabRoomKey,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/pending-server-save-key";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";

const fileNodeChanges = vi.hoisted(() => vi.fn());
const getFileNodes = vi.hoisted(() => vi.fn());
const syncDriveMetadataTree = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: () => true,
}));

vi.mock("@/lib/api/wgw/drive-jmap", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/drive-jmap")>(
    "@/lib/api/wgw/drive-jmap",
  );
  return {
    ...actual,
    driveJmapSession: async () => ({
      accountId: "ada",
      fileNodes: { fileNodeChanges, getFileNodes },
    }),
  };
});

vi.mock("@/lib/offline/drive/drive-metadata-sync", () => ({
  syncDriveMetadataTree,
}));

import {
  readDriveSyncToken,
  syncDriveInboundFromFileNodes,
} from "@/lib/offline/drive/drive-inbound-sync";
import { listKeptUnsavedDocumentPaths } from "@/lib/offline/drive/drive-local-document";

const username = "ada";

function node(
  id: string,
  parentId: string | null,
  name: string,
  nodeType: JmapFileNode["nodeType"] = "file",
): JmapFileNode {
  return {
    id,
    parentId,
    name,
    nodeType,
    blobId: null,
    size: nodeType === "directory" ? 0 : 4,
    type: nodeType === "file" ? "text/markdown" : null,
    myRights: {
      mayRead: true,
      mayAddChildren: true,
      mayRename: true,
      mayDelete: true,
      mayModifyContent: true,
      mayShare: false,
    },
  };
}

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
    size: type === "dir" ? 0 : 4,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
  };
}

function changes(body: {
  created?: string[];
  updated?: string[];
  destroyed?: string[];
  newState?: string;
}) {
  return {
    accountId: "ada",
    oldState: "0",
    newState: body.newState ?? "2",
    hasMoreChanges: false,
    created: body.created ?? [],
    updated: body.updated ?? [],
    destroyed: body.destroyed ?? [],
  };
}

async function seedPendingSave(apiPath: string, pending: boolean): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
  await persistence.whenSynced;
  if (pending) await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  else await persistence.del(PENDING_SERVER_SAVE_KEY);
  await persistence.destroy();
  ydoc.destroy();
}

async function databaseNames(): Promise<string[]> {
  const rows = await indexedDB.databases();
  return rows.flatMap((row) => (row.name ? [row.name] : []));
}

describe("syncDriveInboundFromFileNodes", () => {
  beforeEach(async () => {
    fileNodeChanges.mockReset();
    getFileNodes.mockReset();
    syncDriveMetadataTree.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveEntriesTable(db).clear();
    await db.table("docs_availability").clear();
    await db.meta.clear();
    getFileNodes.mockImplementation(async (_accountId: string, ids: string[]) => ({
      accountId: "ada",
      state: "9",
      list: [],
      notFound: ids,
    }));
  });

  it("removes the pin, cache row, and database when a remote delete has no local work", async () => {
    const path = "/users/ada/gone.md";
    await upsertDriveEntry(username, entry(path, "fn-gone"));
    await writeDocsAvailability(username, { id: path, location: "My Drive" });
    await stampDocsAvailabilityNodeIds(username, [{ path, nodeId: "fn-gone" }]);
    await seedPendingSave(path, true);
    await seedPendingSave(path, false);
    fileNodeChanges.mockResolvedValue(changes({ destroyed: ["fn-gone"], newState: "3" }));

    await syncDriveInboundFromFileNodes(username);

    expect(await readDriveEntryFromCache(username, path)).toBeNull();
    await expect(readDocsAvailability(username, path)).resolves.toBeUndefined();
    expect(await databaseNames()).not.toContain(docsCollabIndexedDbKey(docsCollabRoomKey(path)));
    expect(await readDriveSyncToken(username)).toBe("3");
  });

  it("keeps the pin, cache row, and database when the deleted document has unsaved work", async () => {
    const path = "/users/ada/unsaved.md";
    await upsertDriveEntry(username, entry(path, "fn-unsaved"));
    await writeDocsAvailability(username, { id: path, location: "My Drive" });
    await stampDocsAvailabilityNodeIds(username, [{ path, nodeId: "fn-unsaved" }]);
    await seedPendingSave(path, true);
    fileNodeChanges.mockResolvedValue(changes({ destroyed: ["fn-unsaved"], newState: "4" }));

    const result = await syncDriveInboundFromFileNodes(username);

    expect(result.keptUnsavedPaths).toEqual(["users/ada/unsaved.md"]);
    expect(await readCachedDriveNodeId(username, path)).toBe("fn-unsaved");
    await expect(readDocsAvailability(username, path)).resolves.toMatchObject({
      id: "users/ada/unsaved.md",
      nodeId: "fn-unsaved",
    });
    const room = docsCollabRoomKey(path);
    const ydoc = new Y.Doc();
    const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
    await persistence.whenSynced;
    await expect(persistence.get(PENDING_SERVER_SAVE_KEY)).resolves.toBeTruthy();
    await persistence.destroy();
    ydoc.destroy();
    await expect(listKeptUnsavedDocumentPaths(username)).resolves.toEqual(["users/ada/unsaved.md"]);
    expect(await databaseNames()).toContain(docsCollabIndexedDbKey(room));
  });

  it("follows a remote rename on the same nodeId without duplicating the row", async () => {
    await upsertDriveEntry(username, entry("/users/ada", "fn-home", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/original.md", "fn-same"));
    await writeDocsAvailability(username, { id: "/users/ada/original.md", location: "My Drive" });
    await stampDocsAvailabilityNodeIds(username, [
      { path: "/users/ada/original.md", nodeId: "fn-same" },
    ]);
    const catalog = new Map<string, JmapFileNode>([
      ["fn-home", node("fn-home", null, "ada", "directory")],
      ["fn-same", node("fn-same", "fn-home", "renamed.md")],
    ]);
    getFileNodes.mockImplementation(async (_accountId: string, ids: string[]) => ({
      accountId: "ada",
      state: "5",
      list: ids.flatMap((id) => {
        const item = catalog.get(id);
        return item ? [item] : [];
      }),
      notFound: ids.filter((id) => !catalog.has(id)),
    }));
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-same"], newState: "5" }));

    await syncDriveInboundFromFileNodes(username);

    expect(await readDriveEntryFromCache(username, "/users/ada/original.md")).toBeNull();
    expect(await readCachedDriveNodeId(username, "/users/ada/renamed.md")).toBe("fn-same");
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const rows = await driveEntriesTable(db).where("nodeId").equals("fn-same").toArray();
    expect(rows.map((row) => row.id)).toEqual(["users/ada/renamed.md"]);
    await expect(readDocsAvailability(username, "/users/ada/renamed.md")).resolves.toMatchObject({
      id: "users/ada/renamed.md",
      nodeId: "fn-same",
    });
    await expect(readDocsAvailability(username, "/users/ada/original.md")).resolves.toBeUndefined();
  });

  it("moves descendant cache rows when a directory is renamed", async () => {
    await upsertDriveEntry(username, entry("/users/ada", "fn-home", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/folder", "fn-dir", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/folder/a.md", "fn-child"));
    const catalog = new Map<string, JmapFileNode>([
      ["fn-home", node("fn-home", null, "ada", "directory")],
      ["fn-dir", node("fn-dir", "fn-home", "notes", "directory")],
    ]);
    getFileNodes.mockImplementation(async (_accountId: string, ids: string[]) => ({
      accountId: "ada",
      state: "6",
      list: ids.flatMap((id) => {
        const item = catalog.get(id);
        return item ? [item] : [];
      }),
      notFound: [],
    }));
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-dir"], newState: "6" }));

    await syncDriveInboundFromFileNodes(username);

    expect(await readDriveEntryFromCache(username, "/users/ada/folder")).toBeNull();
    expect(await readDriveEntryFromCache(username, "/users/ada/folder/a.md")).toBeNull();
    expect(await readCachedDriveNodeId(username, "/users/ada/notes")).toBe("fn-dir");
    expect(await readCachedDriveNodeId(username, "/users/ada/notes/a.md")).toBe("fn-child");
  });

  it("falls back to the full crawl when changes cannot be calculated and then stores that state", async () => {
    await writeDriveBootstrapToCache(username, {
      session: { user: { displayName: "Ada", username } },
      data: {
        user: { username, name: "Ada", role: "user", roots: ["/users"] },
        cwd: "/users/ada",
        directory: { location: "/users/ada", files: [] },
      },
    });
    fileNodeChanges.mockRejectedValue(
      new JmapMethodError("FileNode/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    syncDriveMetadataTree.mockResolvedValue({
      running: false,
      total: 1,
      synced: 1,
      failed: 0,
      updatedAt: 1,
    });
    getFileNodes.mockResolvedValue({ accountId: "ada", state: "42", list: [], notFound: [] });

    const result = await syncDriveInboundFromFileNodes(username);

    expect(result.usedFullResync).toBe(true);
    expect(syncDriveMetadataTree).toHaveBeenCalledTimes(1);
    expect(fileNodeChanges).toHaveBeenCalledTimes(1);
    expect(fileNodeChanges).toHaveBeenCalledWith("ada", "0", expect.anything());
    expect(getFileNodes).toHaveBeenCalledWith("ada", [], expect.anything());
    expect(await readDriveSyncToken(username)).toBe("42");
  });
});
