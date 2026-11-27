/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import type { JmapFileNode, JmapRequest, JmapSession } from "@/lib/jmap-client";
import {
  CORE_CAPABILITY,
  FILENODE_CAPABILITY,
  JmapClient,
  JmapFileNodesClient,
  JmapMethodError,
  NOTES_CAPABILITY,
} from "@/lib/jmap-client";
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
import { subscribeDocsPathMoved } from "@/lib/offline/docs/docs-path-moves";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import "@/lib/offline/drive/drive-schema";
import { docsCollabIndexedDbKey, docsCollabRoomKey } from "@/lib/collab/docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "@/lib/collab/pending-server-save-key";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";

const fileNodeChanges = vi.hoisted(() => vi.fn());
const getFileNodes = vi.hoisted(() => vi.fn());
const syncDriveMetadataTree = vi.hoisted(() => vi.fn());

// The crawl fallback reads the share roots; these tests have none.
vi.mock("@/lib/api/wgw/drive-shares", () => ({ fetchDriveSharedWithMe: async () => [] }));
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
  DRIVE_INBOUND_MAX_CHANGE_PAGES,
  readDriveSyncToken,
  syncDriveInboundFromFileNodes,
  writeDriveSyncToken,
} from "@/lib/offline/drive/drive-inbound-sync";
import { DRIVE_TREE_FIRST_SYNC_DONE_KEY } from "@/lib/offline/drive/drive-tree-sync";
import { writeMeta } from "@/lib/offline/core/meta-store";
import { listKeptUnsavedDocumentPaths } from "@/lib/offline/drive/drive-fetched-set-prune";
import {
  readDriveAvailability,
  writeDriveAvailability,
} from "@/lib/offline/drive/drive-availability-store";
import { writeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import { findUploadPlaceholder } from "@/lib/offline/drive/upload/drive-upload-placeholders";
import { enqueueDriveUploadBatch } from "@/lib/offline/drive/upload/drive-upload-store";

async function queuePlaceholder(folderPath: string): Promise<string> {
  const { itemIds } = await enqueueDriveUploadBatch(username, {
    folderPath,
    targetFolder: { kind: "server", id: "fn-dir" },
    files: [new File(["x"], "upload.pdf", { type: "application/pdf" })],
  });
  return itemIds[0]!;
}

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
  hasMoreChanges?: boolean;
}) {
  return {
    accountId: "ada",
    oldState: "0",
    newState: body.newState ?? "2",
    hasMoreChanges: body.hasMoreChanges ?? false,
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

function installCatalog(catalog: Map<string, JmapFileNode>): void {
  getFileNodes.mockImplementation(async (_accountId: string, ids: string[]) => ({
    accountId: "ada",
    state: "9",
    list: ids.flatMap((id) => {
      const item = catalog.get(id);
      return item ? [item] : [];
    }),
    notFound: ids.filter((id) => !catalog.has(id)),
  }));
}

/**
 * A real `JmapFileNodesClient` over a server stand-in that answers
 * `FileNode/get` from `catalog` and, like the WGW server, rejects a get of more
 * than 500 ids with `requestTooLarge`. The session omits `maxObjectsInGet`.
 */
async function fileNodesBehindServer(
  catalog: Map<string, JmapFileNode>,
): Promise<{ client: JmapFileNodesClient; getSizes: number[] }> {
  const getSizes: number[] = [];
  const session = {
    capabilities: { [CORE_CAPABILITY]: {}, [NOTES_CAPABILITY]: {}, [FILENODE_CAPABILITY]: {} },
    accounts: {},
    primaryAccounts: { [FILENODE_CAPABILITY]: "ada" },
    username: "ada",
    apiUrl: "/jmap",
    downloadUrl: "",
    uploadUrl: "",
    eventSourceUrl: "",
    state: "1",
  } satisfies JmapSession;
  const jmap = new JmapClient({
    sessionUrl: "/jmap/session",
    fetch: async (input, init) => {
      if (input === "/jmap/session") return new Response(JSON.stringify(session));
      const body = JSON.parse(String(init?.body)) as JmapRequest;
      const methodResponses = body.methodCalls.map(([name, args, id]) => {
        const ids = (args.ids as string[] | null) ?? [];
        getSizes.push(ids.length);
        if (ids.length > 500) {
          return [
            "error",
            { type: "requestTooLarge", description: "ids exceeds maxObjectsInGet." },
            id,
          ];
        }
        return [
          name,
          {
            accountId: "ada",
            state: "9",
            list: ids.flatMap((nodeId) => catalog.get(nodeId) ?? []),
            notFound: ids.filter((nodeId) => !catalog.has(nodeId)),
          },
          id,
        ];
      });
      return new Response(JSON.stringify({ methodResponses, sessionState: "1" }));
    },
  });
  await jmap.connect();
  return { client: new JmapFileNodesClient(jmap), getSizes };
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
    await db.table("drive_upload_items").clear();
    await db.table("drive_upload_batches").clear();
    await db.table("docs_availability").clear();
    await db.meta.clear();
    // A device that synced before: changes only. No token runs the full tree sync.
    await writeDriveSyncToken(username, "0");
    await writeMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
    getFileNodes.mockImplementation(async (_accountId: string, ids: string[]) => ({
      accountId: "ada",
      state: "9",
      list: [],
      notFound: ids,
    }));
  });

  it("clears the pin, cache row, and collab room when a remote delete has no local work", async () => {
    const path = "/users/ada/gone.md";
    await upsertDriveEntry(username, entry(path, "fn-gone"));
    await writeDocsAvailability(username, { id: path, location: "My Drive" });
    await stampDocsAvailabilityNodeIds(username, [{ path, nodeId: "fn-gone" }]);
    await seedPendingSave(path, true);
    await seedPendingSave(path, false);
    const room = docsCollabRoomKey(path);
    const probeDoc = new Y.Doc();
    const probe = new IndexeddbPersistence(docsCollabIndexedDbKey(room), probeDoc);
    await probe.whenSynced;
    await probe.set("probe", 1);
    await probe.destroy();
    probeDoc.destroy();
    fileNodeChanges.mockResolvedValue(changes({ destroyed: ["fn-gone"], newState: "3" }));

    await syncDriveInboundFromFileNodes(username);

    expect(await readDriveEntryFromCache(username, path)).toBeNull();
    await expect(readDocsAvailability(username, path)).resolves.toBeUndefined();
    const after = new Y.Doc();
    const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), after);
    await persistence.whenSynced;
    await expect(persistence.get("probe")).resolves.toBeFalsy();
    await expect(persistence.get(PENDING_SERVER_SAVE_KEY)).resolves.toBeFalsy();
    await persistence.destroy();
    after.destroy();
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

  it("moves a pin found by nodeId even when its path is stale", async () => {
    await upsertDriveEntry(username, entry("/users/ada", "fn-home", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/current.md", "fn-pin"));
    await writeDocsAvailability(username, {
      id: "/users/ada/older.md",
      location: "My Drive",
      nodeId: "fn-pin",
    });
    const catalog = new Map<string, JmapFileNode>([
      ["fn-home", node("fn-home", null, "ada", "directory")],
      ["fn-pin", node("fn-pin", "fn-home", "latest.md")],
    ]);
    getFileNodes.mockImplementation(async (_accountId: string, ids: string[]) => ({
      accountId: "ada",
      state: "7",
      list: ids.flatMap((id) => {
        const item = catalog.get(id);
        return item ? [item] : [];
      }),
      notFound: [],
    }));
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-pin"], newState: "7" }));

    await syncDriveInboundFromFileNodes(username);

    await expect(readDocsAvailability(username, "/users/ada/older.md")).resolves.toBeUndefined();
    await expect(readDocsAvailability(username, "/users/ada/latest.md")).resolves.toMatchObject({
      nodeId: "fn-pin",
    });
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

  it("moves an upload placeholder with its folder on a remote rename", async () => {
    await upsertDriveEntry(username, entry("/users/ada", "fn-home", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/folder", "fn-dir", "dir"));
    const itemId = await queuePlaceholder("/users/ada/folder");
    installCatalog(
      new Map([
        ["fn-home", node("fn-home", null, "ada", "directory")],
        ["fn-dir", node("fn-dir", "fn-home", "notes", "directory")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-dir"], newState: "6" }));

    await syncDriveInboundFromFileNodes(username);

    const placeholder = await findUploadPlaceholder(username, itemId);
    expect(placeholder?.parentPath).toBe("users/ada/notes");
    expect(placeholder?.uploadId).toBe(itemId);
  });

  it("keeps a placeholder with its folder when the folder move is blocked", async () => {
    await upsertDriveEntry(username, entry("/users/ada", "fn-home", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/folder", "fn-dir", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/taken.md", "fn-occupant"));
    await seedPendingSave("/users/ada/taken.md", true);
    const itemId = await queuePlaceholder("/users/ada/folder");
    installCatalog(
      new Map([
        ["fn-home", node("fn-home", null, "ada", "directory")],
        ["fn-dir", node("fn-dir", "fn-home", "taken.md", "directory")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-dir"], newState: "8" }));

    const blocked = await syncDriveInboundFromFileNodes(username);

    expect(blocked.keptUnsavedPaths).toEqual(["users/ada/taken.md"]);
    const stayed = await findUploadPlaceholder(username, itemId);
    expect(stayed?.parentPath).toBe("users/ada/folder");
    expect(await readCachedDriveNodeId(username, "/users/ada/folder")).toBe("fn-dir");

    await seedPendingSave("/users/ada/taken.md", false);
    await syncDriveInboundFromFileNodes(username);

    const moved = await findUploadPlaceholder(username, itemId);
    expect(moved?.parentPath).toBe("users/ada/taken.md");
    expect(await readCachedDriveNodeId(username, "/users/ada/taken.md")).toBe("fn-dir");
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

  it("applies every hasMoreChanges page before storing the last state", async () => {
    await upsertDriveEntry(username, entry("/users/ada", "fn-home", "dir"));
    installCatalog(
      new Map([
        ["fn-home", node("fn-home", null, "ada", "directory")],
        ["fn-a", node("fn-a", "fn-home", "a.md")],
        ["fn-b", node("fn-b", "fn-home", "b.md")],
      ]),
    );
    fileNodeChanges
      .mockResolvedValueOnce(changes({ created: ["fn-a"], newState: "1", hasMoreChanges: true }))
      .mockResolvedValueOnce(changes({ created: ["fn-b"], newState: "2" }));

    await syncDriveInboundFromFileNodes(username);

    expect(fileNodeChanges).toHaveBeenNthCalledWith(1, "ada", "0", expect.anything());
    expect(fileNodeChanges).toHaveBeenNthCalledWith(2, "ada", "1", expect.anything());
    expect(await readCachedDriveNodeId(username, "/users/ada/a.md")).toBe("fn-a");
    expect(await readCachedDriveNodeId(username, "/users/ada/b.md")).toBe("fn-b");
    expect(await readDriveSyncToken(username)).toBe("2");
  });

  it("stops at the page cap and stores the last page it applied", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let page = 0;
    fileNodeChanges.mockImplementation(async () => {
      page += 1;
      return changes({ newState: String(page), hasMoreChanges: true });
    });

    await syncDriveInboundFromFileNodes(username);

    expect(fileNodeChanges).toHaveBeenCalledTimes(DRIVE_INBOUND_MAX_CHANGE_PAGES);
    expect(await readDriveSyncToken(username)).toBe(String(DRIVE_INBOUND_MAX_CHANGE_PAGES));
    expect(warn).toHaveBeenCalledWith(
      "[drive-inbound] FileNode/changes still has more pages after the safety cap",
      { pages: DRIVE_INBOUND_MAX_CHANGE_PAGES },
    );
    warn.mockRestore();
  });

  it("skips a FileNode whose path cannot be resolved and still advances the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await upsertDriveEntry(username, entry("/users/ada", "fn-home", "dir"));
    installCatalog(
      new Map([
        ["fn-home", node("fn-home", null, "ada", "directory")],
        ["fn-ok", node("fn-ok", "fn-home", "ok.md")],
        ["fn-bad", node("fn-bad", "fn-missing", "bad.md")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ created: ["fn-ok", "fn-bad"], newState: "7" }));

    const result = await syncDriveInboundFromFileNodes(username);

    expect(await readCachedDriveNodeId(username, "/users/ada/ok.md")).toBe("fn-ok");
    expect(await readDriveEntryFromCache(username, "/users/ada/bad.md")).toBeNull();
    expect(await readDriveSyncToken(username)).toBe("7");
    expect(result.keptUnsavedPaths).toEqual([]);
    expect(warn).toHaveBeenCalledWith("[drive-inbound] skipped FileNode with no resolvable path", {
      id: "fn-bad",
    });
    warn.mockRestore();
  });

  it("reports a change under someone else's share it could not place (#1663)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installCatalog(new Map([["fn-shared", node("fn-shared", "fn-admin-folder", "plan.md")]]));
    fileNodeChanges.mockResolvedValue(changes({ created: ["fn-shared"], newState: "8" }));

    const result = await syncDriveInboundFromFileNodes(username);

    expect(result.changed).toBe(false);
    expect(result.listedChanges).toBe(true);
    warn.mockRestore();
  });

  it("reports no listed changes when FileNode/changes is empty", async () => {
    fileNodeChanges.mockResolvedValue(changes({ newState: "9" }));
    const result = await syncDriveInboundFromFileNodes(username);
    expect(result).toMatchObject({ changed: false, listedChanges: false });
  });

  it("does not advance the token past a move blocked by unsaved work", async () => {
    await upsertDriveEntry(username, entry("/users/ada", "fn-home", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/old.md", "fn-moving"));
    await upsertDriveEntry(username, entry("/users/ada/taken.md", "fn-occupant"));
    await seedPendingSave("/users/ada/taken.md", true);
    installCatalog(
      new Map([
        ["fn-home", node("fn-home", null, "ada", "directory")],
        ["fn-moving", node("fn-moving", "fn-home", "taken.md")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-moving"], newState: "8" }));

    const result = await syncDriveInboundFromFileNodes(username);

    expect(result.keptUnsavedPaths).toEqual(["users/ada/taken.md"]);
    expect(await readDriveSyncToken(username)).toBe("0");
    expect(await readCachedDriveNodeId(username, "/users/ada/old.md")).toBe("fn-moving");
    expect(await readCachedDriveNodeId(username, "/users/ada/taken.md")).toBe("fn-occupant");
  });

  it("leaves a cache row with no nodeId in place when some other id is destroyed", async () => {
    await upsertDriveEntry(username, {
      ...entry("/users/ada/legacy.md", "fn-unused"),
      nodeId: undefined,
    });
    fileNodeChanges.mockResolvedValue(changes({ destroyed: ["fn-destroyed"], newState: "9" }));

    const result = await syncDriveInboundFromFileNodes(username);

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await driveEntriesTable(db).get("users/ada/legacy.md");
    expect(row?.nodeId).toBeUndefined();
    expect(await readDriveEntryFromCache(username, "/users/ada/legacy.md")).not.toBeNull();
    expect(result.keptUnsavedPaths).toEqual([]);
    expect(await readDriveSyncToken(username)).toBe("9");
  });

  it("applies more than 500 changed ids in one sync and writes every row", async () => {
    const files = Array.from({ length: 620 }, (_, index) =>
      node(`fn-file-${index}`, "fn-home", `file-${index}.md`),
    );
    const catalog = new Map<string, JmapFileNode>([
      ["fn-home", node("fn-home", null, "ada", "directory")],
      ...files.map((file) => [file.id, file] as const),
    ]);
    const server = await fileNodesBehindServer(catalog);
    getFileNodes.mockImplementation(
      (accountId: string, ids: string[], options?: { signal?: AbortSignal }) =>
        server.client.getFileNodes(accountId, ids, options),
    );
    fileNodeChanges.mockResolvedValue(changes({ created: [...catalog.keys()], newState: "10" }));

    const result = await syncDriveInboundFromFileNodes(username);

    expect(result.changed).toBe(true);
    expect(server.getSizes.every((size) => size <= 500)).toBe(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const rows = await driveEntriesTable(db).where("nodeId").above("").toArray();
    expect(rows).toHaveLength(catalog.size);
    expect(await readCachedDriveNodeId(username, "/users/ada/file-619.md")).toBe("fn-file-619");
    expect(await readDriveSyncToken(username)).toBe("10");
  });
});

describe("syncDriveInboundFromFileNodes paths (#2063 C1)", () => {
  const table = () =>
    driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));
  const withPath = (item: JmapFileNode, path: string): JmapFileNode => ({ ...item, path });

  beforeEach(async () => {
    fileNodeChanges.mockReset();
    getFileNodes.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveEntriesTable(db).clear();
    await db.table("drive_content_blobs").clear();
    await db.meta.clear();
    await writeDriveSyncToken(username, "0");
    await writeMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
  });

  it("an inner folder renamed in one changes batch keeps its child at the inner path", async () => {
    await upsertDriveEntry(username, entry("/users/ada/a", "fn-a", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/a/b", "fn-b", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/a/b/c.md", "fn-c"));
    await writeDriveContentBlob(username, "/users/ada/a/b/c.md", new Blob(["body"]));
    installCatalog(
      new Map([
        ["fn-b", withPath(node("fn-b", "fn-a", "b2", "directory"), "/users/ada/a2/b2")],
        ["fn-a", withPath(node("fn-a", "fn-home", "a2", "directory"), "/users/ada/a2")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-b", "fn-a"], newState: "5" }));

    await syncDriveInboundFromFileNodes(username);

    expect((await table().toCollection().primaryKeys()).sort()).toEqual([
      "users/ada/a2",
      "users/ada/a2/b2",
      "users/ada/a2/b2/c.md",
    ]);
    expect(await readCachedDriveNodeId(username, "/users/ada/a2/b2/c.md")).toBe("fn-c");
    const blobs = offlineDbForAccount(offlineAccountKeyFromUsername(username)).table(
      "drive_content_blobs",
    );
    expect(await blobs.get("users/ada/a2/b2/c.md")).toBeDefined();
    expect(await blobs.get("users/ada/a/b/c.md")).toBeUndefined();
  });

  it("a renamed share root keeps its child under the new path", async () => {
    await upsertDriveEntry(username, entry("/users/bob/Plans", "fn-share", "dir"), "share");
    await upsertDriveEntry(username, entry("/users/bob/Plans/c.md", "fn-share-c"), "share");
    // The owner's parent is out of sight: FileNode/get cannot return it.
    installCatalog(
      new Map([
        [
          "fn-share",
          withPath(
            node("fn-share", "fn-bob-home", "Plans 2026", "directory"),
            "/users/bob/Plans 2026",
          ),
        ],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-share"], newState: "6" }));

    await syncDriveInboundFromFileNodes(username);

    expect((await table().toCollection().primaryKeys()).sort()).toEqual([
      "users/bob/Plans 2026",
      "users/bob/Plans 2026/c.md",
    ]);
    expect(await readCachedDriveNodeId(username, "/users/bob/Plans 2026/c.md")).toBe("fn-share-c");
    expect(await readDriveSyncToken(username)).toBe("6");
  });

  it("a folder renamed onto another folder's old path keeps both folders", async () => {
    await upsertDriveEntry(username, entry("/users/ada/reports-2024", "fn-r24", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/reports-2024/old.md", "fn-old"));
    await upsertDriveEntry(username, entry("/users/ada/reports", "fn-r", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/reports/new.md", "fn-new"));
    await writeDriveContentBlob(username, "/users/ada/reports-2024/old.md", new Blob(["O"]));
    await writeDriveContentBlob(username, "/users/ada/reports/new.md", new Blob(["NN"]));
    // The new name first: it lands on a path the other folder is still leaving.
    installCatalog(
      new Map([
        [
          "fn-r",
          withPath(node("fn-r", "fn-home", "reports-2024", "directory"), "/users/ada/reports-2024"),
        ],
        [
          "fn-r24",
          withPath(
            node("fn-r24", "fn-home", "reports-2024-old", "directory"),
            "/users/ada/reports-2024-old",
          ),
        ],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-r", "fn-r24"], newState: "8" }));

    await syncDriveInboundFromFileNodes(username);

    expect((await table().toCollection().primaryKeys()).sort()).toEqual([
      "users/ada/reports-2024",
      "users/ada/reports-2024-old",
      "users/ada/reports-2024-old/old.md",
      "users/ada/reports-2024/new.md",
    ]);
    expect(await readCachedDriveNodeId(username, "/users/ada/reports-2024")).toBe("fn-r");
    expect(await readCachedDriveNodeId(username, "/users/ada/reports-2024/new.md")).toBe("fn-new");
    expect(await readCachedDriveNodeId(username, "/users/ada/reports-2024-old/old.md")).toBe(
      "fn-old",
    );
    const blobs = offlineDbForAccount(offlineAccountKeyFromUsername(username)).table(
      "drive_content_blobs",
    );
    expect((await blobs.get("users/ada/reports-2024/new.md"))?.size).toBe(2);
    expect((await blobs.get("users/ada/reports-2024-old/old.md"))?.size).toBe(1);
  });

  it("a folder moved into a vacated name stays there", async () => {
    await upsertDriveEntry(username, entry("/users/ada/a", "fn-a", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/a/b", "fn-old-b", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/a/b/z.md", "fn-z"));
    await upsertDriveEntry(username, entry("/users/ada/x", "fn-x", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/x/inner.md", "fn-inner"));
    // `/a` → `/a2`, a new folder takes the name `/a`, and `/x` moves into it as `b`.
    installCatalog(
      new Map([
        ["fn-x", withPath(node("fn-x", "fn-a-new", "b", "directory"), "/users/ada/a/b")],
        ["fn-a-new", withPath(node("fn-a-new", "fn-home", "a", "directory"), "/users/ada/a")],
        ["fn-a", withPath(node("fn-a", "fn-home", "a2", "directory"), "/users/ada/a2")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(
      changes({ created: ["fn-a-new"], updated: ["fn-x", "fn-a"], newState: "9" }),
    );

    await syncDriveInboundFromFileNodes(username);

    expect((await table().toCollection().primaryKeys()).sort()).toEqual([
      "users/ada/a",
      "users/ada/a/b",
      "users/ada/a/b/inner.md",
      "users/ada/a2",
      "users/ada/a2/b",
      "users/ada/a2/b/z.md",
    ]);
    expect(await readCachedDriveNodeId(username, "/users/ada/a")).toBe("fn-a-new");
    expect(await readCachedDriveNodeId(username, "/users/ada/a/b")).toBe("fn-x");
    expect(await readCachedDriveNodeId(username, "/users/ada/a/b/inner.md")).toBe("fn-inner");
    expect(await readCachedDriveNodeId(username, "/users/ada/a2/b")).toBe("fn-old-b");
    expect(await readCachedDriveNodeId(username, "/users/ada/a2/b/z.md")).toBe("fn-z");
  });

  it("a folder moved out of .notes in one changes batch brings its child", async () => {
    // Nothing under `.notes` is cached; the server reports the arrival with its child.
    installCatalog(
      new Map([
        ["fn-out-c", withPath(node("fn-out-c", "fn-out", "c.md"), "/users/ada/Out/c.md")],
        ["fn-out", withPath(node("fn-out", "fn-home", "Out", "directory"), "/users/ada/Out")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-out-c", "fn-out"], newState: "10" }));

    await syncDriveInboundFromFileNodes(username);

    expect((await table().toCollection().primaryKeys()).sort()).toEqual([
      "users/ada/Out",
      "users/ada/Out/c.md",
    ]);
    expect(await readCachedDriveNodeId(username, "/users/ada/Out/c.md")).toBe("fn-out-c");
  });

  it("a renamed file keeps its offline blob", async () => {
    await upsertDriveEntry(username, entry("/users/ada/draft.md", "fn-draft"));
    await writeDriveContentBlob(username, "/users/ada/draft.md", new Blob(["body"]));
    installCatalog(
      new Map([
        ["fn-draft", withPath(node("fn-draft", "fn-home", "final.md"), "/users/ada/final.md")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-draft"], newState: "11" }));

    await syncDriveInboundFromFileNodes(username);

    const blobs = offlineDbForAccount(offlineAccountKeyFromUsername(username)).table(
      "drive_content_blobs",
    );
    expect((await blobs.get("users/ada/final.md"))?.size).toBe(4);
    expect(await blobs.get("users/ada/draft.md")).toBeUndefined();
    expect((await table().toCollection().primaryKeys()).sort()).toEqual(["users/ada/final.md"]);
  });

  it("two files that swap paths keep their own blobs", async () => {
    await upsertDriveEntry(username, entry("/users/ada/a.md", "fn-a"));
    await upsertDriveEntry(username, entry("/users/ada/b.md", "fn-b"));
    await writeDriveContentBlob(username, "/users/ada/a.md", new Blob(["A"]));
    await writeDriveContentBlob(username, "/users/ada/b.md", new Blob(["BB"]));
    installCatalog(
      new Map([
        ["fn-a", withPath(node("fn-a", "fn-home", "b.md"), "/users/ada/b.md")],
        ["fn-b", withPath(node("fn-b", "fn-home", "a.md"), "/users/ada/a.md")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-a", "fn-b"], newState: "12" }));

    await syncDriveInboundFromFileNodes(username);

    expect(await readCachedDriveNodeId(username, "/users/ada/a.md")).toBe("fn-b");
    expect(await readCachedDriveNodeId(username, "/users/ada/b.md")).toBe("fn-a");
    const blobs = offlineDbForAccount(offlineAccountKeyFromUsername(username)).table(
      "drive_content_blobs",
    );
    expect((await blobs.get("users/ada/a.md"))?.size).toBe(2);
    expect((await blobs.get("users/ada/b.md"))?.size).toBe(1);
  });

  it("a file renamed onto a deleted path keeps its offline blob", async () => {
    await upsertDriveEntry(username, entry("/users/ada/draft.md", "fn-draft"));
    await upsertDriveEntry(username, entry("/users/ada/report.md", "fn-report"));
    await writeDriveContentBlob(username, "/users/ada/draft.md", new Blob(["draft"]));
    await writeDriveContentBlob(username, "/users/ada/report.md", new Blob(["RR"]));
    installCatalog(
      new Map([
        ["fn-draft", withPath(node("fn-draft", "fn-home", "report.md"), "/users/ada/report.md")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(
      changes({ updated: ["fn-draft"], destroyed: ["fn-report"], newState: "13" }),
    );

    await syncDriveInboundFromFileNodes(username);

    expect(await readCachedDriveNodeId(username, "/users/ada/report.md")).toBe("fn-draft");
    const blobs = offlineDbForAccount(offlineAccountKeyFromUsername(username)).table(
      "drive_content_blobs",
    );
    expect((await blobs.get("users/ada/report.md"))?.size).toBe(5);
    expect(await blobs.get("users/ada/draft.md")).toBeUndefined();
  });

  it("updated ids are fetched in maxObjectsInGet batches", async () => {
    const ids = Array.from({ length: 1200 }, (_, index) => `fn-${index}`);
    installCatalog(new Map());
    fileNodeChanges.mockResolvedValue(changes({ updated: ids, newState: "7" }));

    await syncDriveInboundFromFileNodes(username);

    const sizes = getFileNodes.mock.calls.map(([, batch]) => (batch as string[]).length);
    expect(sizes).toEqual([500, 500, 200]);
  });
});

describe("syncDriveInboundFromFileNodes and the Docs caches (#1563)", () => {
  async function treePaths(): Promise<string[]> {
    const rows = await driveEntriesTable(
      offlineDbForAccount(offlineAccountKeyFromUsername(username)),
    ).toArray();
    return rows
      .map((row) => String(row.id))
      .filter((id) => id.endsWith(".md"))
      .sort();
  }

  beforeEach(async () => {
    fileNodeChanges.mockReset();
    getFileNodes.mockReset();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveEntriesTable(db).clear();
    await db.table("docs_availability").clear();
    await db.table("drive_availability").clear();
    await db.table("drive_content_blobs").clear();
    await db.outbox.clear();
    await db.meta.clear();
    // A device that synced before: changes only. No token runs the full tree sync.
    await writeDriveSyncToken(username, "0");
    await writeMeta(username, DRIVE_TREE_FIRST_SYNC_DONE_KEY, "1");
  });

  it("applies a FileNode delete, rename and move to the tree Docs home lists", async () => {
    await upsertDriveEntry(username, entry("/users/ada", "fn-home", "dir"));
    await upsertDriveEntry(username, entry("/groups/team", "fn-team", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/deleted.md", "fn-del"));
    await upsertDriveEntry(username, entry("/users/ada/before.md", "fn-ren"));
    await upsertDriveEntry(username, entry("/users/ada/moving.md", "fn-mov"));
    await upsertDriveEntry(username, entry("/users/ada/kept.md", "fn-kept"));
    installCatalog(
      new Map<string, JmapFileNode>([
        ["fn-home", node("fn-home", null, "ada", "directory")],
        ["fn-team", node("fn-team", null, "team", "directory")],
        ["fn-ren", node("fn-ren", "fn-home", "after.md")],
        ["fn-mov", node("fn-mov", "fn-team", "moving.md")],
      ]),
    );
    fileNodeChanges.mockResolvedValue(
      changes({ updated: ["fn-ren", "fn-mov"], destroyed: ["fn-del"], newState: "6" }),
    );

    await syncDriveInboundFromFileNodes(username);

    expect(await treePaths()).toEqual([
      "groups/team/moving.md",
      "users/ada/after.md",
      "users/ada/kept.md",
    ]);
    expect(await readDriveSyncToken(username)).toBe("6");
  });

  it("a folder renamed onto another folder's old path keeps a doc under each", async () => {
    await upsertDriveEntry(username, entry("/users/ada/reports-2024", "fn-r24", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/reports-2024/old.md", "fn-old"));
    await upsertDriveEntry(username, entry("/users/ada/reports", "fn-r", "dir"));
    await upsertDriveEntry(username, entry("/users/ada/reports/new.md", "fn-new"));
    installCatalog(
      new Map<string, JmapFileNode>([
        [
          "fn-r",
          {
            ...node("fn-r", "fn-home", "reports-2024", "directory"),
            path: "/users/ada/reports-2024",
          },
        ],
        [
          "fn-r24",
          {
            ...node("fn-r24", "fn-home", "reports-2024-old", "directory"),
            path: "/users/ada/reports-2024-old",
          },
        ],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-r", "fn-r24"], newState: "7" }));

    await syncDriveInboundFromFileNodes(username);

    expect(await treePaths()).toEqual([
      "users/ada/reports-2024-old/old.md",
      "users/ada/reports-2024/new.md",
    ]);
    expect(
      (await readDriveEntryFromCache(username, "/users/ada/reports-2024-old/old.md"))?.nodeId,
    ).toBe("fn-old");
    expect(
      (await readDriveEntryFromCache(username, "/users/ada/reports-2024/new.md"))?.nodeId,
    ).toBe("fn-new");
  });

  it("two docs that swap paths keep their own rows in the tree Docs home lists", async () => {
    await upsertDriveEntry(username, entry("/users/ada/a.md", "fn-a"));
    await upsertDriveEntry(username, entry("/users/ada/b.md", "fn-b"));
    installCatalog(
      new Map<string, JmapFileNode>([
        ["fn-a", { ...node("fn-a", "fn-home", "b.md"), path: "/users/ada/b.md" }],
        ["fn-b", { ...node("fn-b", "fn-home", "a.md"), path: "/users/ada/a.md" }],
      ]),
    );
    fileNodeChanges.mockResolvedValue(changes({ updated: ["fn-a", "fn-b"], newState: "8" }));

    await syncDriveInboundFromFileNodes(username);

    expect((await readDriveEntryFromCache(username, "/users/ada/b.md"))?.nodeId).toBe("fn-a");
    expect((await readDriveEntryFromCache(username, "/users/ada/a.md"))?.nodeId).toBe("fn-b");
  });

  it("full resync tells Docs which Docs moved, so stars and editors follow (#1563)", async () => {
    await upsertDriveEntry(username, entry("/users/ada/before.md", "fn-ren"));
    fileNodeChanges.mockRejectedValue(
      new JmapMethodError("FileNode/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    syncDriveMetadataTree.mockImplementation(async () => {
      await driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username))).delete(
        "users/ada/before.md",
      );
      await upsertDriveEntry(username, entry("/users/ada/after.md", "fn-ren"));
      return { running: false, total: 1, synced: 1, failed: 0, updatedAt: 1 };
    });
    getFileNodes.mockResolvedValue({ accountId: "ada", state: "8", list: [], notFound: [] });

    const heard: Array<[string, string]> = [];
    const stop = subscribeDocsPathMoved(username, (moves) =>
      moves.forEach(({ from, to }) => heard.push([from, to])),
    );
    const result = await syncDriveInboundFromFileNodes(username);
    stop();

    expect(result.usedFullResync).toBe(true);
    expect(heard).toEqual([["users/ada/before.md", "users/ada/after.md"]]);
    expect(await treePaths()).toEqual(["users/ada/after.md"]);
  });

  it("removes the Drive availability row and content blob of a destroyed node", async () => {
    const path = "/users/ada/report.md";
    await upsertDriveEntry(username, entry(path, "fn-report"));
    await writeDriveContentBlob(username, path, new Blob(["x"], { type: "text/markdown" }), 1);
    await writeDriveAvailability(username, { id: path, source: "manual" });
    fileNodeChanges.mockResolvedValue(changes({ destroyed: ["fn-report"], newState: "8" }));

    await syncDriveInboundFromFileNodes(username);

    await expect(readDriveAvailability(username, path)).resolves.toBeUndefined();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await expect(db.table("drive_content_blobs").get("users/ada/report.md")).resolves.toBe(
      undefined,
    );
  });
});
