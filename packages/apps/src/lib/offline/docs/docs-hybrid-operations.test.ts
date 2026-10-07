import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { driveUserTrashApiPath } from "@/drive-core/src/drive-path-utils";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { listOutboxMutations } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import {
  captureOfflineDocsTrashSnapshot,
  createHybridDocsDriveOperations,
  undoOfflineDocsTrash,
} from "@/lib/offline/docs/docs-hybrid-operations";
import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { hasDocsCollabOfflinePersistence } from "@/lib/offline/docs/docs-collab-offline-availability";
import { docsCollabIndexedDbKey } from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { docsAvailabilityTable, docsListingRowsTable } from "@/lib/offline/docs/docs-schema";
import {
  readDocsListingFromCache,
  writeDocsListingToCache,
} from "@/lib/offline/docs-listing-offline-store";
import type { WgwUnifiedSearchResult } from "@/lib/api/wgw/search";

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return {
    ...actual,
    readBrowserOnline: vi.fn(() => false),
  };
});

vi.mock("@/lib/api/wgw/drive", () => ({
  createWgwDriveOperations: vi.fn(() => ({
    renameItem: vi.fn(),
    createFolder: vi.fn(),
    listAllDirectoryEntries: vi.fn(async () => []),
    uploadFiles: vi.fn(),
    downloadFile: vi.fn(),
    readFileBlob: vi.fn(),
    listStars: vi.fn(async () => []),
    setStar: vi.fn(),
  })),
}));

import { readDocsStarredPaths, writeDocsStarredPaths } from "@/lib/offline/docs/docs-stars-store";
import * as docsCollabPersistence from "@/text-editor-core/docs-collab/docs-collab-persistence";
import * as docsOfflineDownload from "@/lib/offline/docs/docs-offline-download";

const username = "alice";

async function seedCollabRoom(room: string): Promise<void> {
  const ydoc = new Y.Doc();
  ydoc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
  await persistence.whenSynced;
  await persistence.destroy();
  ydoc.destroy();
}

function result(id: number, sourceKey: string, modifiedAt: number): WgwUnifiedSearchResult {
  return {
    id,
    sourceType: "file",
    sourceKey,
    title: sourceKey.split("/").pop() ?? sourceKey,
    extension: "md",
    category: "document",
    size: 100,
    modifiedAt,
  };
}

describe("createHybridDocsDriveOperations online trash", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await docsListingRowsTable(db).clear();
    await docsAvailabilityTable(db).clear();
  });

  it("bootstraps trash, moves via live rename without listing refresh, and clears local caches", async () => {
    const apiPath = "/users/alice/note.md";
    const filters = { pathPrefix: "users/alice" };
    await writeDocsListingToCache(username, filters, {
      results: [result(1, "users/alice/note.md", 100), result(2, "users/alice/other.md", 50)],
      hasMore: false,
    });
    await writeDocsAvailability(username, { id: "users/alice/note.md", location: "" });

    const live = {
      renameItem: vi.fn(async () => ({
        user: { username: "", name: "", role: "user", roots: [] },
        cwd: "/",
        directory: { location: "/", files: [] },
        plugins: [],
      })),
      createFolder: vi.fn(),
      listAllDirectoryEntries: vi.fn(async () => []),
    };
    vi.mocked(createWgwDriveOperations).mockReturnValue(live as never);

    const operations = createHybridDocsDriveOperations(username);
    await operations.renameItem({
      from: apiPath,
      destination: driveUserTrashApiPath(username),
      to: "note.md",
    });

    expect(live.createFolder).toHaveBeenCalledWith(
      { cwd: "/users/alice", name: ".Trash" },
      expect.objectContaining({ refreshState: false }),
    );
    expect(live.renameItem).toHaveBeenCalledWith(
      {
        from: apiPath,
        destination: driveUserTrashApiPath(username),
        to: "note.md",
      },
      expect.objectContaining({ refreshState: false }),
    );
    expect(await listOutboxMutations(username)).toHaveLength(0);
    const cached = await readDocsListingFromCache(username, filters);
    expect(cached?.results.map((row) => row.sourceKey)).toEqual(["users/alice/other.md"]);
    expect(await readDocsAvailability(username, apiPath)).toBeUndefined();
  });

  it("still completes when local trash cleanup fails after a successful live rename", async () => {
    const apiPath = "/users/alice/note.md";
    const filters = { pathPrefix: "users/alice" };
    await writeDocsListingToCache(username, filters, {
      results: [result(1, "users/alice/note.md", 100)],
      hasMore: false,
    });

    const live = {
      renameItem: vi.fn(async () => ({
        user: { username: "", name: "", role: "user", roots: [] },
        cwd: "/",
        directory: { location: "/", files: [] },
        plugins: [],
      })),
      createFolder: vi.fn(),
      listAllDirectoryEntries: vi.fn(async () => []),
    };
    vi.mocked(createWgwDriveOperations).mockReturnValue(live as never);

    const clearSpy = vi
      .spyOn(docsCollabPersistence, "clearDocsCollabOfflinePersistence")
      .mockRejectedValueOnce(new Error("idb blocked"));

    const operations = createHybridDocsDriveOperations(username);
    await expect(
      operations.renameItem({
        from: apiPath,
        destination: driveUserTrashApiPath(username),
        to: "note.md",
      }),
    ).resolves.toBeDefined();

    expect(live.renameItem).toHaveBeenCalledTimes(1);
    expect(await listOutboxMutations(username)).toHaveLength(0);
    clearSpy.mockRestore();
  });
});

