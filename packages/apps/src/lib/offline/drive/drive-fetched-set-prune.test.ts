/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { fullDriveMyRights } from "@/lib/api/mock/drive-bootstrap";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  readDocsAvailability,
  writeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import "@/lib/offline/docs/docs-schema";
import {
  readDirectoryEntriesFromCache,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import {
  applyFetchedDirectorySnapshot,
  listKeptUnsavedDocumentPaths,
} from "@/lib/offline/drive/drive-fetched-set-prune";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
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
    await db.table("docs_availability").clear();
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

  it("drops the pin and the collab database when the pruned document has no local work", async () => {
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

  it("does not prune when the listing paths are not children of the requested folder", async () => {
    await upsertDriveEntry(username, entry("/users/alice/local.md"));

    const result = await applyFetchedDirectorySnapshot(username, "/users/alice", [
      entry("/users/bob/shared.md"),
    ]);

    expect(result.removedPaths).toEqual([]);
    const paths = (await readDirectoryEntriesFromCache(username, "/users/alice")).map(
      (row) => row.path,
    );
    expect(paths).toEqual(["/users/alice/local.md"]);
  });
});
