import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { setDocsCollabSyncState } from "@/text-editor-core/docs-collab/docs-collab-sync-registry";
import { useNotesReconnectConflict } from "@/notes-core/src/use-notes-reconnect-conflict";
import { isNotesLocalDirty } from "@/notes-core/src/notes-reconnect-actions";

const workspaceSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "notes-workspace.tsx"),
  "utf8",
);

const getNote = vi.fn();
const persistNoteMarkdown = vi.fn();
const writeNoteCollabOfflineContent = vi.fn();

vi.mock("@/lib/api/wgw/notes-vjournal", () => ({
  getNote: (...args: unknown[]) => getNote(...args),
  persistNoteMarkdown: (...args: unknown[]) => persistNoteMarkdown(...args),
}));

vi.mock("@/lib/offline/notes/notes-collab-rooms", () => ({
  writeNoteCollabOfflineContent: (...args: unknown[]) => writeNoteCollabOfflineContent(...args),
}));

const note: Note = {
  id: "note-uid-1",
  title: "Draft",
  etag: '"old"',
  category: "Note",
  date: "2026-08-31T10:00:00.000Z",
  excerpt: "Local body",
  body: ["Local body"],
  notebook: "General",
  tags: [],
  wordCount: 2,
};

describe("notes workspace reconnect wiring (Decision 6)", () => {
  it("notes-workspace supplies dirty and both dialog actions", () => {
    expect(workspaceSource).toContain("getLocalDirty");
    expect(workspaceSource).toContain("void keepMine()");
    expect(workspaceSource).toContain("void useTheirs()");
    expect(workspaceSource).toContain("useNotesReconnectConflict");
  });

  beforeEach(() => {
    getNote.mockReset();
    persistNoteMarkdown.mockReset();
    writeNoteCollabOfflineContent.mockReset();
    getNote.mockResolvedValue({ id: note.id, body: "Server body", etag: '"fresh"' });
    persistNoteMarkdown.mockResolvedValue({ id: note.id, etag: '"saved"' });
    writeNoteCollabOfflineContent.mockResolvedValue(undefined);
  });

  it("supplies a live dirty getter from pending Dexie / Yjs / editor", () => {
    expect(
      isNotesLocalDirty({
        noteId: note.id,
        pendingNoteIds: new Set(),
        editorDirty: false,
      }),
    ).toBe(false);

    expect(
      isNotesLocalDirty({
        noteId: note.id,
        pendingNoteIds: new Set([note.id]),
        editorDirty: false,
      }),
    ).toBe(true);

    expect(
      isNotesLocalDirty({
        noteId: note.id,
        pendingNoteIds: new Set(),
        editorDirty: true,
      }),
    ).toBe(true);

    setDocsCollabSyncState(note.id, { pendingServerSave: true });
    expect(
      isNotesLocalDirty({
        noteId: note.id,
        pendingNoteIds: new Set(),
        editorDirty: false,
      }),
    ).toBe(true);
    setDocsCollabSyncState(note.id, { pendingServerSave: false });
  });

  it("Keep mine persists the local body with the fresh server etag", async () => {
    const applyLocalBodyMarkdown = vi.fn();
    const onRefreshList = vi.fn();
    const { result } = renderHook(() =>
      useNotesReconnectConflict({
        active: note,
        pendingNoteIds: new Set(),
        applyLocalBodyMarkdown,
        onRefreshList,
      }),
    );

    act(() => {
      result.current.markEditorDirty(true);
    });
    expect(result.current.getLocalDirty()).toBe(true);

    await act(async () => {
      await result.current.keepMine();
    });

    expect(getNote).toHaveBeenCalledWith(note.id);
    expect(persistNoteMarkdown).toHaveBeenCalledWith(note.id, "Local body", '"fresh"');
    expect(writeNoteCollabOfflineContent).not.toHaveBeenCalled();
    expect(onRefreshList).not.toHaveBeenCalled();
    expect(result.current.getLocalDirty()).toBe(false);
    expect(result.current.reconnectConflict).toBe(false);
  });

  it("Use theirs reseeds the open editor and refreshes the list", async () => {
    const applyLocalBodyMarkdown = vi.fn();
    const onRefreshList = vi.fn();
    const { result } = renderHook(() =>
      useNotesReconnectConflict({
        active: note,
        pendingNoteIds: new Set(),
        applyLocalBodyMarkdown,
        onRefreshList,
      }),
    );
    const epochBefore = result.current.collabEpoch;

    await act(async () => {
      await result.current.useTheirs();
    });

    expect(writeNoteCollabOfflineContent).toHaveBeenCalledWith(note.id, "Server body");
    expect(applyLocalBodyMarkdown).toHaveBeenCalledWith(note.id, "Server body", { bumpDate: false });
    expect(onRefreshList).toHaveBeenCalledOnce();
    expect(persistNoteMarkdown).not.toHaveBeenCalled();
    expect(result.current.collabEpoch).toBe(epochBefore + 1);
    expect(result.current.getLocalDirty()).toBe(false);
  });
});
