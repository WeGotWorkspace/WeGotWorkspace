/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import {
  readCachedDriveNodeId,
  upsertDriveEntry,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { createHybridDocsDriveOperations } from "@/lib/offline/docs/docs-hybrid-operations";
import { rememberOfflineDriveUsername } from "@/lib/offline/offline-session";
import { noteCollabRoomKey } from "@/lib/offline/notes/notes-collab-rooms";
import "@/lib/offline/drive/drive-schema";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";
import { buildDocsCollabUrlsForPath } from "@/lib/offline/docs/docs-pin-hydrate";
import { persistCollabSave } from "./docs-collab-save-attempt";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";
import {
  docsCollabIndexedDbKey,
  docsCollabPathKeyedSources,
  docsCollabRoomKey,
  migrateCollabPersistence,
  migrateDocsCollabPendingSaveFromLegacy,
  resolveDocsCollabDatabase,
} from "./docs-collab-persistence";

const saveDocument = vi.hoisted(() => vi.fn(async () => "etag-1"));
const liveRenameItem = vi.hoisted(() =>
  vi.fn(async () => ({
    user: { username: "ada", name: "Ada", role: "user" as const, roots: [] },
    cwd: "/",
    directory: { location: "/", files: [] },
  })),
);

vi.mock("./docs-collab-server-io", () => ({
  saveDocument,
  loadYjsSnapshot: vi.fn(),
}));

vi.mock("@/lib/api/wgw/drive", () => ({
  createWgwDriveOperations: vi.fn(() => ({
    renameItem: liveRenameItem,
    createFolder: vi.fn(),
    listAllDirectoryEntries: vi.fn(async () => []),
  })),
}));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/core/browser-online")>();
  return { ...actual, readBrowserOnline: () => true };
});

const username = "ada";

function entry(path: string, nodeId: string): WgwDriveDirectoryEntry {
  return {
    type: "file",
    path,
    name: path.split("/").pop() ?? path,
    size: 1,
    time: 1,
    permissions: 0,
    nodeId,
    myRights: {
      mayView: true,
      mayComment: false,
      mayReview: false,
      mayEditContent: true,
      mayManageStructure: true,
      mayShare: false,
    },
  };
}

async function seedPathDatabase(room: string, markdown: string, pending: boolean): Promise<void> {
  const ydoc = new Y.Doc();
  applyContentSeedToYDoc(ydoc, markdown, "markdown");
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room, "v2"), ydoc);
  await persistence.whenSynced;
  if (pending) await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  ydoc.destroy();
}

async function openResolved(apiPath: string): Promise<{
  ydoc: Y.Doc;
  persistence: IndexeddbPersistence;
  name: string;
}> {
  const choice = await resolveDocsCollabDatabase(apiPath);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(choice.name, ydoc);
  await persistence.whenSynced;
  await migrateDocsCollabPendingSaveFromLegacy(
    choice.room,
    persistence,
    choice.nodeId ? docsCollabPathKeyedSources(choice.room) : undefined,
  );
  return { ydoc, persistence, name: choice.name };
}

async function closeOpened(opened: {
  ydoc: Y.Doc;
  persistence: IndexeddbPersistence;
}): Promise<void> {
  await opened.persistence.destroy();
  opened.ydoc.destroy();
}

