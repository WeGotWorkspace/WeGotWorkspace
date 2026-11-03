import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import {
  ingestRemoteNote,
  ingestRemoteNoteDestroyed,
  ingestRemoteNotebook,
  ingestRemoteNotebookDestroyed,
  reconcileNotesSnapshot,
} from "@/lib/offline/notes-jmap-inbound";

const listPending = vi.fn<() => Promise<string[]>>();
const listOutboxIds = vi.fn<() => Promise<Set<string>>>();
const listPendingFields = vi.fn<() => Promise<Map<string, Set<string>>>>();
const listPendingBases = vi.fn<() => Promise<Map<string, string[]>>>();
const getCachedNote = vi.fn<(username: string, noteId: string) => Promise<Note | null>>();
const upsert = vi.fn();
const remove = vi.fn();
const upsertNotebook = vi.fn();
const removeNotebook = vi.fn();
const readCache = vi.fn<
  () => Promise<{
    data: { notes: Note[]; notebookCollections?: { id: string; name: string }[] };
  } | null>
>();
const reportConflicts = vi.fn();

vi.mock("@/lib/offline/notes-offline-store", () => ({
  listPendingNoteIds: () => listPending(),
  listOutboxNoteIds: () => listOutboxIds(),
  listPendingNoteFields: () => listPendingFields(),
  listPendingNoteBases: () => listPendingBases(),
  getNoteFromCache: (username: string, noteId: string) => getCachedNote(username, noteId),
  upsertNoteInCache: (...args: unknown[]) => upsert(...args),
  removeNoteFromCache: (...args: unknown[]) => remove(...args),
  upsertNotebookInCache: (...args: unknown[]) => upsertNotebook(...args),
  removeNotebookFromCache: (...args: unknown[]) => removeNotebook(...args),
  readNotesBootstrapFromCache: () => readCache(),
}));

vi.mock("@/lib/offline/notes-sync-conflicts", () => ({
  reportNotesSyncConflicts: (...args: unknown[]) => reportConflicts(...args),
}));

const remote: Note = {
  id: "n-1",
  category: "Note",
  date: "2026-01-01T00:00:00.000Z",
  excerpt: "Remote",
  body: ["Remote"],
  notebook: "General",
  notebookId: "notes-general",
  tags: [],
  wordCount: 1,
};

