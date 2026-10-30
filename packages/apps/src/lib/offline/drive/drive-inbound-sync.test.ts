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
  DRIVE_INBOUND_MAX_CHANGE_PAGES,
  readDriveSyncToken,
  syncDriveInboundFromFileNodes,
} from "@/lib/offline/drive/drive-inbound-sync";
import { listKeptUnsavedDocumentPaths } from "@/lib/offline/drive/drive-fetched-set-prune";

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
    await db.table("docs_availability").clear();
    await db.meta.clear();
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
    expect(await readDriveSyncToken(username)).toBeNull();
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