/** y-indexeddb's clearData starts deleteDatabase and does not await it. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const host = globalThis as { setImmediate?: (fn: () => void) => void };
    if (typeof host.setImmediate === "function") host.setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

async function renameThroughDocs(from: string, destination: string, to: string): Promise<void> {
  const operations = createHybridDocsDriveOperations(username);
  await operations.renameItem({ from, destination, to });
}

async function databaseNamesAfterDeletes(): Promise<string[]> {
  for (let attempt = 0; attempt < 40; attempt += 1) await nextTask();
  return (await indexedDB.databases()).flatMap((row) => (row.name ? [row.name] : []));
}

describe("docs collab identity database", () => {
  beforeEach(() => {
    saveDocument.mockClear();
    liveRenameItem.mockClear();
    rememberOfflineDriveUsername(username);
  });

  it("lands an offline edit on the renamed path without migrateCollabPersistence", async () => {
    const migrate = vi.spyOn(await import("./docs-collab-persistence"), "migrateCollabPersistence");
    const oldPath = "/users/ada/old-name.md";
    const newPath = "/users/ada/new-name.md";
    await upsertDriveEntry(username, entry(oldPath, "fn-rename"));
    await seedPathDatabase(docsCollabRoomKey(oldPath), "unsaved rename", true);
    const drafted = await openResolved(oldPath);
    await closeOpened(drafted);
    await renameThroughDocs(oldPath, "/users/ada", "new-name.md");

    expect(await readCachedDriveNodeId(username, "users/ada/new-name.md")).toBe("fn-rename");
    expect(await readCachedDriveNodeId(username, oldPath)).toBeUndefined();

    const opened = await openResolved(newPath);
    try {
      expect(opened.name).toBe("fn-rename:v3");
      expect(migrate).not.toHaveBeenCalled();
      expect(readContentFromYDoc(opened.ydoc, "markdown")).toContain("unsaved rename");
      await expect(opened.persistence.get(PENDING_SERVER_SAVE_KEY)).resolves.toBeTruthy();

      const urls = buildDocsCollabUrlsForPath(docsCollabRoomKey(newPath));
      await persistCollabSave({
        urls: { ...urls, signalUrl: "ws://localhost/unused" },
        room: urls.room,
        ydoc: opened.ydoc,
        markdown: readContentFromYDoc(opened.ydoc, "markdown"),
        remergeAttempted: { current: false },
        markdownAfterMerge: () => readContentFromYDoc(opened.ydoc, "markdown"),
      });
      expect(saveDocument).toHaveBeenCalledWith(
        expect.stringContaining("users%2Fada%2Fnew-name.md"),
        expect.stringContaining("unsaved rename"),
        opened.ydoc,
        undefined,
        null,
      );
    } finally {
      migrate.mockRestore();
      await closeOpened(opened);
    }
  });

  it("lands an offline edit after a move to another folder", async () => {
    const oldPath = "/users/ada/folder/note.md";
    const newPath = "/users/ada/archive/note.md";
    await upsertDriveEntry(username, entry(oldPath, "fn-move"));
    await seedPathDatabase(docsCollabRoomKey(oldPath), "unsaved move", true);
    const drafted = await openResolved(oldPath);
    await closeOpened(drafted);
    await renameThroughDocs(oldPath, "/users/ada/archive", "note.md");

    expect(await readCachedDriveNodeId(username, "users/ada/archive/note.md")).toBe("fn-move");

    const opened = await openResolved(newPath);
    try {
      expect(opened.name).toBe("fn-move:v3");
      expect(readContentFromYDoc(opened.ydoc, "markdown")).toContain("unsaved move");
      const urls = buildDocsCollabUrlsForPath(docsCollabRoomKey(newPath));
      expect(urls.documentUrl).toContain("users%2Fada%2Farchive%2Fnote.md");
    } finally {
      await closeOpened(opened);
    }
  });

  it("takes a path-keyed v2 database over once", async () => {
    const path = "/users/ada/once.md";
    await upsertDriveEntry(username, entry(path, "fn-once"));
    await seedPathDatabase(docsCollabRoomKey(path), "first body", true);

    const first = await openResolved(path);
    const firstBody = readContentFromYDoc(first.ydoc, "markdown");
    await closeOpened(first);

    const names = await databaseNamesAfterDeletes();
    expect(names).not.toContain(docsCollabIndexedDbKey(docsCollabRoomKey(path), "v2"));

    const second = await openResolved(path);
    try {
      expect(second.name).toBe("fn-once:v3");
      expect(readContentFromYDoc(second.ydoc, "markdown")).toBe(firstBody);
    } finally {
      await closeOpened(second);
    }
  });

  it("leaves a v2 database in place when its unsaved body cannot be merged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const path = "/users/ada/conflict.md";
    const room = docsCollabRoomKey(path);
    await upsertDriveEntry(username, entry(path, "fn-conflict"));

    const v3 = new Y.Doc();
    applyContentSeedToYDoc(v3, "identity body", "markdown");
    const v3Persistence = new IndexeddbPersistence(docsCollabIndexedDbKey("fn-conflict", "v3"), v3);
    await v3Persistence.whenSynced;
    await v3Persistence.destroy();
    v3.destroy();

    await seedPathDatabase(room, "unsynced path body", true);

    const opened = await openResolved(path);
    try {
      expect(readContentFromYDoc(opened.ydoc, "markdown")).toContain("identity body");
      expect(readContentFromYDoc(opened.ydoc, "markdown")).not.toContain("unsynced path body");
    } finally {
      await closeOpened(opened);
    }

    const kept = new Y.Doc();
    const keptPersistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room, "v2"), kept);
    await keptPersistence.whenSynced;
    expect(readContentFromYDoc(kept, "markdown")).toContain("unsynced path body");
    await expect(keptPersistence.get(PENDING_SERVER_SAVE_KEY)).resolves.toBeTruthy();
    await keptPersistence.destroy();
    kept.destroy();
    warn.mockRestore();
  });

  it("keeps the Notes database name on v2", () => {
    const room = noteCollabRoomKey("note-uid-unchanged");
    expect(room).toBe("note-uid-unchanged");
    expect(docsCollabIndexedDbKey(room)).toBe("note-uid-unchanged:v2");
    expect(docsCollabIndexedDbKey(room, "v2")).toBe("note-uid-unchanged:v2");
    expect(migrateCollabPersistence).toBeTypeOf("function");
  });

  it("falls back to the path key when the id is unknown and stays editable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const path = "/users/ada/unknown.md";
    const choice = await resolveDocsCollabDatabase(path);
    expect(choice.nodeId).toBeUndefined();
    expect(choice.name).toBe(docsCollabIndexedDbKey(docsCollabRoomKey(path), "v2"));
    expect(warn).toHaveBeenCalled();

    const ydoc = new Y.Doc();
    const persistence = new IndexeddbPersistence(choice.name, ydoc);
    try {
      await persistence.whenSynced;
      applyContentSeedToYDoc(ydoc, "still editable", "markdown");
      expect(readContentFromYDoc(ydoc, "markdown")).toContain("still editable");
    } finally {
      await persistence.destroy();
      ydoc.destroy();
      warn.mockRestore();
    }
  });
});
