/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import {
  readDriveAvailability,
  writeDriveAvailability,
} from "@/lib/offline/drive/drive-availability-store";
import { writeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import {
  readDirectoryEntriesFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import {
  applyFetchedDirectorySnapshot,
  listKeptUnsavedDocumentPaths,
} from "@/lib/offline/drive/drive-fetched-set-prune";
import {
  DRIVE_DOMAIN,
  driveAvailabilityTable,
  driveContentBlobsTable,
  driveEntriesTable,
} from "@/lib/offline/drive/drive-schema";
import {
  docsCollabIndexedDbKey,
  docsCollabRoomKey,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/pending-server-save-key";

const username = "alice";

function entry(path: string, type: "file" | "dir" = "file"): WgwDriveDirectoryEntry {
  const name = path.split("/").pop() ?? path;
  return {
    type,
    path,
    name,
    size: type === "dir" ? 0 : 12,
    time: 1,
    permissions: 0,
    myRights: fullDriveMyRights,
  };
}

async function seedPendingSave(apiPath: string): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
  await persistence.whenSynced;
  await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  ydoc.destroy();
}

async function databaseNames(): Promise<string[]> {
  const rows = await indexedDB.databases();
  return rows.flatMap((row) => (row.name ? [row.name] : []));
}

describe("applyFetchedDirectorySnapshot", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await driveEntriesTable(db).clear();
    await driveContentBlobsTable(db).clear();
    await driveAvailabilityTable(db).clear();
    await db.table("docs_availability").clear();
    await db.outbox.clear();
    await db.meta.clear();
  });

  it("removes a remotely deleted file from the offline listing after a successful refresh", async () => {
    await upsertDriveEntry(username, entry("/users/alice/gone.md"));
    await upsertDriveEntry(username, entry("/users/alice/keep.md"));

    await applyFetchedDirectorySnapshot(username, "/users/alice", [entry("/users/alice/keep.md")]);

    const paths = (await readDirectoryEntriesFromCache(username, "/users/alice")).map(
      (row) => row.path,
    );
    expect(paths).toEqual(["/users/alice/keep.md"]);
  });

  it("drops the pin and the collab database when delete is not blocked and the document has no local work", async () => {
    const path = "/users/alice/draft.md";
    await upsertDriveEntry(username, entry(path));
    await writeDocsAvailability(username, { id: path, location: "My Drive" });
    await seedPendingSave(path);
    const room = docsCollabRoomKey(path);
    const ydoc = new Y.Doc();
    const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
    await persistence.whenSynced;
    await persistence.del(PENDING_SERVER_SAVE_KEY);
    await persistence.destroy();
    ydoc.destroy();

    await applyFetchedDirectorySnapshot(username, "/users/alice", []);

    await expect(readDocsAvailability(username, path)).resolves.toBeUndefined();
    expect(await databaseNames()).not.toContain(docsCollabIndexedDbKey(room));
    expect(await readDirectoryEntriesFromCache(username, "/users/alice")).toEqual([]);
  });

  it("keeps the database and surfaces a pruned document that still has unsaved work", async () => {
    const path = "/users/alice/unsaved.md";
    await upsertDriveEntry(username, entry(path));
    await writeDocsAvailability(username, { id: path, location: "My Drive" });
    await seedPendingSave(path);

    const result = await applyFetchedDirectorySnapshot(username, "/users/alice", []);

    expect(result.keptUnsavedPaths).toEqual(["users/alice/unsaved.md"]);
    expect(await readDirectoryEntriesFromCache(username, "/users/alice")).toHaveLength(1);
    await expect(readDocsAvailability(username, path)).resolves.toMatchObject({
      id: "users/alice/unsaved.md",
    });
    const room = docsCollabRoomKey(path);
    const ydoc = new Y.Doc();
    const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
    await persistence.whenSynced;
    await expect(persistence.get(PENDING_SERVER_SAVE_KEY)).resolves.toBeTruthy();
    await persistence.destroy();
    ydoc.destroy();
    await expect(listKeptUnsavedDocumentPaths(username)).resolves.toEqual([
      "users/alice/unsaved.md",
    ]);
    expect(await databaseNames()).toContain(docsCollabIndexedDbKey(room));
  });

  it("does not prune the requested folder when a listing entry belongs elsewhere, and still stores that entry", async () => {
    await upsertDriveEntry(username, entry("/users/alice/local.md"));

    const result = await applyFetchedDirectorySnapshot(username, "/users/alice", [
      entry("/users/bob/shared.md"),
    ]);

    expect(result.removedPaths).toEqual([]);
    const alice = (await readDirectoryEntriesFromCache(username, "/users/alice")).map(
      (row) => row.path,
    );
    expect(alice).toEqual(["/users/alice/local.md"]);
    const bob = (await readDirectoryEntriesFromCache(username, "/users/bob")).map(
      (row) => row.path,
    );
    expect(bob).toEqual(["/users/bob/shared.md"]);
  });

  it("drops the content blob and drive availability pin for a non-Docs file", async () => {
    const removed = "/users/alice/photo.png";
    const kept = "/users/alice/keep.png";
    await upsertDriveEntry(username, entry(removed));
    await upsertDriveEntry(username, entry(kept));
    await writeDriveContentBlob(username, removed, new Blob(["png"]), 1);
    await writeDriveContentBlob(username, kept, new Blob(["keep"]), 1);

    await applyFetchedDirectorySnapshot(username, "/users/alice", [entry(kept)]);

    await expect(readDriveAvailability(username, removed)).resolves.toBeUndefined();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await expect(driveContentBlobsTable(db).get("users/alice/photo.png")).resolves.toBeUndefined();
    await expect(driveContentBlobsTable(db).get("users/alice/keep.png")).resolves.toBeDefined();
  });

  it("removes nested rows when a directory is pruned", async () => {
    await upsertDriveEntry(username, entry("/users/alice/nested", "dir"));
    await upsertDriveEntry(username, entry("/users/alice/nested/child.md"));
    await writeDocsAvailability(username, {
      id: "/users/alice/nested/child.md",
      location: "My Drive",
    });

    const result = await applyFetchedDirectorySnapshot(username, "/users/alice", []);

    expect(result.removedPaths).toEqual(
      expect.arrayContaining(["users/alice/nested/child.md", "users/alice/nested"]),
    );
    await expect(readDirectoryEntriesFromCache(username, "/users/alice/nested")).resolves.toEqual(
      [],
    );
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await expect(driveEntriesTable(db).get("users/alice/nested")).resolves.toBeUndefined();
    await expect(
      readDocsAvailability(username, "/users/alice/nested/child.md"),
    ).resolves.toBeUndefined();
  });

  it("keeps an unsaved nested document when its directory is pruned", async () => {
    const child = "/users/alice/nested/stay.md";
    await upsertDriveEntry(username, entry("/users/alice/nested", "dir"));
    await upsertDriveEntry(username, entry(child));
    await writeDocsAvailability(username, { id: child, location: "My Drive" });
    await seedPendingSave(child);

    const result = await applyFetchedDirectorySnapshot(username, "/users/alice", []);

    expect(result.keptUnsavedPaths).toEqual(["users/alice/nested/stay.md"]);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await expect(driveEntriesTable(db).get("users/alice/nested")).resolves.toBeUndefined();
    await expect(driveEntriesTable(db).get("users/alice/nested/stay.md")).resolves.toBeDefined();
    await expect(readDocsAvailability(username, child)).resolves.toMatchObject({
      id: "users/alice/nested/stay.md",
    });
  });

  it("keeps a renamed cached row while its outbox mutation is still open", async () => {
    await upsertDriveEntry(username, entry("/users/alice/new.md"));
    await enqueueOutboxMutation(username, {
      id: "rename-1",
      domain: DRIVE_DOMAIN,
      op: "rename",
      payload: JSON.stringify({
        op: "rename",
        from: "/users/alice/old.md",
        destination: "/users/alice",
        to: "new.md",
      }),
    });

    const result = await applyFetchedDirectorySnapshot(username, "/users/alice", [
      entry("/users/alice/old.md"),
    ]);

    expect(result.removedPaths).not.toContain("users/alice/new.md");
    expect(result.keptUnsavedPaths).toEqual([]);
    const paths = (await readDirectoryEntriesFromCache(username, "/users/alice")).map(
      (row) => row.path,
    );
    expect(paths).toEqual(expect.arrayContaining(["/users/alice/new.md", "/users/alice/old.md"]));
  });

  it("does not cascade-delete descendants of a directory with an open rename", async () => {
    await upsertDriveEntry(username, entry("/users/alice/renamed", "dir"));
    await upsertDriveEntry(username, entry("/users/alice/renamed/child.md"));
    await enqueueOutboxMutation(username, {
      id: "rename-dir",
      domain: DOCS_DOMAIN,
      op: "rename",
      payload: JSON.stringify({
        op: "rename",
        from: "/users/alice/folder",
        destination: "/users/alice",
        to: "renamed",
      }),
    });

    const result = await applyFetchedDirectorySnapshot(username, "/users/alice", []);

    expect(result.removedPaths).toEqual([]);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await expect(driveEntriesTable(db).get("users/alice/renamed")).resolves.toBeDefined();
    await expect(driveEntriesTable(db).get("users/alice/renamed/child.md")).resolves.toBeDefined();
  });

  it("keeps the listing row when deleting the collab database is blocked", async () => {
    const path = "/users/alice/open.md";
    await upsertDriveEntry(username, entry(path));
    await writeDocsAvailability(username, { id: path, location: "My Drive" });
    await writeDriveAvailability(username, { id: path, source: "manual" });
    await seedPendingSave(path);
    const room = docsCollabRoomKey(path);
    const ydoc = new Y.Doc();
    const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
    await persistence.whenSynced;
    await persistence.del(PENDING_SERVER_SAVE_KEY);
    await persistence.destroy();
    ydoc.destroy();

    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onblocked?.call(request, new Event("blocked") as IDBVersionChangeEvent);
      });
      return request;
    });

    try {
      const result = await applyFetchedDirectorySnapshot(username, "/users/alice", []);

      expect(result.removedPaths).not.toContain("users/alice/open.md");
      expect(result.keptUnsavedPaths).not.toContain("users/alice/open.md");
      expect(await readDirectoryEntriesFromCache(username, "/users/alice")).toHaveLength(1);
      await expect(readDocsAvailability(username, path)).resolves.toBeDefined();
      await expect(readDriveAvailability(username, path)).resolves.toBeDefined();
      expect(await databaseNames()).toContain(docsCollabIndexedDbKey(room));
    } finally {
      deleteDatabase.mockRestore();
    }
  });
});