describe("createHybridDocsDriveOperations offline trash", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await docsListingRowsTable(db).clear();
    await docsAvailabilityTable(db).clear();
  });

  it("queues trash and removes the file from listing and availability caches", async () => {
    const apiPath = "/users/alice/note.md";
    const filters = { pathPrefix: "users/alice" };
    await writeDocsListingToCache(username, filters, {
      results: [result(1, "users/alice/note.md", 100), result(2, "users/alice/other.md", 50)],
      hasMore: false,
    });
    await writeDocsAvailability(username, { id: "users/alice/note.md", location: "" });

    const operations = createHybridDocsDriveOperations(username);
    await operations.renameItem({
      from: apiPath,
      destination: driveUserTrashApiPath(username),
      to: "note.md",
    });

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("trash");
    expect(JSON.parse(outbox[0]?.payload ?? "{}")).toMatchObject({
      from: apiPath,
      destination: driveUserTrashApiPath(username),
      to: "note.md",
    });

    const cached = await readDocsListingFromCache(username, filters);
    expect(cached?.results.map((row) => row.sourceKey)).toEqual(["users/alice/other.md"]);

    expect(await readDocsAvailability(username, apiPath)).toBeUndefined();
  });

  it("undo via captured snapshot restores listing, availability, and collab persistence", async () => {
    const apiPath = "/users/alice/note.md";
    const filters = { pathPrefix: "users/alice" };
    await writeDocsListingToCache(username, filters, {
      results: [result(1, "users/alice/note.md", 100), result(2, "users/alice/other.md", 50)],
      hasMore: false,
    });
    await writeDocsAvailability(username, { id: "users/alice/note.md", location: "My Drive" });
    await seedCollabRoom("users/alice/note.md");

    const snapshot = await captureOfflineDocsTrashSnapshot(username, apiPath);
    expect(snapshot.availability).toMatchObject({
      id: "users/alice/note.md",
      location: "My Drive",
    });
    expect(snapshot.collabPersistence?.yjsUpdate.length).toBeGreaterThan(0);

    const operations = createHybridDocsDriveOperations(username);
    await operations.renameItem({
      from: apiPath,
      destination: driveUserTrashApiPath(username),
      to: "note.md",
    });

    expect(await listOutboxMutations(username)).toHaveLength(1);
    expect(await readDocsAvailability(username, apiPath)).toBeUndefined();
    expect(await hasDocsCollabOfflinePersistence(apiPath)).toBe(false);

    await undoOfflineDocsTrash(username, snapshot);

    expect(await listOutboxMutations(username)).toHaveLength(0);
    const cached = await readDocsListingFromCache(username, filters);
    expect(cached?.results.map((row) => row.sourceKey)).toEqual([
      "users/alice/note.md",
      "users/alice/other.md",
    ]);
    expect(await readDocsAvailability(username, apiPath)).toMatchObject({
      id: "users/alice/note.md",
      location: "My Drive",
    });
    expect(await hasDocsCollabOfflinePersistence(apiPath)).toBe(true);
  });
});

