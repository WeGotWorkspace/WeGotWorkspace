import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/models/note";
import { setDocsCollabSyncState } from "@/text-editor-core/docs-collab/docs-collab-sync-registry";
import { useNotesReconnectConflict } from "@/notes-core/src/use-notes-reconnect-conflict";
import { isNotesLocalDirty } from "@/notes-core/src/notes-reconnect-actions";
import { noteBodyToMarkdown } from "@/lib/models/note-body-markdown";

const workspaceSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "notes-workspace.tsx"),
  "utf8",
);

const getNote = vi.fn();
const persistNoteMarkdown = vi.fn();
const writeNoteCollabOfflineContent = vi.fn();

vi.mock("@/lib/api/wgw/http", () => ({
  wgwApiBaseUrl: () => "https://api.test",
  wgwEnsureFreshAccessToken: () => Promise.resolve("token"),
}));

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
    expect(workspaceSource).toContain("void applyTheirs()");
    expect(workspaceSource).toContain("useNotesReconnectConflict");
    expect(workspaceSource).toContain("onPersistSuccess");
    expect(workspaceSource).toContain("markEditorSaved");
  });

  beforeEach(() => {
    getNote.mockReset();
    persistNoteMarkdown.mockReset();
    writeNoteCollabOfflineContent.mockReset();
    getNote.mockResolvedValue({ id: note.id, body: "Server body", etag: '"fresh"' });
    persistNoteMarkdown.mockResolvedValue({ id: note.id, etag: '"saved"' });
    writeNoteCollabOfflineContent.mockResolvedValue(undefined);
  });

  it("treats only editor or pending Yjs save as local dirty", () => {
    expect(
      isNotesLocalDirty({
        noteId: note.id,
        editorDirty: false,
      }),
    ).toBe(false);

    expect(
      isNotesLocalDirty({
        noteId: note.id,
        editorDirty: true,
      }),
    ).toBe(true);

    setDocsCollabSyncState(note.id, { pendingServerSave: true });
    expect(
      isNotesLocalDirty({
        noteId: note.id,
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

  it("clears editor dirty after a successful save, not after a failed save", () => {
    const { result } = renderHook(() =>
      useNotesReconnectConflict({
        active: note,
        applyLocalBodyMarkdown: vi.fn(),
        onRefreshList: vi.fn(),
      }),
    );

    act(() => {
      result.current.markEditorDirty(true);
    });
    expect(result.current.getLocalDirty()).toBe(true);

    act(() => {
      result.current.markEditorSaved("Local body");
    });
    expect(result.current.getLocalDirty()).toBe(false);

    act(() => {
      result.current.markEditorDirty(true);
    });
    act(() => {
      result.current.markEditorSaved("stale body the server never accepted");
    });
    expect(result.current.getLocalDirty()).toBe(true);
  });

  it("successful persistMarkdown clears dirty; 412 leaves it set", async () => {
    const { result } = renderHook(() =>
      useNotesReconnectConflict({
        active: note,
        applyLocalBodyMarkdown: vi.fn(),
        onRefreshList: vi.fn(),
      }),
    );
    const { buildNoteCollabUrls } = await import("@/notes-core/src/note-collab-path");
    const urls = await buildNoteCollabUrls(note.id, note.etag ?? "", {
      onPersistSuccess: result.current.markEditorSaved,
    });

    act(() => {
      result.current.markEditorDirty(true);
    });
    persistNoteMarkdown.mockResolvedValueOnce({ id: note.id, etag: '"saved"' });
    await urls.persistMarkdown?.(noteBodyToMarkdown(note.body));
    expect(result.current.getLocalDirty()).toBe(false);

    act(() => {
      result.current.markEditorDirty(true);
    });
    persistNoteMarkdown.mockRejectedValue(
      Object.assign(new Error("PATCH failed (412)"), { status: 412 }),
    );
    await expect(urls.persistMarkdown?.("unsaved")).rejects.toThrow(/412/);
    expect(result.current.getLocalDirty()).toBe(true);
  });

  it("Use theirs reseeds the open editor and refreshes the list", async () => {
    const applyLocalBodyMarkdown = vi.fn();
    const onRefreshList = vi.fn();
    const { result } = renderHook(() =>
      useNotesReconnectConflict({
        active: note,
        applyLocalBodyMarkdown,
        onRefreshList,
      }),
    );
    const epochBefore = result.current.collabEpoch;

    await act(async () => {
      await result.current.applyTheirs();
    });

    expect(writeNoteCollabOfflineContent).toHaveBeenCalledWith(note.id, "Server body");
    expect(applyLocalBodyMarkdown).toHaveBeenCalledWith(note.id, "Server body", {
      bumpDate: false,
    });
    expect(onRefreshList).toHaveBeenCalledOnce();
    expect(persistNoteMarkdown).not.toHaveBeenCalled();
    expect(result.current.collabEpoch).toBe(epochBefore + 1);
    expect(result.current.getLocalDirty()).toBe(false);
  });
});
