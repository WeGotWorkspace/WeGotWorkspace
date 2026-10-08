/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { applyTheirsNotesReconnect } from "@/notes-core/src/notes-reconnect-actions";
import {
  hasNoteCollabPendingServerSave,
  noteCollabRoomKey,
  readNoteCollabOfflineContent,
  writeNoteCollabOfflineContent,
} from "@/lib/offline/notes/notes-collab-rooms";
import {
  applyContentSeedToYDoc,
  readContentFromYDoc,
} from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import {
  docsCollabIndexedDbKey,
  migrateDocsCollabPendingSaveFromLegacy,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { isYDocEmpty } from "@/text-editor-core/docs-collab/docs-collab-utils";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/use-docs-collab-save";

const getNote = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/wgw/notes-vjournal", () => ({
  getNote: (...args: unknown[]) => getNote(...args),
}));

async function seedMarkdown(indexedDbName: string, markdown: string): Promise<void> {
  const ydoc = new Y.Doc();
  applyContentSeedToYDoc(ydoc, markdown, "markdown");
  const persistence = new IndexeddbPersistence(indexedDbName, ydoc);
  await persistence.whenSynced;
  await persistence.destroy();
  ydoc.destroy();
}

async function seedPendingFlag(indexedDbName: string): Promise<void> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(indexedDbName, ydoc);
  await persistence.whenSynced;
  await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  ydoc.destroy();
}

async function readRoomMarkdown(indexedDbName: string): Promise<string | null> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(indexedDbName, ydoc);
  try {
    await persistence.whenSynced;
    if (isYDocEmpty(ydoc)) return null;
    return readContentFromYDoc(ydoc, "markdown");
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

async function roomIsEmpty(indexedDbName: string): Promise<boolean> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(indexedDbName, ydoc);
  try {
    await persistence.whenSynced;
    return isYDocEmpty(ydoc);
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

describe("note collab rooms use the v2 IndexedDB name", () => {
  beforeEach(() => {
    getNote.mockReset();
  });

  it("reads a body that exists only in the v2 database", async () => {
    const uid = "note-v2-only";
    const room = noteCollabRoomKey(uid);
    await seedMarkdown(docsCollabIndexedDbKey(room), "Typed in v2");

    await expect(readNoteCollabOfflineContent(uid)).resolves.toContain("Typed in v2");
  });

  it("falls back to a body that exists only in the legacy database", async () => {
    const uid = "note-legacy-only";
    const room = noteCollabRoomKey(uid);
    await seedMarkdown(room, "Legacy fallback body");

    await expect(readNoteCollabOfflineContent(uid)).resolves.toContain("Legacy fallback body");
  });

  it("sees a pending server save stored only in the v2 database", async () => {
    const uid = "note-pending-v2";
    const room = noteCollabRoomKey(uid);
    await seedPendingFlag(docsCollabIndexedDbKey(room));

    await expect(hasNoteCollabPendingServerSave(uid)).resolves.toBe(true);
  });

  it("writes the server markdown into v2 and clears every legacy database", async () => {
    const uid = "note-write-replace";
    const room = noteCollabRoomKey(uid);
    const serverMarkdown = "Server markdown";
    await seedMarkdown(docsCollabIndexedDbKey(room), "mine");
    await seedMarkdown(room, "old");

    await writeNoteCollabOfflineContent(uid, serverMarkdown);

    const stored = await readRoomMarkdown(docsCollabIndexedDbKey(room));
    expect(stored).toContain(serverMarkdown);
    expect(stored).not.toContain("mine");
    expect(stored).not.toContain("old");
    await expect(readNoteCollabOfflineContent(uid)).resolves.toContain(serverMarkdown);
    expect(await roomIsEmpty(room)).toBe(true);
  });

  it("stores the server body from Use theirs in the v2 room", async () => {
    const uid = "note-use-theirs";
    const room = noteCollabRoomKey(uid);
    await seedMarkdown(docsCollabIndexedDbKey(room), "mine");
    await seedPendingFlag(docsCollabIndexedDbKey(room));
    await seedMarkdown(room, "old");
    getNote.mockResolvedValue({
      id: uid,
      notebookId: "nb-1",
      title: "Draft",
      body: "Server body",
      categories: [],
      status: null,
      etag: '"fresh"',
    });

    const applied = await applyTheirsNotesReconnect({
      noteId: uid,
      applyServerBody: () => undefined,
    });

    expect(applied).toBe("Server body");
    expect(getNote).toHaveBeenCalledWith(uid);
    const stored = await readRoomMarkdown(docsCollabIndexedDbKey(room));
    expect(stored).toContain("Server body");
    expect(stored).not.toContain("mine");
    await expect(hasNoteCollabPendingServerSave(uid)).resolves.toBe(false);
    expect(await roomIsEmpty(room)).toBe(true);
  });

  it("drops a legacy pending flag after migrate and a v2 save", async () => {
    const uid = "note-legacy-pending-cleared";
    const room = noteCollabRoomKey(uid);
    await seedMarkdown(docsCollabIndexedDbKey(room), "v2 body");
    await seedPendingFlag(room);

    const ydoc = new Y.Doc();
    const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
    try {
      await persistence.whenSynced;
      await migrateDocsCollabPendingSaveFromLegacy(room, persistence);
      await persistence.del(PENDING_SERVER_SAVE_KEY);
    } finally {
      await persistence.destroy();
      ydoc.destroy();
    }

    await expect(hasNoteCollabPendingServerSave(uid)).resolves.toBe(false);
  });

  it("does not create a missing legacy database while checking the pending flag", async () => {
    const uid = "note-missing-legacy";
    const room = noteCollabRoomKey(uid);

    await expect(hasNoteCollabPendingServerSave(uid)).resolves.toBe(false);

    const names = new Set(
      (await indexedDB.databases()).flatMap((row) => (row.name ? [row.name] : [])),
    );
    expect(names.has(room)).toBe(false);
    expect(names.has(`/${room}`)).toBe(false);
  });

  it("reads a pending flag that already exists in the unsuffixed legacy database", async () => {
    const uid = "note-legacy-pending-exists";
    const room = noteCollabRoomKey(uid);
    await seedPendingFlag(room);

    await expect(hasNoteCollabPendingServerSave(uid)).resolves.toBe(true);

    const names = new Set(
      (await indexedDB.databases()).flatMap((row) => (row.name ? [row.name] : [])),
    );
    expect(names.has(`/${room}`)).toBe(false);
  });

  it("falls back to opening the database when indexedDB.databases rejects", async () => {
    const uid = "note-databases-api-rejects";
    const room = noteCollabRoomKey(uid);
    await seedPendingFlag(room);
    const databases = indexedDB.databases;
    Object.defineProperty(indexedDB, "databases", {
      configurable: true,
      value: () => Promise.reject(new Error("databases unavailable")),
    });
    try {
      await expect(hasNoteCollabPendingServerSave(uid)).resolves.toBe(true);
    } finally {
      Object.defineProperty(indexedDB, "databases", { configurable: true, value: databases });
    }
  });

  it("opens the legacy database when indexedDB.databases is unavailable", async () => {
    const uid = "note-databases-api-missing";
    const room = noteCollabRoomKey(uid);
    await seedPendingFlag(room);
    const databases = indexedDB.databases;
    Object.defineProperty(indexedDB, "databases", { configurable: true, value: undefined });
    try {
      await expect(hasNoteCollabPendingServerSave(uid)).resolves.toBe(true);
    } finally {
      Object.defineProperty(indexedDB, "databases", { configurable: true, value: databases });
    }
  });
});
