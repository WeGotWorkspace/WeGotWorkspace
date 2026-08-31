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
const upsert = vi.fn();
const remove = vi.fn();
const upsertNotebook = vi.fn();
const removeNotebook = vi.fn();
const readCache = vi.fn<
  () => Promise<{ data: { notes: Note[]; notebookCollections?: { id: string; name: string }[] } } | null>
>();
const reportConflicts = vi.fn();

vi.mock("@/lib/offline/notes-offline-store", () => ({
  listPendingNoteIds: () => listPending(),
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
    upsert.mockReset();
    remove.mockReset();
    upsertNotebook.mockReset();
    removeNotebook.mockReset();
    readCache.mockReset();
    reportConflicts.mockReset();
    listPending.mockResolvedValue([]);
    readCache.mockResolvedValue({ data: { notes: [] } });
  });

  it("upserts a remote note into Dexie when the id is not pending", async () => {
    await expect(ingestRemoteNote("ada", remote)).resolves.toBe("upserted");
    expect(upsert).toHaveBeenCalledWith("ada", remote, false);
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("skips a pending local row and reports the conflict channel", async () => {
    listPending.mockResolvedValue(["n-1"]);
    await expect(ingestRemoteNote("ada", remote)).resolves.toBe("skipped-pending");
    expect(upsert).not.toHaveBeenCalled();
    expect(reportConflicts).toHaveBeenCalledWith(["n-1"]);
  });

  it("removes a remotely destroyed note that is not pending", async () => {
    await expect(ingestRemoteNoteDestroyed("ada", "n-1")).resolves.toBe("removed");
    expect(remove).toHaveBeenCalledWith("ada", "n-1");
  });

  it("does not remove a pending local row on remote destroy", async () => {
    listPending.mockResolvedValue(["n-1"]);
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
    await reconcileNotesSnapshot(
      "ada",
      [remote],
      [{ id: "notes-general", name: "General" }],
    );
    expect(upsertNotebook).toHaveBeenCalledWith("ada", { id: "notes-general", name: "General" });
    expect(upsert).toHaveBeenCalledWith("ada", remote, false);
    expect(remove).toHaveBeenCalledWith("ada", "n-stale");
    expect(removeNotebook).toHaveBeenCalledWith("ada", "notes-gone");
  });
});