describe("createHybridDocsDriveOperations offline rename", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await docsListingRowsTable(db).clear();
    await docsAvailabilityTable(db).clear();
  });

  it("queues rename and updates listing and availability caches", async () => {
    const fromPath = "/users/alice/old-name.md";
    const filters = { pathPrefix: "users/alice" };
    await writeDocsListingToCache(username, filters, {
      results: [result(1, "users/alice/old-name.md", 100), result(2, "users/alice/other.md", 50)],
      hasMore: false,
    });
    await writeDocsAvailability(username, { id: "users/alice/old-name.md", location: "My Drive" });

    const operations = createHybridDocsDriveOperations(username);
    await operations.renameItem({
      from: fromPath,
      destination: "/users/alice",
      to: "new-name.md",
    });

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("rename");
    expect(JSON.parse(outbox[0]?.payload ?? "{}")).toMatchObject({
      from: fromPath,
      destination: "/users/alice",
      to: "new-name.md",
    });

    const cached = await readDocsListingFromCache(username, filters);
    expect(cached?.results.map((row) => row.sourceKey)).toEqual([
      "users/alice/new-name.md",
      "users/alice/other.md",
    ]);
    expect(cached?.results.find((row) => row.sourceKey === "users/alice/new-name.md")?.title).toBe(
      "new-name.md",
    );

    expect(await readDocsAvailability(username, fromPath)).toBeUndefined();
    expect(await readDocsAvailability(username, "/users/alice/new-name.md")).toMatchObject({
      id: "users/alice/new-name.md",
      location: "My Drive",
    });
  });
});

describe("createHybridDocsDriveOperations offline star and download", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await docsListingRowsTable(db).clear();
    await docsAvailabilityTable(db).clear();
    await db.meta.clear();
  });

  it("reads starred paths from cache and queues star toggles while offline", async () => {
    await writeDocsStarredPaths(username, ["/users/alice/A.md"]);
    const operations = createHybridDocsDriveOperations(username);

    await expect(operations.listStars()).resolves.toEqual(["/users/alice/A.md"]);

    await operations.setStar({ path: "/users/alice/B.md", starred: true });
    await operations.setStar({ path: "/users/alice/A.md", starred: false });

    expect(await readDocsStarredPaths(username)).toEqual(["/users/alice/B.md"]);

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(2);
    expect(outbox.map((row) => JSON.parse(row.payload ?? "{}"))).toEqual(
      expect.arrayContaining([
        { op: "star", path: "/users/alice/B.md", starred: true },
        { op: "star", path: "/users/alice/A.md", starred: false },
      ]),
    );
  });

  it("delegates offline download to the offline download helper", async () => {
    const apiPath = "/users/alice/note.md";
    const downloadSpy = vi
      .spyOn(docsOfflineDownload, "downloadOfflineDocsFile")
      .mockResolvedValue(undefined);

    const operations = createHybridDocsDriveOperations(username);
    await operations.downloadFile(apiPath);

    expect(downloadSpy).toHaveBeenCalledWith(username, apiPath);
    downloadSpy.mockRestore();
  });

  it("rejects readFileBlob when no offline copy exists", async () => {
    const operations = createHybridDocsDriveOperations(username);
    await expect(operations.readFileBlob("/users/alice/missing.md")).rejects.toThrow(
      "This file is not available offline.",
    );
  });
});