describe("notes-jmap-inbound", () => {
  beforeEach(() => {
    listPending.mockReset();
    listOutboxIds.mockReset();
    listPendingFields.mockReset();
    listPendingBases.mockReset();
    getCachedNote.mockReset();
    upsert.mockReset();
    remove.mockReset();
    upsertNotebook.mockReset();
    removeNotebook.mockReset();
    readCache.mockReset();
    reportConflicts.mockReset();
    listPending.mockResolvedValue([]);
    listOutboxIds.mockResolvedValue(new Set());
    listPendingFields.mockResolvedValue(new Map());
    listPendingBases.mockResolvedValue(new Map());
    getCachedNote.mockResolvedValue(null);
    readCache.mockResolvedValue({ data: { notes: [] } });
  });

  it("upserts a remote note into Dexie when the id is not pending", async () => {
    await expect(ingestRemoteNote("ada", remote)).resolves.toBe("upserted");
    expect(upsert).toHaveBeenCalledWith("ada", remote, false);
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("merges an inbound tag change when the queued write is an archive", async () => {
    listPendingFields.mockResolvedValue(new Map([["n-1", new Set(["archived"])]]));
    getCachedNote.mockResolvedValue({ ...remote, tags: [], archived: true });
    const inbound: Note = { ...remote, tags: ["focus"], archived: true };

    await expect(ingestRemoteNote("ada", inbound)).resolves.toBe("merged-pending");

    expect(upsert).toHaveBeenCalledWith(
      "ada",
      expect.objectContaining({ tags: ["focus"], archived: true }),
      true,
    );
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("reports a conflict when someone else changed a queued field since it was queued", async () => {
    listPendingFields.mockResolvedValue(new Map([["n-1", new Set(["archived"])]]));
    listPendingBases.mockResolvedValue(new Map([["n-1", ['"v1"']]]));
    getCachedNote.mockResolvedValue({ ...remote, archived: true, etag: '"v1"' });
    const inbound: Note = { ...remote, archived: false, etag: '"v2"' };

    await expect(ingestRemoteNote("ada", inbound)).resolves.toBe("merged-pending");

    expect(upsert).toHaveBeenCalledWith("ada", expect.objectContaining({ archived: true }), true);
    expect(reportConflicts).toHaveBeenCalledWith(["n-1"]);
  });

  it("does not report a conflict for a queued change the server has not seen yet", async () => {
    // Another tab archived offline; this tab syncs before that archive is sent.
    listPendingFields.mockResolvedValue(new Map([["n-1", new Set(["archived"])]]));
    listPendingBases.mockResolvedValue(new Map([["n-1", ['"v1"']]]));
    getCachedNote.mockResolvedValue({ ...remote, archived: true, etag: '"v1"' });
    const inbound: Note = { ...remote, archived: false, etag: '"v1"' };

    await expect(ingestRemoteNote("ada", inbound)).resolves.toBe("merged-pending");

    expect(upsert).toHaveBeenCalledWith("ada", expect.objectContaining({ archived: true }), true);
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("does not report a conflict when the inbound value equals the queued local value", async () => {
    listPendingFields.mockResolvedValue(new Map([["n-1", new Set(["title"])]]));
    getCachedNote.mockResolvedValue({ ...remote, title: "Hello" });
    const inbound: Note = { ...remote, title: "Hello", tags: ["from-server"] };

    await expect(ingestRemoteNote("ada", inbound)).resolves.toBe("merged-pending");

    expect(upsert).toHaveBeenCalledWith(
      "ada",
      expect.objectContaining({ title: "Hello", tags: ["from-server"] }),
      true,
    );
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("removes a remotely destroyed note that is not pending", async () => {
    await expect(ingestRemoteNoteDestroyed("ada", "n-1")).resolves.toBe("removed");
    expect(remove).toHaveBeenCalledWith("ada", "n-1");
  });

  it("does not remove a pending local row on remote destroy", async () => {
    listOutboxIds.mockResolvedValue(new Set(["n-1"]));
    await expect(ingestRemoteNoteDestroyed("ada", "n-1")).resolves.toBe("skipped-pending");
    expect(remove).not.toHaveBeenCalled();
    expect(reportConflicts).toHaveBeenCalledWith(["n-1"]);
  });

  it("upserts a remote notebook into Dexie", async () => {
    await expect(
      ingestRemoteNotebook("ada", { id: "notes-general", name: "General" }),
    ).resolves.toBe("upserted");
    expect(upsertNotebook).toHaveBeenCalledWith("ada", { id: "notes-general", name: "General" });
  });

  it("drops a destroyed notebook and its cached notes except pending ids", async () => {
    listPending.mockResolvedValue(["n-pending"]);
    readCache.mockResolvedValue({
      data: {
        notes: [
          { ...remote, id: "n-gone" },
          { ...remote, id: "n-pending" },
        ],
      },
    });
    await expect(ingestRemoteNotebookDestroyed("ada", "notes-general")).resolves.toBe("removed");
    expect(remove).toHaveBeenCalledWith("ada", "n-gone");
    expect(remove).not.toHaveBeenCalledWith("ada", "n-pending");
    expect(reportConflicts).toHaveBeenCalledWith(["n-pending"]);
    expect(removeNotebook).toHaveBeenCalledWith("ada", "notes-general");
  });

  it("reconcileNotesSnapshot drops local rows missing from the remote list", async () => {
    readCache.mockResolvedValue({
      data: {
        notes: [remote, { ...remote, id: "n-stale", notebookId: "notes-gone" }],
        notebookCollections: [
          { id: "notes-general", name: "General" },
          { id: "notes-gone", name: "Gone" },
        ],
      },
    });
    await reconcileNotesSnapshot("ada", [remote], [{ id: "notes-general", name: "General" }]);
    expect(upsertNotebook).toHaveBeenCalledWith("ada", { id: "notes-general", name: "General" });
    expect(upsert).toHaveBeenCalledWith("ada", remote, false);
    expect(remove).toHaveBeenCalledWith("ada", "n-stale");
    expect(removeNotebook).toHaveBeenCalledWith("ada", "notes-gone");
  });
});
